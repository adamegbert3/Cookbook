import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc, deleteDoc, updateDoc, 
    query, orderBy, limit, where, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// --- CONFIGURATION ---
// ⚠️ PASTE YOUR ADMIN UIDS HERE ⚠️
const ADMIN_UIDS = [
    "n5aAU1g1tBY04Ut0HnhqegSgZe92",
    "NrY491PYN3MIrqJp4rhu5S86w2R2",
    "mPBrypCN9ab1LCEQ578E5YrX8DI2"
];

// Global Variables
let currentActivityLimit = 20; 
let allRecipeData = []; 

// ==========================================
// 1. SECURITY & STARTUP
// ==========================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        if (ADMIN_UIDS.includes(user.uid)) {
            console.log("Welcome, Chef. Loading Dashboard...");
            loadAdminDashboard(); 
        } else {
            alert("Nice try! You are not an Admin.");
            window.location.href = "index.html"; 
        }
    } else {
        // If the script crashes, this never runs, so you look "logged out"
        window.location.href = "index.html"; 
    }
});

// ==========================================
// 2. THE MAIN LOADER
// ==========================================
async function loadAdminDashboard() {
    console.log("📥 Downloading Database...");
    
    // Load independent widgets
    loadPendingRecipes(); 
    loadReports();

    try {
        // Fetch ALL recipes once
        const querySnapshot = await getDocs(collection(db, "recipes"));
        allRecipeData = []; 
        querySnapshot.forEach(doc => allRecipeData.push({ id: doc.id, ...doc.data() }));
        
        console.log(`✅ Loaded ${allRecipeData.length} recipes.`);

        // --- DISTRIBUTE DATA ---
        // 1. Render the new MASTER LIST (Combines Manager + Review)
        renderUnifiedManager(allRecipeData);      
        
        // 2. Render Stats
        renderDeepStats(allRecipeData);      
        
        // 3. Render Analytics
        loadAnalytics(allRecipeData);      

    } catch (error) {
        console.error("Dashboard Error:", error);
        alert("Error loading dashboard. Check console.");
    }
}

// ==========================================
// 3. UNIFIED RECIPE MANAGER (Master List)
// ==========================================
function renderUnifiedManager(recipes) {
    const list = document.getElementById('unified-list');
    if(!list) return;

    recipes.sort((a, b) => {
        const aRev = a.reviewed === true;
        const bRev = b.reviewed === true;
        if (aRev !== bRev) return aRev ? 1 : -1;
        return (a.name || "").localeCompare(b.name || "");
    });

    let html = `
    <div class="table-container">
        <table class="admin-table">
            <thead>
                <tr>
                    <th style="width: 30%;">Recipe Name</th>
                    <th style="width: 20%;">Author</th>
                    <th style="width: 15%;">Category</th>
                    <th style="width: 15%; text-align: center;">Status</th>
                    <th style="width: 20%; text-align: right;">Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    recipes.forEach(r => {
        const isHidden = r.isHidden === true;
        const isReviewed = r.reviewed === true;
        
        // Status Badges
        let badge = `<span class="status-badge status-live">🟢 Live</span>`;
        if (!isReviewed) badge = `<span class="status-badge status-review">⚠️ Review</span>`;
        else if (isHidden) badge = `<span class="status-badge status-hidden">❌ Hidden</span>`;

        // Category
        let cat = "Misc";
        if (r.tags && Array.isArray(r.tags) && r.tags.length > 0) cat = r.tags[0];
        else if (r.category) cat = r.category;

        // Toggle Button Logic
        const toggleText = isHidden ? "Show" : "Hide";
        const toggleIcon = isHidden ? "👁️" : "🚫";

        html += `
            <tr>
                <td>${r.name || "Untitled"}</td>
                <td>${r.author || "Unknown"}</td>
                <td>${cat}</td>
                <td style="text-align: center;">${badge}</td>
                <td>
                    <div style="display: flex; gap: 5px; justify-content: flex-end;">
                        <a href="edit-recipe.html?id=${r.id}" class="btn-action btn-edit">
                            ✏️ Edit
                        </a>
                        
                        <button onclick="toggleVisibility('${r.id}', ${isHidden})" class="btn-action btn-toggle">
                            ${toggleIcon} ${toggleText}
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;
    list.innerHTML = html || "<div style='padding:20px; text-align:center'>No recipes found.</div>";
}

// ==========================================
// 4. INDEPENDENT WIDGETS
// ==========================================

