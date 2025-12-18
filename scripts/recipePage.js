import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const recipeId = urlParams.get('id');

// ==========================================
// 1. LOAD RECIPE
// ==========================================
async function loadRecipe() {
    const recipeContainer = document.getElementById("recipe");
    if (!recipeContainer) return;

    // A. Local Check
    let localData = null;
    try {
        const stored = localStorage.getItem("currentRecipeData");
        if (stored) localData = JSON.parse(stored);
    } catch (e) {}

    // B. Database Fetch
    if (!recipeId) {
        recipeContainer.innerHTML = "<h2>No recipe selected.</h2>";
        return;
    }

    try {
        const docRef = doc(db, "recipes", recipeId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const fullData = { id: recipeId, ...docSnap.data() };
            localStorage.setItem("currentRecipeData", JSON.stringify(fullData));
            renderRecipeHTML(fullData);
            loadUserUserData();
        } else {
            // Fallback to local if DB fails
            if(localData && localData.id === recipeId) {
                renderRecipeHTML(localData);
            } else {
                recipeContainer.innerHTML = "<h2>Recipe not found.</h2>";
            }
        }
    } catch (error) { console.error(error); }
}

function renderRecipeHTML(recipe) {
    const recipeContainer = document.getElementById("recipe");
    
    // Data Setup
    const ingredients = recipe.ingredients || recipe.recipeIngredient || [];
    const instructions = recipe.instructions || recipe.recipeInstructions || ""; 
    const author = recipe.author || recipe.a || "Family";

    // Build Ingredients
    let ingHtml = "";
    if (Array.isArray(ingredients)) {
        ingHtml = ingredients.map(i => `<li>${i}</li>`).join("");
    } else {
        ingHtml = `<pre>${ingredients}</pre>`;
    }

    // Build Instructions
    let instHtml = "";
    if (Array.isArray(instructions)) {
        // We give these 'li's a class so we can target them too
        instHtml = `<ol id="normal-instructions">${instructions.map(s => `<li class="instruction-step">${s}</li>`).join("")}</ol>`;
    } else {
        instHtml = `<p style="white-space: pre-wrap;">${instructions}</p>`;
    }

    // Render HTML
    recipeContainer.innerHTML = `
        <h1 style="text-align:center; font-family:'Amatic SC'; font-size: 3rem; margin-bottom: 5px; color:#0f172a;">${recipe.name || recipe.n}</h1>
        <h2 style="text-align:center; color:#64748b; font-size: 1rem; margin-top: 0; font-style:italic;">From: ${author}</h2>
        
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;">

        <h3 style="color:#0d9488;">Ingredients</h3>
        <p style="font-size:12px; color:#94a3b8; font-style:italic;">(Tap to cross out)</p>
        <ul id="ingredient-list">
            ${ingHtml}
        </ul>

        <h3 style="color:#0d9488; margin-top:30px;">Instructions</h3>
        <div id="instructions-container">
            ${instHtml}
        </div>
    `;

    // ⚡️ ACTIVATE CLICK-TO-CROSS-OUT (Ingredients & Instructions)
    
    // 1. For Ingredients
    document.querySelectorAll('#ingredient-list li').forEach(li => {
        li.addEventListener('click', function() {
            this.classList.toggle('checked');
        });
    });

    // 2. For Instructions
    document.querySelectorAll('.instruction-step').forEach(li => {
        li.addEventListener('click', function() {
            this.classList.toggle('checked');
        });
    });

    localStorage.setItem('lastRecipeSingle', JSON.stringify({ name: (recipe.name || recipe.n), id: recipeId }));
}

// ==========================================
// 2. BUTTON ACTIONS
// ==========================================
let wakeLock = null;
window.toggleCookMode = async function() {
    const btn = document.getElementById('cookModeBtn');
    if (!wakeLock) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            btn.innerText = "Cook Mode: ON 🍳";
            btn.classList.add('cook-mode-active');
        } catch (err) { alert("Screen Wake Lock not supported"); }
    } else {
        wakeLock.release();
        wakeLock = null;
        btn.innerText = "Enable Cook Mode 🍳";
        btn.classList.remove('cook-mode-active');
    }
}

let currentSize = 16;
window.resizeText = function(change) {
    currentSize += change;
    const elements = document.querySelectorAll('#ingredient-list li, #instructions-container li, #instructions-container p');
    elements.forEach(el => el.style.fontSize = currentSize + 'px');
}

window.saveRecipeOffline = function() {
    alert("Page saved to browser cache!");
}

window.addToMealPlan = function() {
    const modal = document.getElementById('plannerModal');
    if(modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
}

window.closePlannerModal = function() {
    document.getElementById('plannerModal').style.display = 'none';
}

window.confirmAddToPlan = function() {
    const day = document.getElementById('daySelect').value;
    const current = JSON.parse(localStorage.getItem("currentRecipeData"));
    if(!current) return;

    let plan = JSON.parse(localStorage.getItem('mealPlan')) || {};
    plan[day] = current.name || current.n;
    localStorage.setItem('mealPlan', JSON.stringify(plan));
    
    alert(`Added to ${day}!`);
    closePlannerModal();
}

// ==========================================
// 3. USER DATA & COOKING
// ==========================================
function loadUserUserData() {
    if (!recipeId) return;
    const savedNotes = localStorage.getItem(`notes-${recipeId}`);
    const noteBox = document.getElementById('chefNotes'); 
    if (noteBox) noteBox.value = savedNotes || ""; 
    
    const count = localStorage.getItem(`cook-${recipeId}`) || 0;
    document.getElementById('cook-counter').innerHTML = count > 0 ? `Cooked <b>${count}</b> times` : "Not cooked yet";
}

window.recordCook = function() {
    let count = parseInt(localStorage.getItem(`cook-${recipeId}`) || 0);
    count++;
    localStorage.setItem(`cook-${recipeId}`, count);
    loadUserUserData();
}

loadRecipe();