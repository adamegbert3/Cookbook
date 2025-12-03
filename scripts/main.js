import { db, auth, onAuthStateChanged } from "./firestoreapi.js";
import { ref, get, child } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

// --- DEBUG HELPER ---
function logToScreen(message, isError = false) {
    console.log(message);
    const container = document.getElementById('recipes');
    if (container) {
        const style = isError ? "color: red; font-weight: bold;" : "color: blue;";
        container.innerHTML += `<p style="${style}">${message}</p>`;
    }
}

// --- GATEKEEPER ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        // 1. User found
        document.getElementById("notsigned").style.display = 'none';
        const recipesGrid = document.getElementById('recipes');
        recipesGrid.style.display = 'flex';
        
        // Clear previous logs
        recipesGrid.innerHTML = "";
        logToScreen("✅ User is logged in: " + user.email);
        logToScreen("⏳ Attempting to fetch data from Database...");

        // 2. Fetch Data
        const dbRef = ref(db);
        
        // We try to get data from the Root "/"
        get(child(dbRef, "/")).then((snapshot) => {
            if (snapshot.exists()) {
                logToScreen("✅ Connection successful! Data found.");
                const data = snapshot.val();
                
                // Convert data
                let allRecipes = [];
                if (Array.isArray(data)) {
                    allRecipes = data;
                    logToScreen(`✅ Data is an Array with ${allRecipes.length} items.`);
                } else if (typeof data === 'object') {
                    allRecipes = Object.values(data);
                    logToScreen(`✅ Data is an Object. Converted to ${allRecipes.length} items.`);
                } else {
                    logToScreen("⚠️ Data format is unexpected: " + typeof data, true);
                }

                // If we have recipes, render them (this clears the logs, so we know it worked)
                if (allRecipes.length > 0) {
                    renderRecipes(allRecipes); 
                } else {
                    logToScreen("⚠️ Data found, but list is empty.", true);
                }

            } else {
                logToScreen("❌ Database connected, but NO DATA found at this path.", true);
                logToScreen("💡 Hint: Are your recipes inside a folder? Try changing '/' to 'recipes'.");
            }
        }).catch((error) => {
            logToScreen("❌ ERROR: " + error.message, true);
            logToScreen("💡 Hint: Check your Rules tab in Firebase Console.", true);
        });

    } else {
        document.getElementById("notsigned").style.display = 'block';
        document.getElementById('recipes').style.display = 'none';
    }
});

// --- RENDER FUNCTION (Standard) ---
function renderRecipes(recipeList) {
    const container = document.getElementById('recipes');
    container.innerHTML = ""; // Clear the debug messages
    
    let html = '';
    recipeList.forEach(recipe => {
        // Skip null entries if they exist
        if (!recipe) return;

        const tags = recipe.tags || [];
        const author = recipe.author || "The Egbert Family";
        
        html += `
        <div class="recipe-card" data-name="${recipe.name}">
            <div id="info">
                <div id="tags">${tags.map(t => `<p>${t}</p>`).join('')}</div>
                <h2>${recipe.name}</h2>
            </div>
            <div id="author"><p>By: ${author}</p></div>
        </div>`;
    });
    container.innerHTML = html;

    // Re-attach click listeners
    document.querySelectorAll(".recipe-card").forEach(card => {
        card.addEventListener("click", () => {
            const name = card.getAttribute("data-name");
            const selectedRecipe = recipeList.find(r => r.name === name);
            
            // Slug Logic
            const recipeId = selectedRecipe.name.toLowerCase()
                .replace(/ /g, '-')
                .replace(/[^\w-]+/g, '');

            localStorage.setItem("currentRecipeData", JSON.stringify(selectedRecipe));
            window.location.href = `recipe.html?id=${recipeId}`;
        });
    });
}

// Simple search handler stub to prevent errors
document.getElementById('buttonimg')?.addEventListener('click', (e) => e.preventDefault());