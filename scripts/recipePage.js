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
    if (!recipeContainer) return;
    
    // 1. Automatically mark opened recipe as "Camping Ready" in localStorage
    const currentId = recipe.id || recipeId;
    const campingReady = JSON.parse(localStorage.getItem('campingReadyIds') || "[]");
    if (currentId && !campingReady.includes(currentId)) {
        campingReady.push(currentId);
        localStorage.setItem('campingReadyIds', JSON.stringify(campingReady));
    }

    // 2. Check recipe statuses
    const isReviewed = recipe.r === true || recipe.reviewed === true;
    const isHidden = recipe.h === true || recipe.isHidden === true;
    const recTags = Array.isArray(recipe.t || recipe.tags) ? (recipe.t || recipe.tags) : [String(recipe.t || recipe.tags || "")];
    
    // 3. Build Status Pills (Notice: Offline tent is commented out for now as requested!)
    let statusBarHtml = `<div class="recipe-status-bar" style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin: 12px 0 16px 0;">`;
    
    // /*
    // statusBarHtml += `<span class="status-emoji" title="Saved for Offline / Camping" style="background: #fef08a; border: 1px solid #eab308; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; color: #854d0e;">⛺ Saved for Offline</span>`;
    // */

    if (isReviewed) {
        statusBarHtml += `<span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #10b981;">✅ Verified & Reviewed Recipe</span>`;
    } else {
        statusBarHtml += `<span style="background: #fef2f2; color: #991b1b; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #f87171;">⚠️ Unreviewed (Needs Verification)</span>`;
    }

    if (isHidden) {
        statusBarHtml += `<span style="background: #e2e8f0; color: #475569; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #94a3b8;">👁️ Hidden</span>`;
    }

    if (recTags.includes("Egbert Favorite")) {
        statusBarHtml += `<span style="background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #38bdf8;">⭐ Egbert Family Favorite</span>`;
    }
    if (recTags.includes("Wheeler Favorite")) {
        statusBarHtml += `<span style="background: #dcfce7; color: #15803d; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #4ade80;">⭐ Wheeler Family Favorite</span>`;
    }

    statusBarHtml += `</div>`;
    
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

    // 4. Inject into DOM: Notice statusBarHtml is right under From: ${author}
    recipeContainer.innerHTML = `
        <h1 class="recipe-title-lg">${recipe.name || recipe.n}</h1>
        <h2 class="recipe-chef" style="margin-bottom: 4px;">From: ${author}</h2>
        
        ${statusBarHtml}
        
        <hr class="recipe-divider">
        <h3 class="section-header">Ingredients</h3>
        <p class="no-print" style="font-size:12px; color:#94a3b8; font-style:italic;">(Tap to cross out)</p>
        <ul id="ingredient-list">${ingHtml}</ul>
        <h3 class="section-header">Instructions</h3>
        <div id="instructions-container">${instHtml}</div>
    `;

    setTimeout(() => {
        document.querySelectorAll('#ingredient-list li, .instruction-step').forEach(li => {
            li.addEventListener('click', function() { this.classList.toggle('checked'); });
        });
    }, 100);

    localStorage.setItem('lastRecipeSingle', JSON.stringify({ name: (recipe.name || recipe.n), id: currentId }));
    
    // Trigger Mobile Tools layout setup
    setupMobileKitchenTools();
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

// window.saveRecipeOffline = function() {
//     const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
//     const btn = document.querySelector('button[onclick="saveRecipeOffline()"]');
    
//     if (!currentRecipe) {
//         alert("Could not verify recipe data. Try refreshing the page!");
//         return;
//     }

//     // 1. Ensure the recipe is safely locked into local storage as a fallback
//     localStorage.setItem(`offline-backup-${currentRecipe.id}`, JSON.stringify(currentRecipe));

//     // 2. Mark it as camping ready
//     const campingReady = JSON.parse(localStorage.getItem('campingReadyIds') || "[]");
//     if (!campingReady.includes(currentRecipe.id)) {
//         campingReady.push(currentRecipe.id);
//         localStorage.setItem('campingReadyIds', JSON.stringify(campingReady));
//     }

//     // 3. Give the user satisfying visual feedback
//     if (btn) {
//         const originalText = btn.innerText;
//         btn.innerText = "✅ Saved for Offline Cooking!";
//         btn.style.background = "#10b981"; // Turn green
//         btn.style.color = "#ffffff";
        
