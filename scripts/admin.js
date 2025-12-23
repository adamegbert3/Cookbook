import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc, deleteDoc, updateDoc, 
    query, orderBy, limit, where, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// --- CONFIGURATION ---
// ⚠️ PASTE YOUR ACTUAL UID HERE ⚠️
const MY_ADMIN_ID = "n5aAU1g1tBY04Ut0HnhqegSgZe92"; 

// Global Variables
let currentActivityLimit = 20; 
let allRecipeData = []; // Stores the master list for the session

// ==========================================
// 1. SECURITY & STARTUP (OPTIMIZED)
// ==========================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        if (user.uid === MY_ADMIN_ID) {
            console.log("Welcome, Chef. Loading Dashboard...");
            loadAdminDashboard(); // <--- The new smart loader
        } else {
            alert("Nice try! You are not the Admin.");
            window.location.href = "index.html"; 
        }
    } else {
        window.location.href = "index.html"; 
    }
});

// ==========================================
// 2. THE MAIN LOADER (Saves 75% Reads)
// ==========================================
async function loadAdminDashboard() {
    console.log("📥 Downloading Database (ONCE)...");
    
    // 1. Load small independent widgets immediately
    loadPendingRecipes(); 
    loadReports();

    try {
        // 2. FETCH RECIPES ONCE (Cost: N reads)
        const querySnapshot = await getDocs(collection(db, "recipes"));
        allRecipeData = []; // Update global variable
        querySnapshot.forEach(doc => allRecipeData.push({ id: doc.id, ...doc.data() }));
        
        console.log(`✅ Loaded ${allRecipeData.length} recipes.`);

        // 3. DISTRIBUTE DATA (Cost: 0 reads)
        // We pass the list we just downloaded to the other functions
        renderRecipeManager(allRecipeData);      
        renderDeepStats(allRecipeData);      
        renderUnreviewed(allRecipeData);         
        
        // Pass list to analytics so it can calculate "Undiscovered" without re-fetching
        loadAnalytics(allRecipeData);      

    } catch (error) {
        console.error("Dashboard Error:", error);
        alert("Error loading dashboard. Check console.");
    }
}

// ==========================================
// 3. INDEPENDENT WIDGETS (Separate Collections)
// ==========================================

// RECIPE QUEUE
async function loadPendingRecipes() {
    const loadingDiv = document.getElementById('loading');
    const listContainer = document.getElementById('pending-list');
    if(!listContainer) return;
    
    try {
        const querySnapshot = await getDocs(collection(db, "pending_recipes"));
        
        if (querySnapshot.empty) {
            if(loadingDiv) loadingDiv.innerText = "No pending recipes! Good job, Chef.";
            return;
        }

        if(loadingDiv) loadingDiv.style.display = 'none';
        let html = '';

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            html += `
                <div class="pending-card" id="card-${doc.id}">
                    <div class="pending-header">
                        <h2>${data.name || "Untitled"}</h2>
                        <span style="color: #666; font-size: 12px;">By: ${data.author || "Unknown"}</span>
                    </div>
                    <div style="margin: 10px 0;"><strong>Notes:</strong> ${data.notes || "None"}</div>
                    <details><summary>Ingredients</summary><pre>${data.ingredients}</pre></details>
                    <details><summary>Instructions</summary><pre>${data.instructions}</pre></details>
                    <div class="pending-actions">
                        <button class="btn-approve" onclick="approveRecipe('${doc.id}')">✅ Approve</button>
                        <button class="btn-reject" onclick="rejectRecipe('${doc.id}')">❌ Reject</button>
                    </div>
                </div>
            `;
        });
        listContainer.innerHTML = html;
    } catch (error) {
        console.error("Error loading queue:", error);
    }
}

