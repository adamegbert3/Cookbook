import { db, auth } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// Check Login
onAuthStateChanged(auth, (user) => {
    if (!user) {
        alert("Please log in to submit recipes.");
        window.location.href = "index.html";
    }
});

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
        
        // Convert text areas into Arrays (Split by new line)
        const ingredientsRaw = document.getElementById('ingredients').value;
        const ingredientsList = ingredientsRaw.split('\n').map(s => s.trim()).filter(s => s);

        const instructionsRaw = document.getElementById('instructions').value;
        const instructionsList = instructionsRaw.split('\n').map(s => s.trim()).filter(s => s);

        const notes = document.getElementById('notes').value.trim();

        // 🚀 SEND TO "PENDING" COLLECTION
        const submitBtn = form.querySelector('button');
        const originalText = submitBtn.innerText;
        submitBtn.disabled = true;
        submitBtn.innerText = "Sending...";

        try {
            await addDoc(collection(db, "pending_recipes"), {
                name: title,
                author: chef, // The name they typed (e.g. "Grandma")
                submittedBy: user.email, // The real user account
                uid: user.uid,
                category: category,
                ingredients: ingredientsList,
                instructions: instructionsList,
                notes: notes,
                timestamp: serverTimestamp(),
                status: "pending"
            });

            alert("Recipe submitted! The Admin will review it shortly.");
            window.location.href = "homepage.html";

        } catch (error) {
            console.error("Error submitting:", error);
            alert("Error: " + error.message);
            submitBtn.disabled = false;
            submitBtn.innerText = originalText;
        }
    });
}