// PENDING RECIPES (From submissions)
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
                    <div class="pending-actions">
                        <button class="btn-approve" onclick="approveRecipe('${doc.id}')">✅ Approve</button>
                        <button class="btn-reject" onclick="rejectRecipe('${doc.id}')">❌ Reject</button>
                    </div>
                </div>
            `;
        });
        listContainer.innerHTML = html;
    } catch (error) { console.error("Error loading queue:", error); }
}

// USER REPORTS
async function loadReports() {
    const list = document.getElementById('issues-list');
    if(!list) return;
    try {
        const q = query(collection(db, "recipe_reports"), orderBy("timestamp", "desc"));
        const snapshot = await getDocs(q);
        if (snapshot.empty) { list.innerHTML = "<p>No issues reported!</p>"; return; }

        let html = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            html += `
                <div style="background: #fff5f5; padding: 10px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #feb2b2;">
                    <strong>${data.recipeName}</strong>: "${data.issue}"
                    <button onclick="resolveIssue('${doc.id}')" style="float:right;">✅</button>
                </div>`;
        });
        list.innerHTML = html;
    } catch (error) { console.error("Error loading reports:", error); }
}

// ANALYTICS & UNDISCOVERED
async function loadAnalytics(allRecipes) {
    const activityList = document.getElementById('activity-list');
    const leaderboardList = document.getElementById('leaderboard-list');

    try {
        // Increased limit to 50 since we removed the "Load More" button
        const q = query(collection(db, "recipe_views"), orderBy("timestamp", "desc"), limit(50));
        const snapshot = await getDocs(q);
        
        let activityHtml = "";
        const viewCounts = {}; 

        snapshot.forEach(doc => {
            const data = doc.data();
            
            // --- TIME FORMATTING ---
            let timeStr = "Recently";
            if (data.timestamp) {
                const date = data.timestamp.toDate();
                // Format: "Oct 24, 4:30 PM"
                timeStr = date.toLocaleDateString() + ", " + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            }
            // -----------------------

            activityHtml += `
                <div style="padding: 10px; border-bottom: 1px solid #f3f4f6; font-size: 13px;">
                    <div style="margin-bottom: 4px;">
                        <strong>${data.viewer}</strong> viewed 
                        <a href="edit-recipe.html?id=${data.recipeId}" style="color: #10b981; font-weight: bold; text-decoration: none;">
                            ${data.recipeTitle}
                        </a>
                    </div>
                    <div style="color: #9ca3af; font-size: 11px;">🕒 ${timeStr}</div>
                </div>`;

            const title = data.recipeTitle || "Unknown Recipe";
            viewCounts[title] = (viewCounts[title] || 0) + 1;
        });

        if(activityList) activityList.innerHTML = activityHtml || "<p style='padding:10px; color:#999;'>No activity yet.</p>";

        // Leaderboard Logic (Unchanged)
        if(leaderboardList) {
            const sortedRecipes = Object.entries(viewCounts)
                .sort(([,countA], [,countB]) => countB - countA)
                .slice(0, 5); 
            let lbHtml = "";
            sortedRecipes.forEach(([title, count]) => {
                lbHtml += `<tr><td style="padding: 8px 5px; border-bottom: 1px solid #eee;">${title}</td><td style="font-weight: bold; border-bottom: 1px solid #eee;">${count}</td></tr>`;
            });
            leaderboardList.innerHTML = lbHtml || "<tr><td>No data</td></tr>";
        }

        renderDustyRecipes(allRecipes, viewCounts);

    } catch (error) { console.error("Error loading analytics:", error); }
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
            html += `<div style="padding: 5px 0; border-bottom: 1px solid #eee; font-size: 13px;">${title}</div>`;
        }
    });
    dustyList.innerHTML = (count === 0) ? "<p style='color:green;'>All viewed!</p>" : html;
}

// DEEP STATS
function renderDeepStats(recipes) {
    const cookCountEl = document.getElementById('total-cooks-count');
    getDocs(collection(db, "global_cooks")).then(snap => {
        if(cookCountEl) cookCountEl.innerText = snap.size.toLocaleString();
    }).catch(e => console.error(e));

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
            <div style="margin-bottom: 5px;">
                <div style="display: flex; justify-content: space-between; font-size: 12px;">
                    <strong>${catName}</strong> <span>${count}</span>
                </div>
                <div style="width: 100%; background: #f3f4f6; height: 6px; border-radius: 4px;">
                    <div style="width: ${percent}%; background: #59c3c3; height: 100%;"></div>
                </div>
            </div>`;
    });
    catListEl.innerHTML = html;
}