// USER REPORTS
async function loadReports() {
    const list = document.getElementById('issues-list');
    if(!list) return;

    try {
        const q = query(collection(db, "recipe_reports"), orderBy("timestamp", "desc"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            list.innerHTML = "<p>No issues reported!</p>";
            return;
        }

        let html = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            html += `
                <div style="background: #fff5f5; padding: 10px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #feb2b2;">
                    <strong>${data.recipeName}</strong>
                    <p style="margin: 5px 0;">"${data.issue}"</p>
                    <div style="font-size: 12px; color: #666; display: flex; justify-content: space-between; align-items: center;">
                        <span>By: ${data.reporter}</span>
                        <button onclick="resolveIssue('${doc.id}')" style="background: #fff; border: 1px solid #999; cursor: pointer; padding: 2px 8px; border-radius: 4px;">✅ Resolved</button>
                    </div>
                </div>
            `;
        });
        list.innerHTML = html;
    } catch (error) {
        console.error("Error loading reports:", error);
    }
}

// ==========================================
// 4. SHARED DATA WIDGETS (Uses 'allRecipeData')
// ==========================================

// A. ANALYTICS & UNDISCOVERED
async function loadAnalytics(allRecipes) {
    const activityList = document.getElementById('activity-list');
    const leaderboardList = document.getElementById('leaderboard-list');

    try {
        // Fetch Views (This still needs a read, which is fine)
        const q = query(collection(db, "recipe_views"), orderBy("timestamp", "desc"), limit(currentActivityLimit));
        const snapshot = await getDocs(q);
        
        let activityHtml = "";
        const viewCounts = {}; 

        snapshot.forEach(doc => {
            const data = doc.data();
            const timeStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : "Recently";
            
            activityHtml += `
                <div style="padding: 10px; background: #f9fafb; border-radius: 6px; font-size: 13px;">
                    <strong>${data.viewer}</strong> viewed <br>
                    <span style="color: #10b981; font-weight: bold;">${data.recipeTitle}</span>
                    <div style="color: #999; font-size: 11px; margin-top: 4px;">${timeStr}</div>
                </div>`;

            // Count for Leaderboard
            const title = data.recipeTitle || "Unknown Recipe";
            viewCounts[title] = (viewCounts[title] || 0) + 1;
        });

        if(activityList) activityList.innerHTML = activityHtml || "<p>No activity yet.</p>";

        // Build Leaderboard (Client Side sort)
        if(leaderboardList) {
            const sortedRecipes = Object.entries(viewCounts)
                .sort(([,countA], [,countB]) => countB - countA)
                .slice(0, 5); 
            
            let lbHtml = "";
            sortedRecipes.forEach(([title, count]) => {
                lbHtml += `<tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px;">${title}</td><td style="padding: 8px; font-weight: bold; color: #10b981;">${count}</td></tr>`;
            });
            leaderboardList.innerHTML = lbHtml || "<tr><td colspan='2'>No data</td></tr>";
        }

        // Render Undiscovered (Using passed list! 0 Reads!)
        renderDustyRecipes(allRecipes, viewCounts);

    } catch (error) {
        console.error("Error loading analytics:", error);
    }
}

function renderDustyRecipes(recipes, viewCounts) {
    const dustyList = document.getElementById('dusty-list');
    if(!dustyList) return;
    
    let html = "";
    let count = 0;
    
    recipes.forEach(r => {
        const title = r.name || "Untitled";
        if (!viewCounts[title]) {
            count++;
            html += `<div style="padding: 5px 0; border-bottom: 1px solid #eee; font-size: 13px; color: #666;">${title}</div>`;
        }
    });
    
    if (count === 0) dustyList.innerHTML = "<p style='color:green;'>Wow! Every recipe has been viewed!</p>";
    else dustyList.innerHTML = html;
}

