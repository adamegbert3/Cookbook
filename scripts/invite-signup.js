// ==========================================
// INVITE SIGNUP — temporary code, then their own password
//
// How this works, and why:
//
// Creating somebody else's Firebase Auth account requires admin
// credentials, which can never live in a browser (that's why
// local-tools/add-user exists as a terminal script). So the admin doesn't
// create the account at all — they create an *invite* holding a name, an
// email and a temporary code, and the account is created right here, by
// the invited person, the first time they use that code. No password ever
// passes through the admin.
//
// The invite's document ID **is** the code, so knowing the code is what
// grants access — see the /invites rules in firestore.rules, which allow
// reading one invite by id but only let admins list them.
// ==========================================
import { db, auth } from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

const codeForm = document.getElementById('code-form');
const passwordForm = document.getElementById('password-form');
const codeError = document.getElementById('code-error');
const inviteError = document.getElementById('invite-error');

// Carried between step 1 and step 2 once the code checks out
let verified = null; // { code, email, name }

function withTimeout(promise, ms, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(message), { code: 'timeout' })), ms))
    ]);
}

// A direct link (invite.html?id=CODE) just pre-fills the code — they still
// confirm their email, so a forwarded link alone isn't enough.
const linkedCode = new URLSearchParams(window.location.search).get('id');
if (linkedCode) {
    document.getElementById('code-input').value = linkedCode.toUpperCase();
    console.log("👪 [INVITE] Code pre-filled from the link.");
}

// ---------- STEP 1: check the code ----------
codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = document.getElementById('code-submit-btn');
    const email = document.getElementById('code-email').value.trim().toLowerCase();
    const code = document.getElementById('code-input').value.trim().toUpperCase().replace(/\s+/g, '');

    codeError.innerText = "";
    btn.disabled = true;
    btn.innerText = "Checking...";

    try {
        console.log("👪 [INVITE] Looking up code:", code);
        const snap = await withTimeout(getDoc(doc(db, "invites", code)), 15000, "That's taking too long — check your connection.");

        if (!snap.exists()) throw new Error("BAD_CODE");
        const invite = snap.data();

        if (invite.used) {
            codeError.innerText = "That code has already been used. Try signing in instead.";
            return;
        }

        // The code is the secret; matching the email is a second check so a
        // forwarded code can't be claimed by someone else.
        if ((invite.email || '').toLowerCase() !== email) {
            throw new Error("BAD_CODE");
        }

        verified = { code, email, name: invite.name || "" };
        console.log("✅ [INVITE] Code verified for:", invite.name);

        document.getElementById('invited-name').innerText = invite.name || email;
        document.getElementById('invite-heading').innerText = "Almost there!";
        document.getElementById('invite-subtitle').innerText = "Set the password you'll use from now on.";
        codeForm.classList.add('hidden');
        passwordForm.classList.remove('hidden');
        document.getElementById('invite-password').focus();

    } catch (err) {
        if (err.message === "BAD_CODE") {
            // Deliberately vague: don't reveal whether it was the code or
            // the email that didn't match.
            codeError.innerText = "That code and email don't match an invite. Double-check both.";
        } else if (err.code === 'timeout' || err.code === 'unavailable') {
            codeError.innerText = "Connection trouble — check your Wi-Fi/data and try again.";
        } else {
            console.error("🔥 [INVITE] Lookup failed:", err);
            codeError.innerText = "Something went wrong: " + err.message;
        }
    } finally {
        btn.disabled = false;
        btn.innerText = "Continue";
    }
});

// ---------- STEP 2: create the account ----------
passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!verified) return;

    const btn = document.getElementById('invite-submit-btn');
    const password = document.getElementById('invite-password').value;
    const confirmPassword = document.getElementById('invite-password-confirm').value;

    inviteError.innerText = "";

    if (password.length < 6) { inviteError.innerText = "Password must be at least 6 characters."; return; }
    if (password !== confirmPassword) { inviteError.innerText = "Those passwords don't match."; return; }

    btn.disabled = true;
    btn.innerText = "Creating your account...";

    try {
        console.log("👪 [INVITE] Creating account for:", verified.email);
        const cred = await withTimeout(
            createUserWithEmailAndPassword(auth, verified.email, password),
            15000, "That's taking too long — check your connection and try again."
        );

        // Keep this shape in sync with USER_DOC_SHAPE in scripts/dashboard.js
        // (the "Check User Documents" repair tool) and local-tools/add-user.
        // Types matter: `favorites` must be a real array or arrayUnion()
        // can't append to it, and Firestore's console defaults hand-added
        // fields to strings, which is how empty-string versions creep in.
        //
        // NOTE: a person's private Chef's Notes are NOT a field here — they
        // live one per recipe in the users/{uid}/private_notes/{recipeId}
        // subcollection (see loadUserNote/saveNote in scripts/main.js). The
        // Firebase console lists subcollections separately from fields,
        // below them, which is why they can look missing at a glance.
        await setDoc(doc(db, "users", cred.user.uid), {
            Name: verified.name,
            email: verified.email,
            // Never 'admin' at signup — firestore.rules enforces this too.
            // Admin is always a separate step from the admin console.
            role: 'user',
            favorites: [],      // array, not ""
            householdId: null,  // set when they join/create a household
            createdAt: serverTimestamp()
        });

        try {
            await updateDoc(doc(db, "invites", verified.code), {
                used: true,
                usedAt: serverTimestamp(),
                usedByUid: cred.user.uid
            });
        } catch (markUsedError) {
            // Not fatal — their account exists either way.
            console.error("Could not mark the invite as used:", markUsedError);
        }

        console.log("✅ [INVITE] Account created:", cred.user.uid);
        window.location.href = "homepage.html";

    } catch (error) {
        console.error("🔥 [INVITE] Account creation failed:", error);
        let message = "Could not create your account: " + error.message;

        if (error.code === "auth/email-already-in-use") {
            message = "An account already exists for this email — try signing in instead.";
        } else if (error.code === "auth/weak-password") {
            message = "That password is too easy to guess — try a longer one.";
        } else if (error.code === "auth/network-request-failed" || error.code === 'timeout') {
            message = "Connection trouble — check your Wi-Fi/data and try again.";
        }

        inviteError.innerText = message;
        btn.disabled = false;
        btn.innerText = "Create My Account";
    }
});
