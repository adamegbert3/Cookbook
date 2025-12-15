import { db, auth } from './firebase-config.js'; 

// COMBINED IMPORT
import { 
    collection, 
    getDocs, 
    doc, 
    getDoc,       
    setDoc,
    updateDoc,    
    arrayUnion,   
    arrayRemove   
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// 2. GLOBAL VARIABLES
let allRecipes = []; 
let userFavorites = []; 

// --- HELPER FUNCTIONS ---

function RecipeTemplate(recipe) {
    const tags = recipe.tags || []; 
    const author = recipe.author || "The Egbert Family";
    const statusIcon = recipe.reviewed ? "✅" : "❌";
    const statusText = `Reviewed: ${statusIcon}`;

    // Check favorites
    const isFav = userFavorites.includes(recipe.id);
    const heartIcon = isFav ? "❤️" : "🤍";

    return `
    <div class="recipe-card" data-name="${recipe.name}">
        <button class="heart-btn card-heart" onclick="toggleHeart(event, '${recipe.id}')">
            ${heartIcon}
        </button>
        <div class="status-badge">${statusText}</div>
        <div id="info">
            <div id="tags">
                ${tagsTemplate(tags)}
            </div>
            <h2>${recipe.name}</h2>
        </div>
        <div id="author">
            <p>From: ${author}</p>
        </div>
    </div>`;
}

function tagsTemplate(tags){
    let html = '';
    if(Array.isArray(tags)) {
        tags.forEach(tag => {
            html += '<p>' + tag + '</p>';
        });
    }
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
            
            // Save data for the next page
            localStorage.setItem("currentRecipeData", JSON.stringify(selectedRecipe));
            
            // Generate slug
            const recipeId = selectedRecipe.name.toLowerCase()
                .replace(/ /g, '-')
                .replace(/[^\w-]+/g, '');
                
            window.location.href = `recipe.html?id=${recipeId}`;
        });
    });
}

// Global Filter Function
function filter(query) {
    if (!allRecipes) return [];
    
    return allRecipes.filter(recipe => {
        const name = (recipe.name || "").toLowerCase();
        const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
        const matchName = name.includes(query);
        const matchTag = tags.some(tag => tag.toLowerCase().includes(query));
        return matchName || matchTag;
    }).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
}


// --- MAIN LOGIC ---

// Wait for Login Check
onAuthStateChanged(auth, async (user) => {
    
    // 1. User is Logged In
    if (user) {
        console.log("Logged in as:", user.email);

        // UI Updates
        const notSignedMsg = document.getElementById("notsigned");
        if(notSignedMsg) notSignedMsg.style.display = 'none';
        
        const recipesGrid = document.getElementById('recipes');
        if(recipesGrid) {
            recipesGrid.style.display = 'flex'; 
            recipesGrid.innerHTML = "<p>Loading recipes from Firestore...</p>";
        }

        // --- A. LOAD FAVORITES ---
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            
            if (userSnap.exists()) {
                userFavorites = userSnap.data().favorites || [];
                console.log("Loaded favorites:", userFavorites.length);
            } else {
                userFavorites = [];
            }
        } catch (err) {
            console.error("Error loading user profile:", err);
            userFavorites = []; 
        } // <--- THIS WAS THE MISSING BRACKET!

        // --- B. LOAD NOTES (If on recipe page) ---
        const noteBox = document.getElementById('chefNotes');
        if (noteBox) {
            console.log("On recipe page, loading notes...");
            loadUserNote();
        }

        // --- C. LOAD RECIPES (If on homepage) ---
        if(recipesGrid) {
            try {
                const recipesRef = collection(db, "recipes");
                const querySnapshot = await getDocs(recipesRef);
                
                // Reset list
                allRecipes = [];

                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    // Combine ID with data
                    allRecipes.push({ id: doc.id, ...data });
                });

                // Sort Alphabetically
                allRecipes.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

                console.log("Recipes loaded:", allRecipes.length);
                renderRecipes(allRecipes);

            } catch (error) {
                console.error("Error getting recipes:", error);
                if(recipesGrid) recipesGrid.innerHTML = `<p>Error loading recipes. Check console.</p>`;
            }
        }

    } 
    // 2. User is NOT Logged In
    else {
        console.log("User is guest.");
        const notSignedMsg = document.getElementById("notsigned");
        if(notSignedMsg) notSignedMsg.style.display = 'block';
        
        const recipesGrid = document.getElementById('recipes');
        if(recipesGrid) recipesGrid.style.display = 'none';
    }
});


