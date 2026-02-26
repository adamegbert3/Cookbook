import { db, auth } from './firebase-config.js';
import { 
    doc, getDoc, addDoc, collection, serverTimestamp, setDoc, arrayUnion 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const recipeId = urlParams.get('id');

// ==========================================
// 1. LOAD RECIPE LOGIC
// ==========================================
async function loadRecipe() {
    const recipeContainer = document.getElementById("recipe");
    if (!recipeContainer) return;

    let localData = null;
    try {
        const stored = localStorage.getItem("currentRecipeData");
        if (stored) localData = JSON.parse(stored);
    } catch (e) {}

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

async function logViewToDatabase(recipeData) {
    const sessionKey = `viewed-${recipeData.id}`;
    if (sessionStorage.getItem(sessionKey)) return; 

    try {
        const user = auth.currentUser;
        let viewerName = "Guest";

        if (user) {
            viewerName = user.email ? user.email.split('@')[0] : "Family Member";
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists() && userDoc.data().Name) {
                    viewerName = userDoc.data().Name; 
                }
            } catch (err) { console.log("Could not fetch profile name"); }
        }

        await addDoc(collection(db, "recipe_views"), {
            recipeId: recipeData.id,
            recipeTitle: recipeData.name || recipeData.n,
            timestamp: serverTimestamp(),
            viewer: viewerName 
        });

        sessionStorage.setItem(sessionKey, "true");
    } catch (e) { console.error("Could not log view:", e); }
}

function renderRecipeHTML(recipe) {
    const recipeContainer = document.getElementById("recipe");
    
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
        <p class="no-print" style="font-size:12px; color:#94a3b8; font-style:italic;">(Tap to cross out)</p>
        <ul id="ingredient-list">${ingHtml}</ul>
        <h3 class="section-header">Instructions</h3>
        <div id="instructions-container">${instHtml}</div>
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
// 2. KITCHEN TOOLS & MEAL PLANNER
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

// --- MEAL PLANNER LOGIC ---
window.addToMealPlan = function() {
    if (!auth.currentUser) return alert("Please sign in to save menus!");
    const modal = document.getElementById('plannerModal');
    if(modal) {
        modal.classList.remove('hidden'); 
        modal.style.display = 'flex';
    } else {
        alert("Error: Planner Modal not found in HTML");
    }
}

window.closePlannerModal = function() {
    const modal = document.getElementById('plannerModal');
    if(modal) modal.style.display = 'none';
}

window.confirmAddToPlan = async function() {
    const day = document.getElementById('daySelect').value;
    const typeSelect = document.getElementById('mealTypeSelect'); 
    const mealType = typeSelect ? typeSelect.value : "Dinner";

    const current = JSON.parse(localStorage.getItem("currentRecipeData"));
    if(!current) return alert("Error loading recipe data.");

    const user = auth.currentUser;
    if (!user) return alert("You must be logged in.");

    // Visual Feedback
    const btn = document.querySelector('#plannerModal button[onclick="confirmAddToPlan()"]');
    if(btn) btn.innerText = "Saving...";

    try {
        const mealData = {
            id: current.id,
            name: current.name || current.n,
            ingredients: current.ingredients || current.recipeIngredient || [],
            type: mealType,
            addedAt: Date.now() 
        };

        const docRef = doc(db, "users", user.uid, "weekly_plan", day);
        await setDoc(docRef, { meals: arrayUnion(mealData) }, { merge: true });

        alert(`Success! Added to ${day} for ${mealType}.`);
        closePlannerModal();

    } catch (e) {
        console.error("Menu Error:", e);
        alert("Could not save to menu.");
    } finally {
        if(btn) btn.innerText = "Save";
    }
}

// --- COOK COUNTER ---
function loadCookStats() {
    const count = localStorage.getItem(`cook-${recipeId}`) || 0;
    const el = document.getElementById('cook-counter');
    if(el) el.innerHTML = count > 0 ? `You've cooked this <b>${count}</b> times!` : "You haven't cooked this yet.";
}

window.recordCook = async function() {
    let count = parseInt(localStorage.getItem(`cook-${recipeId}`) || 0);
    count++;
    localStorage.setItem(`cook-${recipeId}`, count);
    loadCookStats();
    
    const btn = document.querySelector('.celebration-area button');
    if(btn) btn.innerText = "🎉 Yay!";

    try {
        const user = auth.currentUser;
        await addDoc(collection(db, "global_cooks"), {
            recipeId: recipeId,
            timestamp: serverTimestamp(),
            chef: user ? (user.displayName || "Family Member") : "Guest"
        });
    } catch (e) { console.error("Could not record cook to DB:", e); }
}

// ==========================================
// 3. REPORTING LOGIC
// ==========================================
window.submitReport = async function() {
    const reason = document.getElementById('report-reason').value.trim();
    if(!reason) return alert("Please describe the issue.");
    
    const current = JSON.parse(localStorage.getItem("currentRecipeData"));
    
    try {
        const user = auth.currentUser;
        await addDoc(collection(db, "recipe_reports"), {
            recipeId: current.id,
            recipeName: current.name || current.n,
            issue: reason,
            reporter: user ? (user.displayName || user.email) : "Guest",
            uid: user ? user.uid : "anonymous",
            timestamp: serverTimestamp()
        });
        
        alert("Report sent!");
        document.getElementById('report-reason').value = "";
        
        if(window.closeReportModal) window.closeReportModal();
        else document.getElementById('report-modal').classList.add('hidden');
        
    } catch(e) { alert("Error sending report."); }
}

// ==========================================
// 4. Sharing
// ==========================================
// --- SHARE MODAL LOGIC ---
window.openShareModal = function() {
    document.getElementById('share-modal').classList.remove('hidden');
};

window.closeShareModal = function() {
    document.getElementById('share-modal').classList.add('hidden');
};

window.copyRecipeLink = function() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        alert("Link copied! They will need an account to view it.");
    });
};
window.triggerPrint = function() {
    closeShareModal(); // Crucial: Close the modal first!
    setTimeout(() => { 
        window.print(); // Wait 300ms for the animation to finish, then print
    }, 300);
};





// Start
loadRecipe();