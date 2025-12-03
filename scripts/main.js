import { db, auth, onAuthStateChanged } from "./firestoreapi.js";
import { ref, get, child } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

// 1. GLOBAL VARIABLE (Accessible by everyone)
let allRecipes = []; 

// --- HELPER FUNCTIONS ---

function RecipeTemplate(recipe) {
    const tags = recipe.tags || []; 
    const author = recipe.author || "The Egbert Family";

    return `
    <div class="recipe-card" data-name="${recipe.name}">
        <div id="info">
            <div id="tags">
                ${tagsTemplate(tags)}
            </div>
            <h2>${recipe.name}</h2>
        </div>
        <div id="author">
            <p>By: ${author}</p>
        </div>
    </div>`;
}

function tagsTemplate(tags){
    let html = '';
    tags.forEach(tag => {
        html += '<p>' + tag + '</p>';
    });
    return html;
}

function renderRecipes(recipeList) {
    const container = document.getElementById('recipes');
    if (!container) return;

    let html = '';
    recipeList.forEach(recipe => {
        html += RecipeTemplate(recipe);
    });
    container.innerHTML = html;

    // Click handler
    document.querySelectorAll(".recipe-card").forEach(card => {
        card.addEventListener("click", () => {
            const name = card.getAttribute("data-name");
            const selectedRecipe = allRecipes.find(r => r.name === name);
            
            // Generate Slug
            const recipeId = selectedRecipe.name.toLowerCase()
                .replace(/ /g, '-')
                .replace(/[^\w-]+/g, '');

            localStorage.setItem("currentRecipeData", JSON.stringify(selectedRecipe));
            window.location.href = `recipe.html?id=${recipeId}`;
        });
    });
}

// Global Filter Function
function filter(query) {
    if (!allRecipes) return [];
    
    const filtered = allRecipes.filter(recipe => {
        const name = recipe.name || "";
        const tags = recipe.tags || [];
        const filterednames = name.toLowerCase().includes(query);
        const filteredtags = tags.some(tag => tag.toLowerCase().includes(query));
        return filterednames || filteredtags
    });
    return filtered.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
}

// --- DATABASE FETCHING ---

// --- DATABASE FETCHING ---

onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById("notsigned").style.display = 'none';
        const recipesGrid = document.getElementById('recipes');
        recipesGrid.style.display = 'flex'; 
        recipesGrid.innerHTML = "<p>Loading recipes...</p>";

        const dbRef = ref(db);
        
        get(child(dbRef, "/")).then((snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                
                // 1. Convert to Array
                if (Array.isArray(data)) {
                    allRecipes = data;
                } else {
                    allRecipes = Object.values(data);
                }

                // 2. NEW: Sort Alphabetically immediately!
                allRecipes.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

                console.log("Recipes loaded & sorted:", allRecipes.length);
                renderRecipes(allRecipes);

            } else {
                recipesGrid.innerHTML = "<p>No recipes found.</p>";
            }
        }).catch((error) => {
            console.error("Error fetching recipes:", error);
            recipesGrid.innerHTML = `<p>Error: ${error.message}</p>`;
        });

    } else {
        document.getElementById("notsigned").style.display = 'block';
        document.getElementById('recipes').style.display = 'none';
    }
});

// --- SEARCH POPUP LOGIC ---

// --- INTERACTION LOGIC (Search + Categories) ---

document.addEventListener('DOMContentLoaded', () => {
    
    // PART A: SEARCH POPUP
    const searchBtn = document.getElementById('header-search-btn');
    const closeBtn = document.getElementById('close-search');
    const overlay = document.getElementById('search-overlay');
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('searchbar');

    // 1. Open Search
    if (searchBtn && overlay) {
        searchBtn.addEventListener('click', () => {
            overlay.classList.add('show-search');
            if (searchInput) searchInput.focus();
        });
    }

    // 2. Close Search
    if (closeBtn && overlay) {
        closeBtn.addEventListener('click', () => {
            overlay.classList.remove('show-search');
        });
    }

    // 3. Close on Outside Click
    if (overlay) {
        window.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show-search');
            }
        });
    }

    // 4. Handle Search Submit
    if (searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault(); 
            const query = searchInput.value.toLowerCase();
            
            const results = filter(query);
            renderRecipes(results);
            
            overlay.classList.remove('show-search');
        });
    }

    // PART B: CATEGORY BUTTONS (With Toggle Logic)
    const categoryBtns = document.querySelectorAll('.folders button');
    
    if (categoryBtns) {
        categoryBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const button = e.currentTarget; // The specific button clicked
                
                // 1. Check if this button is ALREADY active
                const isAlreadyActive = button.classList.contains('active-filter');

                // 2. Reset ALL buttons (Turn them all back to Teal/Inactive)
                categoryBtns.forEach(b => b.classList.remove('active-filter'));

                if (isAlreadyActive) {
                    // --- SCENARIO: TURNING OFF ---
                    // If it was already active, we just clicked to turn it off.
                    // Do NOT add the class back. 
                    console.log("Clearing filters...");
                    
                    // Show ALL recipes (using the global variable)
                    renderRecipes(allRecipes); 
                } else {
                    // --- SCENARIO: TURNING ON ---
                    // It was not active, so let's activate it.
                    button.classList.add('active-filter');
                    
                    // Filter the list
                    const category = button.innerText.toLowerCase();
                    console.log("Filtering by:", category);
                    const results = filter(category);
                    renderRecipes(results);
                }
            });
        });
    }
});