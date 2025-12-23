import { db, auth } from './firebase-config.js';
import { doc, getDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

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
            localStorage.setItem("currentRecipeData", JSON.stringify(fullData));
            renderRecipeHTML(fullData);
            loadCookStats(); 
            
            // 🚨 NEW: Tell the database we viewed this!
            logViewToDatabase(fullData);

        } else {
            if(localData && localData.id === recipeId) {
                renderRecipeHTML(localData);
            } else {
                recipeContainer.innerHTML = "<h2>Recipe not found.</h2>";
            }
        }
    } catch (error) { console.error(error); }
}

// 🚨 UPDATED: Log View with Real Name
async function logViewToDatabase(recipeData) {
    // 1. Check duplicate views
    const sessionKey = `viewed-${recipeData.id}`;
    if (sessionStorage.getItem(sessionKey)) return; 

    try {
        const user = auth.currentUser;
        let viewerName = "Guest";

        if (user) {
            // Start with a fallback (Email)
            viewerName = user.email ? user.email.split('@')[0] : "Family Member";

            // 2. FETCH REAL NAME from Database (The Fix!)
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists() && userDoc.data().Name) {
                    viewerName = userDoc.data().Name; // Use "Aunt Sally" instead of "sally@gmail"
                }
            } catch (err) {
                console.log("Could not fetch profile name, using email.");
            }
        }

        // 3. Send to Database
        await addDoc(collection(db, "recipe_views"), {
            recipeId: recipeData.id,
            recipeTitle: recipeData.name || recipeData.n,
            timestamp: serverTimestamp(),
            viewer: viewerName // Now saves the real name!
        });

        sessionStorage.setItem(sessionKey, "true");
        console.log(`View logged for ${viewerName}!`);
        
    } catch (e) {
        console.error("Could not log view:", e);
    }
}

function renderRecipeHTML(recipe) {
    const recipeContainer = document.getElementById("recipe");
    
    // Smart find for ingredients/instructions
    const rawIng = recipe.ingredients || recipe.recipeIngredient;
    const rawInst = recipe.instructions || recipe.recipeInstructions;
    const author = recipe.author || recipe.a || "Family";

    let ingHtml = "";
    if (Array.isArray(rawIng)) {
        ingHtml = rawIng.map(i => `<li>${i}</li>`).join("");
    } else if (typeof rawIng === 'string') {
        ingHtml = `<pre>${rawIng}</pre>`;
    }

    let instHtml = "";
    if (Array.isArray(rawInst)) {
        instHtml = `<ol id="normal-instructions">${rawInst.map(s => `<li class="instruction-step">${s}</li>`).join("")}</ol>`;
    } else if (typeof rawInst === 'string') {
        instHtml = `<p style="white-space: pre-wrap;">${rawInst}</p>`;
    }

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

    setTimeout(() => {
        document.querySelectorAll('#ingredient-list li').forEach(li => {
            li.addEventListener('click', function() { this.classList.toggle('checked'); });
        });
        document.querySelectorAll('.instruction-step').forEach(li => {
            li.addEventListener('click', function() { this.classList.toggle('checked'); });
        });
    }, 100);

    localStorage.setItem('lastRecipeSingle', JSON.stringify({ name: (recipe.name || recipe.n), id: recipeId }));
}

// ==========================================
// 2. KITCHEN TOOLS
// ==========================================

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

let currentSize = 16;
window.resizeText = function(change) {
    currentSize += change;
    if (currentSize < 12) currentSize = 12; 
    if (currentSize > 30) currentSize = 30; 
    const elements = document.querySelectorAll('#ingredient-list li, #instructions-container li, #instructions-container p');
    elements.forEach(el => el.style.fontSize = currentSize + 'px');
}

window.saveRecipeOffline = function() {
    alert("Page saved to browser cache!");
}

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

function loadCookStats() {
    const count = localStorage.getItem(`cook-${recipeId}`) || 0;
    const el = document.getElementById('cook-counter');
    if(el) el.innerHTML = count > 0 ? `You've cooked this <b>${count}</b> times!` : "You haven't cooked this yet.";
}

// 🚨 UPDATED FUNCTION: Record Cook (Sends to DB)
window.recordCook = async function() {
    // 1. Local Update (Instant Feedback)
    let count = parseInt(localStorage.getItem(`cook-${recipeId}`) || 0);
    count++;
    localStorage.setItem(`cook-${recipeId}`, count);
    loadCookStats();
    
    // Confetti
    const btn = document.querySelector('.celebration-area button');
    if(btn) btn.innerText = "🎉 Yay!";

    // 2. Database Update (For Admin Panel)
    try {
        const user = auth.currentUser;
        await addDoc(collection(db, "global_cooks"), {
            recipeId: recipeId,
            timestamp: serverTimestamp(),
            chef: user ? (user.displayName || "Family Member") : "Guest"
        });
        console.log("Cook recorded to DB!");
    } catch (e) {
        console.error("Could not record cook to DB:", e);
    }
}

// ==========================================
// 3. REPORTING LOGIC
// ==========================================
window.submitReport = async function() {
    const reason = document.getElementById('report-reason').value.trim();
    if(!reason) return alert("Please describe the issue.");
    
    const current = JSON.parse(localStorage.getItem("currentRecipeData"));
    if(!current) return alert("Error finding recipe data.");
    
    const user = auth.currentUser;

    try {
        await addDoc(collection(db, "recipe_reports"), {
            recipeId: current.id,
            recipeName: current.name || current.n,
            issue: reason,
            reporter: user ? (user.displayName || user.email) : "Guest",
            uid: user ? user.uid : "anonymous",
            timestamp: serverTimestamp()
        });
        
        alert("Report sent! We will take a look.");
        document.getElementById('report-reason').value = "";
        
        if(window.closeReportModal) window.closeReportModal();
        else document.getElementById('report-modal').classList.add('hidden');
        
    } catch(e) {
        console.error("Report Error:", e);
        alert("Error sending report.");
    }
}

// Start
loadRecipe();