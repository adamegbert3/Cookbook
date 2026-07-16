import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc, deleteDoc, updateDoc, 
    query, orderBy, limit, where, serverTimestamp, 
    arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// --- CONFIGURATION ---
const ADMIN_UIDS = [
    "n5aAU1g1tBY04Ut0HnhqegSgZe92",
    "NrY491PYN3MIrqJp4rhu5S86w2R2",
    "mPBrypCN9ab1LCEQ578E5YrX8DI2"
];

// Global Variables
let currentActivityLimit = 50; 
let allRecipeData = []; 

onAuthStateChanged(auth, (user) => {
    console.log("🔐 [AUTH STATE CHANGED] Fired!");
    
    if (user) {
        console.log("👤 [AUTH SUCCESS] Logged in as:", user.email);
        console.log("🆔 [AUTH UID]:", user.uid);
        console.log("📋 [ADMIN LIST]:", ADMIN_UIDS);
        
        const isAdmin = ADMIN_UIDS.includes(user.uid);
        console.log("🛡️ [IS ADMIN?]:", isAdmin);

        if (isAdmin) {
            console.log("👨‍🍳 Welcome, Chef! Initializing Dashboard...");
            loadAdminDashboard(); 
            loadReportedIssues();
        } else {
            console.warn("⚠️ [ACCESS DENIED] User is logged in, but UID is not in ADMIN_UIDS!");
            // Comment out the redirect temporarily so you can read the console!
            // window.location.href = "index.html"; 
        }
    } else {
        console.error("❌ [AUTH FAIlED] No user detected. Acting as logged out.");
        // Comment out the redirect temporarily so we can debug!
        // window.location.href = "index.html"; 
    }
});

async function loadAdminDashboard() {
    console.log("📥 [DASHBOARD] Starting database fetch...");
    loadPendingRecipes(); 
    loadReports();

    try {
        console.log("⏳ [FIRESTORE] Querying 'recipes' collection...");
        const querySnapshot = await getDocs(collection(db, "recipes"));
        
        console.log(`✅ [FIRESTORE SUCCESS] Snapshot received! Empty? ${querySnapshot.empty}`);
        console.log(`📊 [FIRESTORE COUNT] Found ${querySnapshot.size} documents.`);

        allRecipeData = []; 
        querySnapshot.forEach(doc => {
            allRecipeData.push({ id: doc.id, ...doc.data() });
        });
        
        console.log("🚀 [RENDER] Passing data to renderUnifiedManager...");
        renderUnifiedManager(allRecipeData);      
        renderDeepStats(allRecipeData);      
        loadAnalytics(allRecipeData);   

        // Activating Search
        const searchInput = document.getElementById('manager-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                applyAdminFilters();
            });
        }
    } catch (error) {
        console.error("🔥 [DASHBOARD CRITICAL ERROR]:", error);
        console.error("Error Code:", error.code);
        console.error("Error Message:", error.message);
    }
}

