// recipePage.js - FINAL VERSION

// 1. Get the ID from the URL (e.g., ?id=fruit-dip)
const urlParams = new URLSearchParams(window.location.search);
const recipeId = urlParams.get('id');

console.log("Recipe Page Loaded. ID:", recipeId);

function loadRecipe() {
    // 2. Get the data passed from the Homepage
    const storedData = localStorage.getItem("currentRecipeData");

    const recipeContainer = document.getElementById("recipe");
    if (!recipeContainer) {
        console.error("CRITICAL ERROR: Could not find <div id='recipe'> in HTML.");
        return;
    }

    if (!storedData) {
        recipeContainer.innerHTML = "<h2>No recipe loaded. Go back to <a href='homepage.html'>Homepage</a>.</h2>";
        return;
    }

    // 3. Parse the data
    let recipe;
    try {
        recipe = JSON.parse(storedData);
    } catch (e) {
        console.error("Data corrupted:", e);
        return;
    }

    // 4. Build the HTML
    const ingredients = recipe.recipeIngredient || [];
    const instructions = recipe.recipeInstructions || [];
    const tags = recipe.tags || [];

    const html = `
        <h1>${recipe.name}</h1>
        <h2>By: ${recipe.author || "The Egbert Family"}</h2>
        
        <h3>Ingredients</h3>
        <ul id="ingredient-list">
            ${ingredients.map(i => `<li>${i}</li>`).join("")}
        </ul>

        <h3>Instructions</h3>
        <ol id="normal-instructions">
            ${instructions.map(step => `<li>${step}</li>`).join("")}
        </ol>

        <div class="tags-section">
            <strong>Tags:</strong> ${tags.join(", ")}
        </div>
    `;

    // 5. Inject into the page
    recipeContainer.innerHTML = html;
    document.title = recipe.name;
    // --- NEW: Save just THIS recipe as the last one ---
    const lastRecipeData = {
        name: recipe.name,
        id: recipeId
};
    localStorage.setItem('lastRecipeSingle', JSON.stringify(lastRecipeData));
    
    // 6. Load Notes & Counts
    loadUserUserData();
}

function loadUserUserData() {
    if (!recipeId) return;

    // Load Chef Notes
    const savedNotes = localStorage.getItem(`notes-${recipeId}`);
    const noteBox = document.getElementById('chef-notes-area'); 
    if (noteBox) {
        noteBox.value = savedNotes || ""; 
    }

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

// Global functions for HTML interaction
window.saveNotes = function(elementId) {
    const box = document.getElementById(elementId);
    if (recipeId && box) {
        localStorage.setItem(`notes-${recipeId}`, box.value);
    }
}

window.celebrateInHouse = function(btnElement) {
    if (!recipeId) return;

    // Fire confetti if available
    if (typeof fireConfetti === "function") fireConfetti(btnElement);

    let count = parseInt(localStorage.getItem(`cook-${recipeId}`) || 0);
    count++;
    
    const today = new Date().toLocaleDateString();
    
    localStorage.setItem(`cook-${recipeId}`, count);
    localStorage.setItem(`date-${recipeId}`, today);
    
    updateText(count, today);
}

// Start the engine
loadRecipe();

// --- TUTORIAL LOGIC ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Check if user has already seen this
    const hasSeenTutorial = localStorage.getItem('tutorialSeen');

    if (!hasSeenTutorial) {
        const tutorialOverlay = document.getElementById('tutorial-overlay');
        const closeTutBtn = document.getElementById('close-tutorial');
        const demoEgg = document.getElementById('demo-egg');

        if (tutorialOverlay) {
            // Show it after a short delay (so the recipe loads first)
            setTimeout(() => {
                tutorialOverlay.classList.add('show-search'); // Re-using your existing "Show" class
            }, 1000);
        }

        // 2. Interactive Demo Logic (Clicking the egg)
        if (demoEgg) {
            demoEgg.addEventListener('click', () => {
                demoEgg.classList.toggle('checked');
            });
        }

        // 3. Close & Save "Seen" Status
        if (closeTutBtn) {
            closeTutBtn.addEventListener('click', () => {
                tutorialOverlay.classList.remove('show-search');
                
                // IMPORTANT: Save this so it never shows again!
                localStorage.setItem('tutorialSeen', 'true');
            });
        }
    }
});