//         setTimeout(() => {
//             btn.innerText = originalText;
//             btn.style.background = ""; // Reset to original style
//             btn.style.color = "";
//         }, 3000);
//     } else {
//         alert("✅ Recipe & Ingredients cached for offline cooking!");
//     }
// };

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
window.submitReport = async function(event) {
    if (event) {
        event.preventDefault(); 
    }

    const reason = document.getElementById('report-reason').value.trim();
    if(!reason) return alert("Please describe the issue.");
    
    const current = JSON.parse(localStorage.getItem("currentRecipeData"));
    
    const btn = document.querySelector('#report-modal button.btn-teal') || document.activeElement;
    const originalText = btn.innerText;
    btn.innerText = "Sending...";
    
    try {
        const user = auth.currentUser;
        let reporterName = "Guest";
        let reporterEmail = "No Email";

        if (user) {
            reporterEmail = user.email || "No Email";
            reporterName = reporterEmail.split('@')[0]; 
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists() && userDoc.data().Name) {
                    reporterName = userDoc.data().Name; 
                } else if (user.displayName) {
                    reporterName = user.displayName;
                }
            } catch (err) { console.log("Could not fetch profile name for report."); }
        }

        await addDoc(collection(db, "recipe_reports"), {
            recipeId: current.id,
            recipeName: current.name || current.n,
            issue: reason,
            userName: reporterName,      
            userEmail: reporterEmail,    
            uid: user ? user.uid : "anonymous",
            createdAt: serverTimestamp() 
        });
        
        alert("Report sent to the Chef!");
        document.getElementById('report-reason').value = "";
        
        const reportModal = document.getElementById('report-modal');
        if (reportModal) reportModal.classList.add('hidden');
        if (window.closeReportModal) window.closeReportModal();
        
    } catch(e) { 
        console.error(e);
        alert("Error sending report. Check your connection."); 
    } finally {
        if(btn) btn.innerText = originalText;
    }
}

// ==========================================
// 4. Sharing
// ==========================================
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
    closeShareModal();
    setTimeout(() => { 
        window.print(); 
    }, 300);
};

// // ==========================================
// // START THE SERVICE WORKER ON RECIPE PAGES
// // ==========================================
// if ('serviceWorker' in navigator) {
//     window.addEventListener('load', () => {
//         navigator.serviceWorker.register('./sw.js')
//             .then((registration) => {
//                 console.log('👷‍♂️ [SERVICE WORKER] Registered on Recipe Page with scope:', registration.scope);
//             })
//             .catch((error) => {
//                 console.error('❌ [SERVICE WORKER] Registration failed:', error);
//             });
//     });
// }

