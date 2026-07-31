// ==========================================
// SELF-SERVICE INVITE SIGNUP
// The admin creates an invite doc (name/email/role) from admin.html — a
// plain Firestore write, so it works from a phone with no local setup. This
// page reads that invite and lets the invited person create their OWN
// account with the normal, unprivileged client Auth SDK (no service account
// key or admin credentials ever touch a browser). See firestore.rules for
// the matching /invites security rules.
// ==========================================
import { db, auth } from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

const urlParams = new URLSearchParams(window.location.search);
const inviteId = urlParams.get('id');

const headingEl = document.getElementById('invite-heading');
const subtitleEl = document.getElementById('invite-subtitle');
const formEl = document.getElementById('invite-form');
const invalidEl = document.getElementById('invite-invalid');

let inviteData = null;

function withTimeout(promise, ms, timeoutMessage) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(timeoutMessage), { code: 'timeout' })), ms))
    ]);
}

async function loadInvite() {
    if (!inviteId) return showInvalid();

    console.log("👪 [INVITE SIGNUP] Loading invite:", inviteId);
    try {
        const snap = await getDoc(doc(db, "invites", inviteId));
        if (!snap.exists() || snap.data().used) return showInvalid();

        inviteData = snap.data();
        console.log("✅ [INVITE SIGNUP] Invite found for:", inviteData.email);

        headingEl.innerText = `Welcome, ${inviteData.name}!`;
        subtitleEl.innerText = "Set a password to finish creating your account.";
        document.getElementById('invite-name-display').value = inviteData.name;
        document.getElementById('invite-email-display').value = inviteData.email;
        formEl.classList.remove('hidden');
    } catch (e) {
        console.error("🔥 [INVITE SIGNUP] Could not load invite:", e);
        showInvalid();
    }
}

function showInvalid() {
    formEl.classList.add('hidden');
    invalidEl.classList.remove('hidden');
    subtitleEl.innerText = "Invite not found.";
}

formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!inviteData) return;

    const errorEl = document.getElementById('invite-error');
    const btn = document.getElementById('invite-submit-btn');
    const password = document.getElementById('invite-password').value;
    const confirmPassword = document.getElementById('invite-password-confirm').value;

    errorEl.innerText = "";

    if (password.length < 6) { errorEl.innerText = "Password must be at least 6 characters."; return; }
    if (password !== confirmPassword) { errorEl.innerText = "Passwords don't match."; return; }

    btn.disabled = true;
    btn.innerText = "Creating your account...";

    try {
        console.log("👪 [INVITE SIGNUP] Creating account for:", inviteData.email);
        const cred = await withTimeout(
            createUserWithEmailAndPassword(auth, inviteData.email, password),
            15000, "That's taking too long — check your connection and try again."
        );

        await setDoc(doc(db, "users", cred.user.uid), {
            Name: inviteData.name,
            email: inviteData.email,
            // Every invite creates a regular account — never role:'admin'
            // (firestore.rules enforces this server-side too). Admin access
            // is always a separate step an existing admin takes afterward
            // from the admin console's "Manage Admin Access" widget.
            role: 'user',
            favorites: [],
            createdAt: serverTimestamp()
        });

        try {
            await updateDoc(doc(db, "invites", inviteId), {
                used: true,
                usedAt: serverTimestamp(),
                usedByUid: cred.user.uid
            });
        } catch (markUsedError) {
            // Not fatal — their account already exists either way.
            console.error("Could not mark invite as used:", markUsedError);
        }

        console.log("✅ [INVITE SIGNUP] Account created:", cred.user.uid);
        window.location.href = "homepage.html";
    } catch (error) {
        console.error("🔥 [INVITE SIGNUP] Account creation failed:", error);
        let message = "Could not create your account: " + error.message;
        if (error.code === "auth/email-already-in-use") {
            message = "An account already exists for this email — try signing in instead.";
        } else if (error.code === "auth/network-request-failed" || error.code === "timeout") {
            message = "Connection trouble — check your Wi-Fi/data and try again.";
        }
        errorEl.innerText = message;
        btn.disabled = false;
        btn.innerText = "Create My Account";
    }
});

loadInvite();