// --- INTERACTION LOGIC ---

document.addEventListener('DOMContentLoaded', () => {

    // MEAL PLANNER
    function loadMealPlan() {
        const plan = JSON.parse(localStorage.getItem('mealPlan')) || {};
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        
        days.forEach(day => {
            const element = document.getElementById(`plan-${day}`);
            if (element && plan[day]) {
                element.innerText = plan[day];
                if(element.parentElement) element.parentElement.style.borderColor = "#10b981"; 
            }
        });
    }

    window.clearMealPlan = function() {
        if(confirm("Clear entire week?")) {
            localStorage.removeItem('mealPlan');
            location.reload();
        }
    }
    loadMealPlan();
    
    // SEARCH POPUP
    const searchBtn = document.getElementById('header-search-btn');
    const closeBtn = document.getElementById('close-search');
    const overlay = document.getElementById('search-overlay');
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('searchbar');

    if (searchBtn && overlay) {
        searchBtn.addEventListener('click', () => {
            overlay.classList.add('show-search');
            if (searchInput) searchInput.focus();
        });
    }

    if (closeBtn && overlay) {
        closeBtn.addEventListener('click', () => {
            overlay.classList.remove('show-search');
        });
    }

    if (overlay) {
        window.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show-search');
            }
        });
    }

    if (searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault(); 
            const query = searchInput.value.toLowerCase();
            const results = filter(query);
            renderRecipes(results);
            overlay.classList.remove('show-search');
        });
    }

    // CATEGORY BUTTONS
    const categoryBtns = document.querySelectorAll('.folders button');
    
    if (categoryBtns) {
        categoryBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const button = e.currentTarget; 
                const isAlreadyActive = button.classList.contains('active-filter');

                categoryBtns.forEach(b => b.classList.remove('active-filter'));

                if (isAlreadyActive) {
                    renderRecipes(allRecipes); 
                } else {
                    button.classList.add('active-filter');
                    const category = button.innerText.toLowerCase();
                    const results = filter(category);
                    renderRecipes(results);
                }
            });
        });
    }
});

// --- GLOBAL FUNCTIONS (Called by HTML) ---

// Toggle Heart
window.toggleHeart = async function(event, recipeId) {
    event.stopPropagation();

    const user = auth.currentUser;
    if (!user) return alert("Please log in to save recipes!");

    const btn = event.currentTarget;
    const isCurrentlyFav = userFavorites.includes(recipeId);
    const userRef = doc(db, "users", user.uid);

    try {
        if (isCurrentlyFav) {
            await updateDoc(userRef, {
                favorites: arrayRemove(recipeId)
            });
            userFavorites = userFavorites.filter(id => id !== recipeId);
            btn.innerText = "🤍";
        } else {
            await updateDoc(userRef, {
                favorites: arrayUnion(recipeId)
            });
            userFavorites.push(recipeId);
            btn.innerText = "❤️";
        }
    } catch (error) {
        console.error("Error toggling heart:", error);
        alert("Could not save. Check console.");
    }
};

// Save Note
window.saveNote = async function() {
    const user = auth.currentUser;
    if (!user) return alert("Please log in to save notes!");

    const noteText = document.getElementById('chefNotes').value;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData")); 
    
    if(!currentRecipe) return alert("Error finding recipe ID");
    const recipeId = currentRecipe.id;

    const statusLabel = document.getElementById('saveStatus');
    statusLabel.innerText = "Saving...";

    try {
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, {
            notes: {
                [recipeId]: noteText 
            }
        }, { merge: true });

        statusLabel.innerText = "✅ Saved to Cloud!";
        setTimeout(() => statusLabel.innerText = "", 3000);

    } catch (error) {
        console.error("Error saving note:", error);
        statusLabel.innerText = "❌ Error saving.";
    }
};

// Load Note
async function loadUserNote() {
    const user = auth.currentUser;
    if (!user) return;

    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    if (!currentRecipe) return;

    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData.notes && userData.notes[currentRecipe.id]) {
                document.getElementById('chefNotes').value = userData.notes[currentRecipe.id];
                console.log("Note loaded from cloud.");
            }
        }
    } catch (error) {
        console.error("Error loading note:", error);
    }
}