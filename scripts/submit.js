import { db, auth } from './firebase-config.js'; 
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// 1. Check if user is logged in (Optional: kick out guests)
onAuthStateChanged(auth, (user) => {
    if (!user) {
        alert("You must be logged in to submit recipes!");
        window.location.href = "index.html";
    }
});

// 2. Handle Form Submission
document.getElementById('submitForm').addEventListener('submit', async (e) => {
    e.preventDefault(); // Stop page refresh

    const btn = document.querySelector('.login-btn');
    const originalText = btn.innerText;
    
    // Show loading state
    btn.innerText = "Submitting...";
    btn.disabled = true;

    try {
        // A. Helper function to split text by new lines into an Array
        // This turns: "Apple\nSugar" into ["Apple", "Sugar"]
        const getList = (id) => {
            const val = document.getElementById(id).value;
            return val.split('\n').map(item => item.trim()).filter(item => item.length > 0);
        };
        // B. Gather Data
        const newRecipe = {
            name: document.getElementById('title').value,
            author: document.getElementById('chef').value,
            
            // REMOVED: description: document.getElementById('desc').value,
            
            // ADDED: The new Notes field!
            // We use || "" to make sure it doesn't crash if they leave it empty
            notes: document.getElementById('notes') ? document.getElementById('notes').value : "", 
            
            category: document.getElementById('category').value,
            
            // Arrays for lists
            ingredients: getList('ingredients'),
            instructions: getList('instructions'),
            
            // Metadata
            reviewed: false, 
            userId: auth.currentUser.uid,
            createdAt: serverTimestamp()
        };

        // C. Send to Firestore 'pending_recipes' collection
        await addDoc(collection(db, "pending_recipes"), newRecipe);

        // D. Success!
        alert("Recipe Submitted! An admin will review it shortly.");
        window.location.href = "index.html";

    } catch (error) {
        console.error("Error submitting:", error);
        alert("Error: " + error.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
});