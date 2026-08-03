import { db, auth } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { buildRecipeFields, DIETARY_TAGS } from './recipe-model.js';

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
onAuthStateChanged(auth, (user) => {
    if (!user) {
        console.warn("🚫 [SUBMIT] Not logged in — bouncing to login page.");
        alert("Please log in to submit recipes.");
        window.location.href = "index.html";
    } else {
        console.log("✅ [SUBMIT] Logged in as:", user.email);
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

        // 🚀 SEND TO "PENDING" COLLECTION
        const submitBtn = form.querySelector('button');
        const originalText = submitBtn.innerText;
        submitBtn.disabled = true;
        submitBtn.innerText = "Sending...";

        console.log(`🚀 [SUBMIT] Sending "${title}" to the pending_recipes queue...`);

        try {
            await addDoc(collection(db, "pending_recipes"), {
                name: title,
                author: chef, // The name they typed (e.g. "Grandma")
                submittedBy: user.email, // The real user account
                uid: user.uid,
                category: category,
                ...ingredientFields,
                ...instructionFields,
                notes: notes,
                driveUrl: driveUrl,
                sourceUrl: sourceUrl,
                family: document.getElementById('family').value,
                dietary: Array.from(document.querySelectorAll('#dietary input:checked')).map(cb => cb.value),
                timestamp: serverTimestamp(),
                status: "pending"
            });

            console.log("✅ [SUBMIT] Recipe submitted successfully.");
            alert("Recipe submitted! The Admin will review it shortly.");
            window.location.href = "homepage.html";

        } catch (error) {
            console.error("🔥 [SUBMIT] Error submitting:", error);
            alert("Error: " + error.message);
            submitBtn.disabled = false;
            submitBtn.innerText = originalText;
        }
    });
}