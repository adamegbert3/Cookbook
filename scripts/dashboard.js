import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc, deleteDoc, updateDoc, 
    query, orderBy, limit, where, serverTimestamp 
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
    if (user && ADMIN_UIDS.includes(user.uid)) {
        console.log("Welcome, Chef. Loading Dashboard...");
        loadAdminDashboard(); 
    } else {
        window.location.href = "index.html"; 
    }
});

async function loadAdminDashboard() {
    console.log("📥 Downloading Database...");
    loadPendingRecipes(); 
    loadReports();

    try {
        const querySnapshot = await getDocs(collection(db, "recipes"));
        allRecipeData = []; 
        querySnapshot.forEach(doc => allRecipeData.push({ id: doc.id, ...doc.data() }));
        
        console.log(`✅ Loaded ${allRecipeData.length} recipes.`);

        // 1. Initial Render
        renderUnifiedManager(allRecipeData);      
        renderDeepStats(allRecipeData);      
        loadAnalytics(allRecipeData);   

        // 2. ACTIVATING SEARCH & FILTERS
        const searchInput = document.getElementById('manager-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                applyAdminFilters(); // Calls the new unified filter
            });
        }

    } catch (error) {
        console.error("Dashboard Error:", error);
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
        
        // COLUMN 6: BUTTONS ONLY
        html += `<td>
                    <div style="display: flex; gap: 5px; justify-content: flex-end;">
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