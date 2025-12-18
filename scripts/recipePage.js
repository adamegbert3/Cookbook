// ==========================================
// 📖 RECIPE PAGE - HYBRID LOADER (Fixed)
// ==========================================
import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

// 1. Get the ID from the URL
const urlParams = new URLSearchParams(window.location.search);
const recipeId = urlParams.get('id');

console.log("Recipe Page Loaded. ID:", recipeId);

// 2. MAIN LOADER
async function loadRecipe() {
    const recipeContainer = document.getElementById("recipe");
    if (!recipeContainer) return console.error("Error: <div id='recipe'> missing.");

    // STEP A: Try to load what we have in Local Storage (Title & Author)
    // This makes the page feel instant, even if ingredients are missing for a second.
    let localData = null;
    try {
        const stored = localStorage.getItem("currentRecipeData");
        if (stored) localData = JSON.parse(stored);
    } catch (e) { console.error("Storage error:", e); }

    // If we have local data, render the header immediately
    if (localData && localData.name) {
        document.title = localData.name;
        // Check if we have the FULL data (Ingredients exist)
        if (localData.ingredients || localData.recipeIngredient) {
            console.log("✅ Full recipe found locally.");
            renderRecipeHTML(localData);
            loadUserUserData();
            return; // We are done!
        } else {
            console.log("⚠️ Lite version found. Fetching full ingredients...");
            // Render the "Skeleton" (Title only) while we wait
            renderRecipeHTML(localData, true); 
        }
    }

    // STEP B: Fetch the FULL data from Firestore (The Fix!)
    if (!recipeId) {
        recipeContainer.innerHTML = "<h2>No recipe selected. <a href='index.html'>Go Home</a></h2>";
        return;
    }

    try {
        const docRef = doc(db, "recipes", recipeId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const fullData = { id: recipeId, ...docSnap.data() };
            
            // Save the full version to memory so we don't fetch it again
            localStorage.setItem("currentRecipeData", JSON.stringify(fullData));
            
            // Render the complete page
            console.log("✅ Downloaded full details.");
            renderRecipeHTML(fullData);
            loadUserUserData();
        } else {
            recipeContainer.innerHTML = "<h2>Recipe not found in database.</h2>";
        }
    } catch (error) {
        console.error("Download Error:", error);
        recipeContainer.innerHTML += `<p style='color:red'>Error loading details: ${error.message}</p>`;
    }
}

// 3. RENDER FUNCTION
function renderRecipeHTML(recipe, isLoadingIngredients = false) {
    const recipeContainer = document.getElementById("recipe");

    // Handle different data names (recipeIngredient vs ingredients)
    const ingredients = recipe.ingredients || recipe.recipeIngredient || [];
    const instructions = recipe.instructions || recipe.recipeInstructions || ""; 
    const tags = recipe.tags || [];
    const author = recipe.author || "The Egbert Family";

    // Build Lists
    let ingHtml = "";
    if (isLoadingIngredients) {
        ingHtml = `<li style="color:#888; list-style:none;">🔄 Downloading ingredients...</li>`;
    } else if (Array.isArray(ingredients)) {
        ingHtml = ingredients.map(i => `<li>${i}</li>`).join("");
    } else {
        ingHtml = `<pre style="font-family:inherit;">${ingredients}</pre>`;
    }

    let instHtml = "";
    if (isLoadingIngredients) {
        instHtml = `<p style="color:#888;">🔄 Downloading instructions...</p>`;
    } else if (Array.isArray(instructions)) {
        instHtml = `<ol id="normal-instructions">${instructions.map(s => `<li>${s}</li>`).join("")}</ol>`;
    } else {
        instHtml = `<p style="white-space: pre-wrap;">${instructions}</p>`;
    }

    // Inject HTML
    recipeContainer.innerHTML = `
        <h1>${recipe.name}</h1>
        <h2>From: ${author}</h2>
        
        <h3>Ingredients</h3>
        <ul id="ingredient-list">
            ${ingHtml}
        </ul>

        <h3>Instructions</h3>
        <div id="instructions-container">
            ${instHtml}
        </div>

        <div class="tags-section" style="margin-top:20px; color:#666; font-size: 12px;">
            <strong>Tags:</strong> ${tags.join(", ") || "None"}
        </div>
    `;

    // Save for history
    localStorage.setItem('lastRecipeSingle', JSON.stringify({ name: recipe.name, id: recipeId }));
}

// 4. USER DATA (Notes & Counts)
function loadUserUserData() {
    if (!recipeId) return;
    
    // Load Chef Notes
    const savedNotes = localStorage.getItem(`notes-${recipeId}`);
    const noteBox = document.getElementById('chefNotes'); 
    if (noteBox) noteBox.value = savedNotes || ""; 

    // Load Cook Count
    const count = localStorage.getItem(`cook-${recipeId}`) || 0;
    const lastDate = localStorage.getItem(`date-${recipeId}`);
    updateText(count, lastDate);
}

function updateText(count, date) {
    const textElement = document.getElementById('cook-counter');
    if (textElement) {
        if (count > 0) {
            textElement.innerHTML = `You've cooked this <strong>${count} times</strong>! (Last: ${date})`;
        } else {
            textElement.innerHTML = "You haven't cooked this yet.";
        }
    }
}

// 5. GLOBAL HELPERS
window.saveNotes = function() { // Updated to match your HTML logic
    const box = document.getElementById('chefNotes');
    if (recipeId && box) {
        localStorage.setItem(`notes-${recipeId}`, box.value);
        alert("Note saved locally!");
    }
}

window.recordCook = function(btnElement) {
    if (!recipeId) return;
    if (typeof fireConfetti === "function") fireConfetti(btnElement);

    let count = parseInt(localStorage.getItem(`cook-${recipeId}`) || 0);
    count++;
    const today = new Date().toLocaleDateString();
    
    localStorage.setItem(`cook-${recipeId}`, count);
    localStorage.setItem(`date-${recipeId}`, today);
    
    updateText(count, today);
}

// START
loadRecipe();