// ==========================================
// 3. MASTER RECIPE MANAGER (v7 - CLEAN FIX)
// ==========================================
function renderUnifiedManager(recipes) {
    console.log("🚀 Rendering Unified Manager v7 (Separated Columns)");
    
    const list = document.getElementById('unified-list');
    if(!list) return;

    recipes.sort((a, b) => {
        const aRev = a.reviewed === true;
        const bRev = b.reviewed === true;
        if (aRev !== bRev) return aRev ? 1 : -1;
        return (a.name || "").localeCompare(b.name || "");
    });

    // 🚀 THE SPEED FIX: Limit the table to 50 rows initially
    const recipesToRender = recipes.slice(0, 50);

    let html = `
    <div class="table-container">
        <table class="admin-table">
            <thead>
                <tr>
                    <th style="width: 30%;">Recipe Name</th>
                    <th style="width: 15%;">Author</th>
                    <th style="width: 15%;">Category</th>
                    <th style="width: 10%; text-align: center;">Views</th>
                    <th style="width: 10%; text-align: center;">Status</th>
                    <th style="width: 20%; text-align: right;">Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    recipes.forEach(r => {
        const isHidden = r.isHidden === true;
        const isReviewed = r.reviewed === true;
        const viewCount = r.views || 0; 
        
        let badge = `<span class="status-badge status-live">🟢 Live</span>`;
        if (!isReviewed) badge = `<span class="status-badge status-review">⚠️ Review</span>`;
        else if (isHidden) badge = `<span class="status-badge status-hidden">❌ Hidden</span>`;

        let cat = "Misc";
        if (r.tags && Array.isArray(r.tags) && r.tags.length > 0) cat = r.tags[0];
        else if (r.category) cat = r.category;

        const toggleText = isHidden ? "Show" : "Hide";
        const toggleIcon = isHidden ? "👁️" : "🚫";

        html += '<tr>';
        html += `<td><strong>${r.name || "Untitled"}</strong></td>`;
        html += `<td>${r.author || "Unknown"}</td>`;
        html += `<td>${cat}</td>`;
        html += `<td style="text-align: center; color: #666;">${viewCount}</td>`;
        
        // COLUMN 5: BADGE ONLY
        html += `<td style="text-align: center;">${badge}</td>`;
        
        // Check existing tags to style our quick-buttons automatically
        const currentTags = r.tags || [];
        const isEgb = currentTags.includes("Egbert Favorite");
        const isWhl = currentTags.includes("Wheeler Favorite");

        // COLUMN 6: BUTTONS ONLY (Now with Hall of Fame Toggles!)
        html += `<td>
                    <div style="display: flex; gap: 4px; justify-content: flex-end; flex-wrap: wrap; align-items: center;">
                        <button onclick="quickTag('${r.id}', 'Egbert Favorite', ${isEgb})" class="btn-action" style="background: ${isEgb ? '#0284c7' : '#f0f9ff'}; color: ${isEgb ? '#ffffff' : '#0369a1'}; border: 1px solid #bae6fd; font-weight: 800;" title="Toggle Egbert Favorite">
                            ${isEgb ? '★ Egb' : '☆ Egb'}
                        </button>
                        <button onclick="quickTag('${r.id}', 'Wheeler Favorite', ${isWhl})" class="btn-action" style="background: ${isWhl ? '#16a34a' : '#f0fdf4'}; color: ${isWhl ? '#ffffff' : '#15803d'}; border: 1px solid #bbf7d0; font-weight: 800;" title="Toggle Wheeler Favorite">
                            ${isWhl ? '★ Whl' : '☆ Whl'}
                        </button>
                        <a href="edit-recipe.html?id=${r.id}" class="btn-action btn-edit">✏️ Edit</a>
                        <button onclick="toggleVisibility('${r.id}', ${isHidden})" class="btn-action btn-toggle">${toggleIcon} ${toggleText}</button>
                        <button onclick="deleteRecipe('${r.id}', '${r.name?.replace(/'/g, "\\'")}')" class="btn-action btn-delete">🗑️</button>
                    </div>
                 </td>`;
        html += '</tr>';
    });

    html += `</tbody></table></div>`;
    list.innerHTML = html || "<div style='padding:20px; text-align:center'>No recipes found.</div>";
}

// ACTION FUNCTIONS
window.deleteRecipe = async function(id, recipeName) {
    if(!confirm(`⚠️ DANGER: Permanently delete "${recipeName}"?`)) return;
    try {
        await deleteDoc(doc(db, "recipes", id));
        allRecipeData = allRecipeData.filter(r => r.id !== id);
        renderUnifiedManager(allRecipeData);
    } catch (error) { alert("Error deleting: " + error.message); }
};

window.toggleVisibility = async function(id, currentStatus) {
    const newStatus = !currentStatus;
    if(!confirm(`${newStatus ? "HIDE" : "PUBLISH"} this recipe?`)) return;
    try {
        await updateDoc(doc(db, "recipes", id), { isHidden: newStatus });
        const recipe = allRecipeData.find(r => r.id === id);
        if(recipe) recipe.isHidden = newStatus;
        renderUnifiedManager(allRecipeData); 
    } catch (error) { alert("Could not update visibility."); }
};
// ==========================================
// QUICK-TAG HALL OF FAME TOGGLE
// ==========================================
window.quickTag = async function(id, tagString, currentlyHasTag) {
    try {
        const docRef = doc(db, "recipes", id);
        
        // 1. Update Firestore in the background
        if (currentlyHasTag) {
            await updateDoc(docRef, { tags: arrayRemove(tagString) });
        } else {
            await updateDoc(docRef, { tags: arrayUnion(tagString) });
        }

        // 2. Update local memory so we don't have to re-download the whole database!
        const recipe = allRecipeData.find(r => r.id === id);
        if (recipe) {
            if (!recipe.tags) recipe.tags = [];
            if (currentlyHasTag) {
                recipe.tags = recipe.tags.filter(t => t !== tagString);
            } else {
                recipe.tags.push(tagString);
            }
        }

        // 3. Re-render the table instantly to show the new button color
        renderUnifiedManager(allRecipeData);
        
    } catch (error) {
        console.error("Error updating tag:", error);
        alert("Could not update tag: " + error.message);
    }
};

window.syncViewCounts = async function() {
    if(!confirm("Recalculate ALL view counts?")) return;
    const btn = document.getElementById('btn-sync');
    if(btn) btn.innerText = "⏳ Counting...";
    try {
        const snap = await getDocs(collection(db, "recipe_views"));
        const counts = {};
        snap.forEach(doc => {
            const rid = doc.data().recipeId;
            if(rid) counts[rid] = (counts[rid] || 0) + 1;
        });
        for (const [id, count] of Object.entries(counts)) {
            if (allRecipeData.find(r => r.id === id)) {
                await updateDoc(doc(db, "recipes", id), { views: count });
            }
        }
        alert(`Success! Reloading...`);
        location.reload(); 
    } catch (error) { alert("Sync failed: " + error.message); }
};

// HELPERS
async function loadAnalytics(allRecipes) {
    const activityList = document.getElementById('activity-list');
    const leaderboardList = document.getElementById('leaderboard-list');
    try {
        const q = query(collection(db, "recipe_views"), orderBy("timestamp", "desc"), limit(currentActivityLimit));
        const snapshot = await getDocs(q);
        
        let activityHtml = "";
        const viewCounts = {}; 

        snapshot.forEach(doc => {
            const data = doc.data();
            let timeStr = "Recently";
            if (data.timestamp) {
                const date = data.timestamp.toDate();
                timeStr = date.toLocaleDateString() + ", " + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            }
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

        if(activityList) activityList.innerHTML = activityHtml || "<p>No activity yet.</p>";
        if(leaderboardList) {
            const sortedRecipes = Object.entries(viewCounts).sort(([,countA], [,countB]) => countB - countA).slice(0, 5); 
            let lbHtml = "";
            sortedRecipes.forEach(([title, count]) => {
                lbHtml += `<tr><td style="padding: 8px 5px; border-bottom: 1px solid #eee;">${title}</td><td style="font-weight: bold; border-bottom: 1px solid #eee;">${count}</td></tr>`;
            });
            leaderboardList.innerHTML = lbHtml || "<tr><td>No data</td></tr>";
        }
        renderDustyRecipes(allRecipes, viewCounts);
    } catch (error) { console.error("Error loading analytics:", error); }
}

async function loadPendingRecipes() {
    const loadingDiv = document.getElementById('loading');
    const listContainer = document.getElementById('pending-list');
    if(!listContainer) return;
    try {
        const querySnapshot = await getDocs(collection(db, "pending_recipes"));
        if (querySnapshot.empty) { if(loadingDiv) loadingDiv.innerText = "No pending recipes!"; return; }
        if(loadingDiv) loadingDiv.style.display = 'none';
        let html = '';
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            html += `
                <div class="pending-card" id="card-${doc.id}">
                    <div class="pending-header"><h2>${data.name || "Untitled"}</h2><span>${data.author || "Unknown"}</span></div>
                    <div class="pending-actions">
                        <button class="btn-approve" onclick="approveRecipe('${doc.id}')">✅ Approve</button>
                        <button class="btn-reject" onclick="rejectRecipe('${doc.id}')">❌ Reject</button>
                    </div>
                </div>`;
        });
        listContainer.innerHTML = html;
    } catch (error) { console.error(error); }
}

window.approveRecipe = async function(id) {
    if(!confirm("Publish?")) return;
    try {
        const snap = await getDoc(doc(db, "pending_recipes", id));
        await addDoc(collection(db, "recipes"), { ...snap.data(), reviewed: true, createdAt: new Date() });
        await deleteDoc(doc(db, "pending_recipes", id));
        document.getElementById(`card-${id}`).remove();
    } catch (e) { alert(e.message); }
};
window.rejectRecipe = async function(id) {
    if(confirm("Delete?")) { await deleteDoc(doc(db, "pending_recipes", id)); document.getElementById(`card-${id}`).remove(); }
};
window.postAnnouncement = async function() {
    const input = document.getElementById('announce-input');
    if (input.value) { await addDoc(collection(db, "announcements"), { message: input.value, type: "alert", timestamp: serverTimestamp() }); alert("Posted!"); input.value=""; }
};
window.uploadBulkRecipes = async function() {
    const input = document.getElementById('bulk-input');
    try {
        const recipes = JSON.parse(input.value);
        if(confirm(`Upload ${recipes.length}?`)) {
            for(const r of recipes) await addDoc(collection(db, "recipes"), {
                name: r.name, author: r.author, tags: r.tags,
                recipeIngredient: r.recipeIngredient||r.ingredients, recipeInstructions: r.recipeInstructions||r.instructions, reviewed: false
            });
            alert("Done!"); input.value="";
        }
    } catch(e) { alert("Invalid JSON"); }
};
function renderDeepStats(recipes) {
    const cookCountEl = document.getElementById('total-cooks-count');
    getDocs(collection(db, "global_cooks")).then(snap => { if(cookCountEl) cookCountEl.innerText = snap.size.toLocaleString(); });
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
        html += `<div style="margin-bottom:5px;"><div style="display:flex; justify-content:space-between; font-size:12px;"><strong>${catName}</strong><span>${count}</span></div><div style="background:#f3f4f6; height:6px;"><div style="width:${percent}%; background:#59c3c3; height:100%;"></div></div></div>`;
    });
    catListEl.innerHTML = html;
}
function renderDustyRecipes(recipes, viewCounts) {
    const dustyList = document.getElementById('dusty-list');
    if(!dustyList) return;
    let html = "";
    let count = 0;
    recipes.forEach(r => { if (!viewCounts[r.name]) { count++; html += `<div style="padding:5px 0; border-bottom:1px solid #eee; font-size:13px;">${r.name}</div>`; }});
    dustyList.innerHTML = count === 0 ? "<p style='color:green;'>All viewed!</p>" : html;
}
window.loadReports = async function() {
    const list = document.getElementById('issues-list');
    if(!list) return;
    const q = query(collection(db, "recipe_reports"), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    let html = "";
    snap.forEach(doc => { html += `<div style="background:#fff5f5; padding:5px; margin-bottom:5px;">${doc.data().recipeName}: ${doc.data().issue} <button onclick="resolveIssue('${doc.id}')">✅</button></div>`; });
    list.innerHTML = html || "No issues.";
};
window.resolveIssue = async function(id) { if(confirm("Resolve?")) { await deleteDoc(doc(db, "recipe_reports", id)); window.loadReports(); }};
window.openStatsModal = function() { const m = document.getElementById('stats-modal'); if(m) { m.style.display='flex'; renderDeepStats(allRecipeData); }};
window.closeStatsModal = function() { document.getElementById('stats-modal').style.display='none'; };
window.generateMegaIndex = async function() {
    if(!confirm("Update Homepage?")) return;
    
    const snap = await getDocs(collection(db, "recipes"));
    const list = [];
    
    snap.forEach(d => {
        const data = d.data();
        list.push({
            id: d.id, 
            n: data.name || "Untitled",          
            a: data.author || "Family",          // 👨‍🍳 ADDED THIS BACK IN!
            t: data.tags || [],                  
            c: data.category || "Misc",          
            r: data.reviewed || false,           
            h: data.isHidden === true            
        });
    });
    
    console.log("🚀 SAVING THIS TO FIREBASE INDEX:", list);
    
    try {
        await setDoc(doc(db, "static_assets", "cookbook_index"), { recipes: list });
        alert("Index Updated! Authors restored."); 
    } catch (error) {
        console.error("FIREBASE SAVE ERROR:", error);
        alert("Error saving: " + error.message);
    }
};
// --- NEW: ADMIN FILTERING LOGIC ---
let currentAdminCategory = "All";

window.filterAdmin = function(category) {
    currentAdminCategory = category;
    applyAdminFilters();
};

function applyAdminFilters() {
    const searchInput = document.getElementById('manager-search');
    const term = searchInput ? searchInput.value.toLowerCase().trim() : "";
    
    let filtered = allRecipeData;

    // 1. Filter by Category First
    if (currentAdminCategory !== "All") {
        filtered = filtered.filter(r => {
            let cat = "Misc";
            if (r.tags && Array.isArray(r.tags) && r.tags.length > 0) cat = r.tags[0];
            else if (r.category) cat = r.category;
            return cat.includes(currentAdminCategory);
        });
    }

    // 2. Filter by Search Term Second
    if (term) {
        filtered = filtered.filter(r => 
            (r.name || "").toLowerCase().includes(term) || 
            (r.author || "").toLowerCase().includes(term)
        );
    }

    renderUnifiedManager(filtered);
};
// ==========================================
// DATA BACKUP EXPORT
// ==========================================
window.exportRecipes = function() {
    if (!allRecipeData || allRecipeData.length === 0) {
        alert("No recipes loaded to export. Please wait a moment and try again.");
        return;
    }

    if(!confirm(`Download a backup of all ${allRecipeData.length} recipes?`)) return;

    // 1. Convert the recipe array into a nicely formatted JSON string
    const dataStr = JSON.stringify(allRecipeData, null, 2);
    
    // 2. Create a Blob (a file-like object)
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    // 3. Create a temporary invisible link to trigger the download
    const a = document.createElement("a");
    a.href = url;
    
    // Name the file with today's date so you know when you backed it up!
    const date = new Date().toISOString().split('T')[0]; // Gets YYYY-MM-DD
    a.download = `Family_Cookbook_Backup_${date}.json`;
    
    // 4. Click the link and clean up
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
// ==========================================
// REPORTED ISSUES LOGIC
// ==========================================
window.loadReportedIssues = async function() {
    const tbody = document.getElementById('reports-table-body');
    if (!tbody) return;
    
    try {
        const snap = await getDocs(collection(db, "recipe_reports")); 
        
        if (snap.empty) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 15px; color: var(--primary);">No reported issues! 🎉</td></tr>`;
            return;
        }
        
        let html = "";
        snap.forEach(d => {
            const data = d.data();
            
            // 1. Robust Date Parsing (Fixes the "Unknown" bug)
            let dateStr = "Unknown";
            if (data.createdAt) {
                if (typeof data.createdAt.toDate === 'function') {
                    dateStr = data.createdAt.toDate().toLocaleDateString();
                } else if (data.createdAt.seconds) {
                    dateStr = new Date(data.createdAt.seconds * 1000).toLocaleDateString();
                } else {
                    // Fallback for normal string dates
                    dateStr = new Date(data.createdAt).toLocaleDateString(); 
                }
            }

            // 2. Get Reporter Info
            const reporter = data.userName || data.userEmail || "Anonymous";
            
            const recipeId = data.recipeId || "";
            const recipeName = data.recipeName || "View Recipe";
            const issue = data.issue || data.message || data.reason || "No details provided";
            
            html += `
                <tr id="report-${d.id}" style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 10px; color: var(--primary);">${dateStr}</td>
                    <td style="padding: 10px; font-weight: bold; color: var(--accent-teal);">${reporter}</td>
                    <td style="padding: 10px;">
                        <a href="recipe.html?id=${recipeId}" target="_blank" style="color: var(--primary); font-weight: bold; text-decoration: underline;">${recipeName}</a>
                    </td>
                    <td style="padding: 10px; color: var(--primary);">${issue}</td>
                    <td style="padding: 10px;">
                        <button onclick="resolveReport('${d.id}')" class="pill-btn btn-teal" style="padding: 5px 10px; font-size: 12px;">✅ Resolve</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } catch (e) {
        console.error("Error loading reports:", e);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 15px; color: red;">Error loading reports.</td></tr>`;
    }
};

window.resolveReport = async function(reportId) {
    if(!confirm("Mark this issue as resolved and remove it from the list?")) return;
    try {
        const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js");
        await deleteDoc(doc(db, "recipe_reports", reportId));
        
        const row = document.getElementById(`report-${reportId}`);
        if(row) row.remove();
        
        const tbody = document.getElementById('reports-table-body');
        if (tbody && tbody.children.length === 0) {
             tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 15px; color: var(--primary);">No reported issues! 🎉</td></tr>`;
        }
    } catch (e) {
        alert("Error resolving report: " + e.message);
    }
};