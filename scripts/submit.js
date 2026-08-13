import { db, auth } from './firebase-config.js';
import { collection, addDoc, doc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { buildRecipeFields, DIETARY_TAGS } from './recipe-model.js';

// "Built-in" admins — keep in sync with the ADMIN_UIDS arrays in
// scripts/dashboard.js, scripts/main.js, scripts/profile.js,
// scripts/review.js, and edit-recipe.html. Only controls whether the
// Testing Kitchen checkbox below is shown; firestore.rules is what actually
// enforces this (recipes create: if isAdmin()), so there's no way for a
// non-admin to use it even by forcing the checkbox visible.
const ADMIN_UIDS = [
    "n5aAU1g1tBY04Ut0HnhqegSgZe92",
    "NrY491PYN3MIrqJp4rhu5S86w2R2",
    "mPBrypCN9ab1LCEQ578E5YrX8DI2",
    "WxkJYdGYlIRs4FFdDdLcr05jUm22" // Austin
];

async function checkIsAdmin(uid) {
    if (ADMIN_UIDS.includes(uid)) return true;
    try {
        const snap = await getDoc(doc(db, "users", uid));
        return snap.exists() && snap.data().role === 'admin';
    } catch (e) {
        return false;
    }
}

let currentUserIsAdmin = false;

document.getElementById('dietary').innerHTML = DIETARY_TAGS.map(tag => `
    <label class="dietary-check"><input type="checkbox" value="${tag}"> ${tag}</label>`).join('');

// Inserts a "## Part Name" heading at the end of a textarea, so people can
// discover multi-part recipes without knowing the syntax up front.
window.addSection = function(fieldId) {
    const box = document.getElementById(fieldId);
    if (!box) return;
    const name = prompt("Name this part (e.g. Crust, Filling, Topping):");
    if (!name) return;
    const prefix = box.value.trim() ? '\n' : '';
    box.value = `${box.value.trimEnd()}${prefix}## ${name.trim()}\n`;
    box.focus();
    box.selectionStart = box.selectionEnd = box.value.length;
};

// Check Login
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.warn("🚫 [SUBMIT] Not logged in — bouncing to login page.");
        alert("Please log in to submit recipes.");
        window.location.href = "index.html";
        return;
    }

    console.log("✅ [SUBMIT] Logged in as:", user.email);

    currentUserIsAdmin = await checkIsAdmin(user.uid);
    if (currentUserIsAdmin) {
        const wrap = document.getElementById('admin-draft-option');
        if (wrap) wrap.style.display = 'flex';
    }
});

// --- SPLIT TOOL (same behavior as edit-recipe.html's version) ---
window.autoSplitInstructions = function() {
    const instBox = document.getElementById('instructions');
    let text = instBox.value;
    if (!text) return;
    if (text.includes('\n')) {
        if (!confirm("This looks like it already has lines. Split anyway?")) return;
    }
    console.log("✂️ [SUBMIT] Auto-splitting instructions into steps.");
    instBox.value = text.replace(/\. /g, '.\n');
};

// Handle Form Submit
const form = document.getElementById('submitForm');
if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const user = auth.currentUser;
        if (!user) return alert("You must be logged in.");

        // Grab values
        const title = document.getElementById('title').value.trim();
        const chef = document.getElementById('chef').value.trim();
        const category = document.getElementById('category').value;
        
        // Parses "## Part" headings into sections AND writes the flat arrays,
        // so multi-part recipes work everywhere without breaking anything
        // that expects one plain list (shopping list, search index, offline).
        const ingredientFields = buildRecipeFields(document.getElementById('ingredients').value, 'ingredients');
        const instructionFields = buildRecipeFields(document.getElementById('instructions').value, 'instructions');

        const notes = document.getElementById('notes').value.trim();
        const driveUrl = document.getElementById('driveLink').value.trim();
        const sourceUrl = document.getElementById('sourceUrl').value.trim();

        const draftCheckbox = document.getElementById('draft-mode-checkbox');
        // currentUserIsAdmin gates this, not just the checkbox — firestore.rules
        // would reject a non-admin's write to "recipes" anyway, but this keeps
        // a tampered checkbox from even attempting it.
        const wantsDraft = currentUserIsAdmin && draftCheckbox && draftCheckbox.checked;

        const commonFields = {
            name: title,
            author: chef, // The name they typed (e.g. "Grandma")
            category: category,
            ...ingredientFields,
            ...instructionFields,
            notes: notes,
            driveUrl: driveUrl,
            sourceUrl: sourceUrl,
            family: document.getElementById('family').value,
            dietary: Array.from(document.querySelectorAll('#dietary input:checked')).map(cb => cb.value)
        };

        const submitBtn = form.querySelector('button');
        const originalText = submitBtn.innerText;
        submitBtn.disabled = true;
        submitBtn.innerText = "Sending...";

        try {
            if (wantsDraft) {
                // Admin, testing something for themselves — publishes straight
                // to the recipes collection (skipping review, which doesn't
                // apply here) but hidden from everyone else until released.
                console.log(`🍳 [SUBMIT] Adding "${title}" directly to the Testing Kitchen...`);
                await addDoc(collection(db, "recipes"), {
                    ...commonFields,
                    tags: [category],
                    isDraft: true,
                    reviewed: false,
                    createdAt: serverTimestamp()
                });
                console.log("✅ [SUBMIT] Added to Testing Kitchen.");
                alert("Added to your Testing Kitchen! Find it behind the 🍳 button on the homepage.");
            } else {
                console.log(`🚀 [SUBMIT] Sending "${title}" to the pending_recipes queue...`);
                await addDoc(collection(db, "pending_recipes"), {
                    ...commonFields,
                    submittedBy: user.email, // The real user account
                    uid: user.uid,
                    timestamp: serverTimestamp(),
                    status: "pending"
                });
                console.log("✅ [SUBMIT] Recipe submitted successfully.");
                alert("Recipe submitted! The Admin will review it shortly.");
            }
            window.location.href = "homepage.html";

        } catch (error) {
            console.error("🔥 [SUBMIT] Error submitting:", error);
            alert("Error: " + error.message);
            submitBtn.disabled = false;
            submitBtn.innerText = originalText;
        }
    });
}