// ==========================================
// MOBILE FLOATING KITCHEN TOOLS MODAL
// ==========================================
function setupMobileKitchenTools() {
    // 1. Inject responsive CSS rules if not already present
    if (!document.getElementById('mobile-tools-style')) {
        const style = document.createElement('style');
        style.id = 'mobile-tools-style';
        style.innerHTML = `
            /* Floating Action Button (Hidden on Desktop) */
            #mobile-tool-fab {
                display: none;
                position: fixed;
                bottom: 24px;
                right: 24px;
                width: 60px;
                height: 60px;
                background-color: #0d9488;
                color: white;
                border-radius: 50%;
                border: none;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                font-size: 26px;
                cursor: pointer;
                z-index: 999;
                align-items: center;
                justify-content: center;
                transition: transform 0.2s, background-color 0.2s;
            }
            #mobile-tool-fab:active {
                transform: scale(0.92);
            }
            
            /* Modal Backdrop & Container */
            #mobile-tools-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                z-index: 1000;
                align-items: flex-end;
                justify-content: center;
            }
            #mobile-tools-content {
                background: #1e293b;
                width: 100%;
                max-width: 500px;
                border-top-left-radius: 20px;
                border-top-right-radius: 20px;
                padding: 24px;
                box-shadow: 0 -4px 20px rgba(0,0,0,0.4);
                animation: slideUp 0.3s ease-out;
            }
            @keyframes slideUp {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
            }

            /* 🚀 THE GRID UPGRADE: 2 clean equal columns with uniform height! */
            #mobile-tools-body {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 12px;
            }

            /* 🚀 UNIFORM PILL STYLING: Forces every button to identical dimensions */
            .mobile-tool-pill {
                display: flex !important;
                align-items: center;
                justify-content: center;
                width: 100% !important;
                height: 48px !important;
                margin: 0 !important;
                padding: 0 12px !important;
                border-radius: 24px !important;
                font-size: 0.95rem !important;
                font-weight: 600 !important;
                text-align: center;
                box-sizing: border-box;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            /* Make wide buttons (like Report Issue or Cook Mode) span across both columns! */
            .mobile-tool-pill-wide {
                grid-column: span 2;
            }

            /* Mobile Media Query Switch */
            @media (max-width: 768px) {
                .kitchen-tools-inline {
                    display: none !important;
                }
                #mobile-tool-fab {
                    display: flex;
                }
                /* Extra breathing room at the bottom so the comment Post button clears the FAB */
                body {
                    padding-bottom: 90px !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // 2. FOOLPROOF CONTAINER FINDER
    const sampleBtn = document.getElementById('cookModeBtn') || document.querySelector('button[onclick*="toggleCookMode"]');
    let toolsSection = null;
    
    if (sampleBtn) {
        toolsSection = sampleBtn.closest('div[style*="background"], .kitchen-tools, div[class*="tools"], div[class*="card"], div');
        if (toolsSection && toolsSection.parentElement && (toolsSection.parentElement.innerText.includes('KITCHEN TOOLS') || toolsSection.parentElement.querySelectorAll('button').length > 4)) {
            toolsSection = toolsSection.parentElement;
        }
    }

    if (toolsSection && !toolsSection.classList.contains('kitchen-tools-inline')) {
        toolsSection.classList.add('kitchen-tools-inline');
    }

    // 3. Create Floating Button
    if (!document.getElementById('mobile-tool-fab')) {
        const fab = document.createElement('button');
        fab.id = 'mobile-tool-fab';
        fab.innerHTML = '🛠️';
        fab.title = 'Kitchen Tools';
        fab.onclick = openMobileToolsModal;
        document.body.appendChild(fab);
    }

    // 4. Create Modal Structure
    if (!document.getElementById('mobile-tools-modal')) {
        const modal = document.createElement('div');
        modal.id = 'mobile-tools-modal';
        modal.onclick = (e) => { if (e.target === modal) closeMobileToolsModal(); };
        modal.innerHTML = `
            <div id="mobile-tools-content">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="color: white; margin: 0; font-size: 1.2rem;">🛠️ Kitchen Tools</h3>
                    <button onclick="closeMobileToolsModal()" style="background: none; border: none; color: #94a3b8; font-size: 24px; cursor: pointer;">&times;</button>
                </div>
                <div id="mobile-tools-body"></div>
            </div>
        `;
        document.body.appendChild(modal);
    }
}

window.openMobileToolsModal = function() {
    const modal = document.getElementById('mobile-tools-modal');
    const modalBody = document.getElementById('mobile-tools-body');
    
    let inlineTools = document.querySelector('.kitchen-tools-inline');
    if (!inlineTools) {
        const sampleBtn = document.getElementById('cookModeBtn') || document.querySelector('button[onclick*="toggleCookMode"]');
        if (sampleBtn) inlineTools = sampleBtn.parentElement;
    }
    
    if (modal && inlineTools) {
        const allToolButtons = Array.from(inlineTools.querySelectorAll('button'));
        modalBody.innerHTML = '';
        
        // 🚀 SORT ORDER: Text +/-, Day Mode & Cook Mode, Share & Menu, Report
        const getOrderScore = (text) => {
            if (text.includes('Text +')) return 1;
            if (text.includes('Text -')) return 2;
            if (text.includes('Day') || text.includes('Night')) return 3;
            if (text.includes('Cook Mode')) return 4;
            if (text.includes('Share') || text.includes('Print')) return 5;
            if (text.includes('Menu')) return 6;
            if (text.includes('Report')) return 7;
            return 10;
        };

        allToolButtons
            .filter(btn => !btn.innerText.includes('Save Offline') && btn.id !== 'mobile-tool-fab')
            .sort((a, b) => getOrderScore(a.innerText) - getOrderScore(b.innerText))
            .forEach(btn => {
                const clone = btn.cloneNode(true);
                clone.classList.add('mobile-tool-pill');
                
                // 🚀 THE FIX: Only Report Issue stretches across both columns now!
                if (clone.innerText.includes('Report')) {
                    clone.classList.add('mobile-tool-pill-wide');
                }
                
                modalBody.appendChild(clone);
            });
        
        modal.style.display = 'flex';
    } else {
        alert("Could not load kitchen tools. Please check console for errors.");
    }
};

window.closeMobileToolsModal = function() {
    const modal = document.getElementById('mobile-tools-modal');
    if (modal) modal.style.display = 'none';
};

// Start
loadRecipe();