// B. DEEP STATS
function renderDeepStats(recipes) {
    // Total Cooks (Separate collection, quick fetch)
    const cookCountEl = document.getElementById('total-cooks-count');
    getDocs(collection(db, "global_cooks")).then(snap => {
        if(cookCountEl) cookCountEl.innerText = snap.size.toLocaleString();
    }).catch(e => console.error(e));

    // Categories (Use local list)
    const catListEl = document.getElementById('category-stats-list');
    if(!catListEl) return;

    const categoryCounts = {};
    recipes.forEach(data => {
        let cat = "Uncategorized";
        if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) cat = data.tags[0];
        else if (data.category) cat = data.category;
        
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const sortedCats = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
    let html = "";
    sortedCats.forEach(([catName, count]) => {
        const percent = Math.round((count / recipes.length) * 100);
        html += `
            <div>
                <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 3px;">
                    <strong>${catName}</strong>
                    <span style="color:#666;">${count} recipes (${percent}%)</span>
                </div>
                <div style="width: 100%; background: #f3f4f6; height: 8px; border-radius: 4px; overflow: hidden;">
                    <div style="width: ${percent}%; background: #59c3c3; height: 100%;"></div>
                </div>
            </div>`;
    });
    catListEl.innerHTML = html;
}

// C. NEEDS REVIEW WIDGET (Smart Data Finder)
function renderUnreviewed(recipes) {
    const list = document.getElementById('unreviewed-list');
    if(!list) return;

    let html = "";
    let count = 0;

    recipes.forEach((data) => {
        // Check for unverified recipes (false, null, or missing)
        if (data.reviewed !== true && data.reviewed !== "true") {
            count++;
            
            // 1. SMART DATA FINDER: Check both naming styles
            let rawIng = data.ingredients || data.recipeIngredient;
            let rawInst = data.instructions || data.recipeInstructions;

            // 2. Format Ingredients
            let ingDisplay = "No ingredients listed";
            if (Array.isArray(rawIng) && rawIng.length > 0) {
                ingDisplay = rawIng.join('\n');
            } else if (typeof rawIng === 'string' && rawIng.trim().length > 0) {
                ingDisplay = rawIng;
            }

            // 3. Format Instructions
            let instDisplay = "No instructions listed";
            if (Array.isArray(rawInst) && rawInst.length > 0) {
                instDisplay = rawInst.join('\n');
            } else if (typeof rawInst === 'string' && rawInst.trim().length > 0) {
                instDisplay = rawInst;
            }

            html += `
                <div id="unrev-${data.id}" style="background: white; border: 2px solid #fbbf24; border-radius: 8px; margin-bottom: 12px;">
                    
                    <div style="padding: 12px; display: flex; justify-content: space-between; align-items: center; background: #fffbeb; border-bottom: 1px solid #fbbf24;">
                        <div>
                            <span style="font-weight: 800; color: #92400e; font-size: 15px; display: block;">${data.name || "Untitled"}</span>
                            <span style="font-size: 12px; color: #b45309;">From: ${data.author || "Unknown"}</span>
                        </div>
                        <button onclick="quickReview('${data.id}')" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;">
                            ✅ Verify
                        </button>
                    </div>

                    <details>
                        <summary style="padding: 12px; cursor: pointer; color: #2563eb; font-weight: bold; font-size: 13px; background: white;">
                            👉 Click here to view Ingredients & Instructions
                        </summary>
                        
                        <div style="padding: 15px; border-top: 1px solid #eee; background: #f9fafb;">
                            <p style="margin: 0 0 5px 0; font-weight: bold; color: #666;">Ingredients:</p>
                            <pre style="background: white; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; white-space: pre-wrap; margin-bottom: 15px;">${ingDisplay}</pre>
                            
                            <p style="margin: 0 0 5px 0; font-weight: bold; color: #666;">Instructions:</p>
                            <pre style="background: white; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; white-space: pre-wrap;">${instDisplay}</pre>
                        </div>
                    </details>
                </div>`;
        }
    });

    if (count === 0) {
        list.innerHTML = "<p style='color: green; font-weight: bold; text-align:center; padding: 20px;'>All recipes verified! 🎉</p>";
    } else {
        list.innerHTML = html;
    }
}

// D. RECIPE MANAGER
// --- CONFIGURATION ---
const VALID_CATEGORIES = [
    "Appetizers & Snacks",
    "Breads & Rolls",
    "Breakfast",
    "Desserts",
    "Dutch Oven",
    "Main Dishes",
    "Miscellaneous",
    "Sauces, Dressings & Marinades",
    "Sides, Veggies & Breads",
    "Soups & Salads",
    "Vegetables & Sides" 
];

function renderRecipeManager(recipes) {
    const list = document.getElementById('manager-list');
    if(!list) return;

    // Sort Alphabetically
    recipes.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    let html = "";
    recipes.forEach(r => {
        const isHidden = r.isHidden === true;
        const opacity = isHidden ? "0.6" : "1";
        const bg = isHidden ? "#f3f4f6" : "white";
        
        // Detect Category
        let currentCat = "Miscellaneous";
        if (r.tags && Array.isArray(r.tags) && r.tags.length > 0) currentCat = r.tags[0]; 
        else if (typeof r.tags === 'string') currentCat = r.tags;
        else if (r.category) currentCat = r.category;

        // Build Dropdown
        let optionsHtml = "";
        VALID_CATEGORIES.forEach(cat => {
            const isSelected = cat === currentCat ? "selected" : "";
            optionsHtml += `<option value="${cat}" ${isSelected}>${cat}</option>`;
        });

        html += `
            <div style="display: flex; flex-direction: column; padding: 10px; background: ${bg}; border: 1px solid #eee; border-radius: 6px; opacity: ${opacity}; gap: 5px; margin-bottom: 5px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 14px; font-weight: bold; color: #333;">${r.name || "Untitled"}</span>
                    <button onclick="toggleVisibility('${r.id}', ${isHidden})" style="background: ${isHidden ? '#ef4444' : '#10b981'}; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; min-width: 60px;">
                        ${isHidden ? "❌ Hidden" : "👁️ Live"}
                    </button>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 11px; color: #666;">Category:</span>
                    <select onchange="updateCategory('${r.id}', this)" style="flex-grow: 1; padding: 4px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; background: white;">
                        ${optionsHtml}
                    </select>
                </div>
            </div>`;
    });

    list.innerHTML = html || "<p>No recipes found.</p>";
}

// ==========================================
// 5. GLOBAL ACTIONS (Buttons)
// ==========================================

// Approve Queue
window.approveRecipe = async function(pendingId) {
    if(!confirm("Publish this recipe?")) return;
    try {
        const pendingRef = doc(db, "pending_recipes", pendingId);
        const snapshot = await getDoc(pendingRef);
        const data = snapshot.data();
        
        await addDoc(collection(db, "recipes"), { ...data, reviewed: true, createdAt: new Date() });
        await addDoc(collection(db, "announcements"), {
            message: `<strong>New Recipe!</strong> ${data.author} just added <em>${data.name}</em>.`,
            type: "new_recipe",
            timestamp: serverTimestamp()
        });
        await deleteDoc(pendingRef);
        document.getElementById(`card-${pendingId}`).remove();
    } catch (error) { console.error(error); alert(error.message); }
};

// Reject Queue
window.rejectRecipe = async function(pendingId) {
    if(!confirm("Delete this submission?")) return;
    try {
        await deleteDoc(doc(db, "pending_recipes", pendingId));
        document.getElementById(`card-${pendingId}`).remove();
    } catch (error) { console.error(error); alert(error.message); }
};

// Resolve Report
window.resolveIssue = async function(docId) {
    if(!confirm("Delete this report?")) return;
    try {
        await deleteDoc(doc(db, "recipe_reports", docId));
        loadReports(); 
    } catch (error) { console.error(error); }
};

// Quick Review
window.quickReview = async function(recipeId) {
    if(!confirm("Mark as Reviewed?")) return;
    try {
        await updateDoc(doc(db, "recipes", recipeId), { reviewed: true });
        const item = document.getElementById(`unrev-${recipeId}`);
        if(item) item.remove();
        // If empty now, refresh view
        if(document.getElementById('unreviewed-list').children.length === 0) renderUnreviewed(allRecipeData);
    } catch (error) { console.error(error); alert("Error updating."); }
};

// Toggle Visibility
window.toggleVisibility = async function(id, currentStatus) {
    const newStatus = !currentStatus;
    if(!confirm(`${newStatus ? "HIDE" : "PUBLISH"} this recipe?`)) return;
    try {
        await updateDoc(doc(db, "recipes", id), { isHidden: newStatus });
        // Update local data so we don't need to refresh page
        const recipe = allRecipeData.find(r => r.id === id);
        if(recipe) recipe.isHidden = newStatus;
        renderRecipeManager(allRecipeData); 
    } catch (error) { console.error(error); alert("Could not update."); }
};

// Update Category
window.updateCategory = async function(id, selectElement) {
    const newCat = selectElement.value;
    selectElement.style.background = "#fef9c3";
    try {
        await updateDoc(doc(db, "recipes", id), { tags: [newCat], category: newCat });
        // Update local data
        const recipe = allRecipeData.find(r => r.id === id);
        if(recipe) { recipe.tags = [newCat]; recipe.category = newCat; }
        
        selectElement.style.background = "#d1fae5";
        setTimeout(() => selectElement.style.background = "white", 1000);
    } catch (error) {
        console.error(error);
        selectElement.style.background = "#fee2e2";
        alert("Failed to save.");
    }
};

// Post Announcement
window.postAnnouncement = async function() {
    const input = document.getElementById('announce-input');
    if (!input) return;
    const message = input.value.trim();
    if (!message) return alert("Type a message first.");
    if(!confirm("Post to homepage?")) return;

    try {
        await addDoc(collection(db, "announcements"), {
            message: message, type: "alert", timestamp: serverTimestamp()
        });
        alert("Posted!");
        input.value = ""; 
    } catch (error) { console.error(error); alert(error.message); }
};

// Bulk Upload
window.uploadBulkRecipes = async function() {
    const input = document.getElementById('bulk-input');
    const rawText = input.value.trim();
    if (!rawText) return alert("Please paste JSON data.");
    try {
        const recipes = JSON.parse(rawText);
        if (!Array.isArray(recipes)) return alert("Must be a list [...]");
        if (!confirm(`Upload ${recipes.length} recipes?`)) return;

        console.log("🚀 Bulk Upload...");
        let count = 0;
        for (const r of recipes) {
            await addDoc(collection(db, "recipes"), {
                name: r.name || "Untitled", ingredients: r.ingredients || [],
                instructions: r.instructions || "", tags: r.tags || ["Miscellaneous"],
                author: r.author || "Admin", reviewed: true, isHidden: false,
                createdAt: serverTimestamp()
            });
            count++;
        }
        alert(`Success! ${count} added. Refresh to see them.`);
    } catch (error) { console.error(error); alert("Invalid JSON: " + error.message); }
};

// Mega Index Generator (For Cheap Reads)
window.generateMegaIndex = async function() {
    if(!confirm("Update Master Index?")) return;
    try {
        console.log("📥 Reading all recipes...");
        const snapshot = await getDocs(collection(db, "recipes"));
        let megaList = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            megaList.push({
                id: doc.id,
                n: data.name || "Untitled", t: data.tags || [],
                c: data.category || "Misc", a: data.author || "Unknown",
                r: data.reviewed === true
            });
        });
        console.log(`📦 Packing ${megaList.length} recipes...`);
        await setDoc(doc(db, "static_assets", "cookbook_index"), {
            recipes: megaList, updatedAt: serverTimestamp()
        });
        alert(`Success! Index updated.`);
    } catch (e) { console.error("Index Error:", e); alert("Error: " + e.message); }
};

// Load More Activity
window.loadMoreActivity = function() {
    currentActivityLimit += 20; 
    loadAnalytics(allRecipeData); 
};