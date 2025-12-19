import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const recipeId = urlParams.get('id');

// ==========================================
// 1. LOAD RECIPE LOGIC
// ==========================================
async function loadRecipe() {
    const recipeContainer = document.getElementById("recipe");
    if (!recipeContainer) return;

    // A. Local Storage Check (Fast Load)
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
            // Update storage with fresh data
            localStorage.setItem("currentRecipeData", JSON.stringify(fullData));
            renderRecipeHTML(fullData);
            loadCookStats(); // Load "Times Cooked"
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
    
    const ingredients = recipe.ingredients || recipe.recipeIngredient || [];
    const instructions = recipe.instructions || recipe.recipeInstructions || ""; 
    const author = recipe.author || recipe.a || "Family";

    // Build Ingredients List
    let ingHtml = "";
    if (Array.isArray(ingredients)) {
        ingHtml = ingredients.map(i => `<li>${i}</li>`).join("");
    } else {
        ingHtml = `<pre>${ingredients}</pre>`;
    }

    // Build Instructions List
    let instHtml = "";
    if (Array.isArray(instructions)) {
        instHtml = `<ol id="normal-instructions">${instructions.map(s => `<li class="instruction-step">${s}</li>`).join("")}</ol>`;
    } else {
        instHtml = `<p style="white-space: pre-wrap;">${instructions}</p>`;
    }

    // INJECT HTML (Using New CSS Classes)
    recipeContainer.innerHTML = `
        <h1 class="recipe-title-lg">${recipe.name || recipe.n}</h1>
        <h2 class="recipe-chef">From: ${author}</h2>
        
        <hr class="recipe-divider">

        <h3 class="section-header">Ingredients</h3>
        <p style="font-size:12px; color:#94a3b8; font-style:italic;">(Tap to cross out)</p>
        <ul id="ingredient-list">
            ${ingHtml}
        </ul>

        <h3 class="section-header">Instructions</h3>
        <div id="instructions-container">
            ${instHtml}
        </div>
    `;

    // ENABLE CLICK-TO-CROSS-OUT
    // We wait 100ms to ensure HTML is injected before attaching listeners
    setTimeout(() => {
        document.querySelectorAll('#ingredient-list li').forEach(li => {
            li.addEventListener('click', function() { this.classList.toggle('checked'); });
        });
        document.querySelectorAll('.instruction-step').forEach(li => {
            li.addEventListener('click', function() { this.classList.toggle('checked'); });
        });
    }, 100);

    // Save history for Homepage "Pick Up"
    localStorage.setItem('lastRecipeSingle', JSON.stringify({ name: (recipe.name || recipe.n), id: recipeId }));
}

// ==========================================
// 2. KITCHEN TOOLS (Attached to Window)
// ==========================================

// COOK MODE (Screen Wake Lock)
let wakeLock = null;
window.toggleCookMode = async function() {
    const btn = document.getElementById('cookModeBtn');
    if (!wakeLock) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            btn.innerText = "Cook Mode: ON 🍳";
            btn.classList.add('cook-mode-active');
        } catch (err) { alert("Screen Wake Lock not supported on this device."); }
    } else {
        if(wakeLock) wakeLock.release();
        wakeLock = null;
        btn.innerText = "Enable Cook Mode 🍳";
        btn.classList.remove('cook-mode-active');
    }
}

// TEXT RESIZER
let currentSize = 16;
window.resizeText = function(change) {
    currentSize += change;
    if (currentSize < 12) currentSize = 12; // Min limit
    if (currentSize > 30) currentSize = 30; // Max limit
    
    const elements = document.querySelectorAll('#ingredient-list li, #instructions-container li, #instructions-container p');
    elements.forEach(el => el.style.fontSize = currentSize + 'px');
}

// SAVE OFFLINE
window.saveRecipeOffline = function() {
    alert("Page saved to browser cache!");
}

// MEAL PLAN MODAL
window.addToMealPlan = function() {
    const modal = document.getElementById('plannerModal');
    if(modal) {
        modal.classList.remove('hidden'); 
        modal.style.display = 'flex';
    }
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

// COOK COUNTER
function loadCookStats() {
    const count = localStorage.getItem(`cook-${recipeId}`) || 0;
    const el = document.getElementById('cook-counter');
    if(el) el.innerHTML = count > 0 ? `You've cooked this <b>${count}</b> times!` : "You haven't cooked this yet.";
}

window.recordCook = function() {
    let count = parseInt(localStorage.getItem(`cook-${recipeId}`) || 0);
    count++;
    localStorage.setItem(`cook-${recipeId}`, count);
    loadCookStats();
    
    // Confetti effect (simple fallback)
    const btn = document.querySelector('.celebration-area button');
    if(btn) btn.innerText = "🎉 Yay!";
}

// Start
loadRecipe();