// ==========================================
// 5. ACTIONS & BUTTONS
// ==========================================

window.approveRecipe = async function(pendingId) {
    if(!confirm("Publish this recipe?")) return;
    try {
        const pendingRef = doc(db, "pending_recipes", pendingId);
        const snapshot = await getDoc(pendingRef);
        const data = snapshot.data();
        await addDoc(collection(db, "recipes"), { ...data, reviewed: true, createdAt: new Date() });
        await deleteDoc(pendingRef);
        document.getElementById(`card-${pendingId}`).remove();
    } catch (error) { alert(error.message); }
};

window.rejectRecipe = async function(pendingId) {
    if(!confirm("Delete this submission?")) return;
    try {
        await deleteDoc(doc(db, "pending_recipes", pendingId));
        document.getElementById(`card-${pendingId}`).remove();
    } catch (error) { alert(error.message); }
};

window.resolveIssue = async function(docId) {
    if(!confirm("Delete report?")) return;
    try {
        await deleteDoc(doc(db, "recipe_reports", docId));
        loadReports(); 
    } catch (error) { console.error(error); }
};

window.postAnnouncement = async function() {
    const input = document.getElementById('announce-input');
    if (!input || !input.value.trim()) return alert("Type a message first.");
    if(!confirm("Post to homepage?")) return;
    try {
        await addDoc(collection(db, "announcements"), {
            message: input.value.trim(), type: "alert", timestamp: serverTimestamp()
        });
        alert("Posted!");
        input.value = ""; 
    } catch (error) { alert(error.message); }
};

window.generateMegaIndex = async function() {
    if(!confirm("Update Master Index?")) return;
    try {
        console.log("Reading all recipes...");
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
        await setDoc(doc(db, "static_assets", "cookbook_index"), {
            recipes: megaList, updatedAt: serverTimestamp()
        });
        alert(`Success! Index updated.`);
    } catch (e) { alert("Error: " + e.message); }
};

window.loadMoreActivity = function() {
    currentActivityLimit += 20; 
    loadAnalytics(allRecipeData); 
};

// CLEAN BULK UPLOAD
window.uploadBulkRecipes = async function() {
    const input = document.getElementById('bulk-input');
    const rawText = input.value.trim();
    if (!rawText) return alert("Please paste JSON data.");

    try {
        const recipes = JSON.parse(rawText);
        if (!Array.isArray(recipes)) return alert("Must be a list [...]");
        if (!confirm(`Upload ${recipes.length} recipes?`)) return;

        console.log("🚀 Starting Bulk Upload...");
        let count = 0;
        for (const r of recipes) {
            const cleanRecipe = {
                name: r.name,
                author: r.author,
                tags: r.tags,
                recipeIngredient: r.recipeIngredient || r.ingredients,
                recipeInstructions: r.recipeInstructions || r.instructions,
                reviewed: false 
            };
            await addDoc(collection(db, "recipes"), cleanRecipe);
            count++;
        }
        alert(`Success! ${count} recipes added.`);
        input.value = ""; 
    } catch (error) { alert("Invalid JSON: " + error.message); }
};

// STATS MODAL
window.openStatsModal = function() {
    const modal = document.getElementById('stats-modal'); // Make sure ID matches HTML
    if (modal) {
        modal.style.display = 'flex';
        renderDeepStats(allRecipeData);
    } else {
        // Fallback if user named it statsModal (camelCase)
        const alt = document.getElementById('statsModal');
        if(alt) alt.style.display = 'flex';
    }
};

window.closeStatsModal = function() {
    const modal = document.getElementById('stats-modal');
    if (modal) modal.style.display = 'none';
    const alt = document.getElementById('statsModal');
    if(alt) alt.classList.add('hidden'); // For your specific HTML style
};
// Toggle Visibility (Hide/Show)
window.toggleVisibility = async function(id, currentStatus) {
    const newStatus = !currentStatus;
    const actionWord = newStatus ? "HIDE" : "PUBLISH";
    
    if(!confirm(`${actionWord} this recipe?`)) return;

    try {
        await updateDoc(doc(db, "recipes", id), { isHidden: newStatus });
        
        // 1. Update local data so we don't need a reload
        const recipe = allRecipeData.find(r => r.id === id);
        if(recipe) recipe.isHidden = newStatus;
        
        // 2. Re-render the list immediately to show the change
        renderUnifiedManager(allRecipeData); 
        
    } catch (error) {
        console.error(error);
        alert("Could not update visibility.");
    }
};