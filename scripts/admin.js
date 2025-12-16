import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, deleteDoc,
    query, orderBy, limit, where
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// --- CONFIGURATION ---
// REPLACE THIS WITH YOUR ACTUAL UID!
const MY_ADMIN_ID = "n5aAU1g1tBY04Ut0HnhqegSgZe92"; 

const listContainer = document.getElementById('pending-list');
const loadingDiv = document.getElementById('loading');
// Global Variables
let currentActivityLimit = 20; 
let allRecipeData = []; // For the full report modal

// ==========================================
// 1. SECURITY & STARTUP
// ==========================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        if (user.uid === MY_ADMIN_ID) {
            console.log("Welcome, Chef. Loading Dashboard...");
            
            // --- LOAD ALL WIDGETS ---
            loadPendingRecipes();     // 1. The Queue
            loadAnalytics();          // 2. Popular + Activity + Undiscovered
            loadReports();            // 3. User Reports
            loadDeepStats();          // 4. Total Cooks + Category Breakdown
            loadUnreviewedRecipes();  // 5. "Needs Review" List

        } else {
            alert("Nice try! You are not the Admin.");
            window.location.href = "index.html"; 
        }
    } else {
        window.location.href = "index.html"; 
    }
});

// ==========================================
// 2. RECIPE QUEUE (Left Column)
// ==========================================
async function loadPendingRecipes() {
    const loadingDiv = document.getElementById('loading');
    const listContainer = document.getElementById('pending-list');
    
    try {
        const querySnapshot = await getDocs(collection(db, "pending_recipes"));
        
        if (querySnapshot.empty) {
            loadingDiv.innerText = "No pending recipes! Good job, Chef.";
            return;
        }

        loadingDiv.style.display = 'none';
        let html = '';

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const recipeTitle = data.name || data.title || "Untitled";
            const recipeChef = data.author || data.chef || "Unknown";
            const recipeDesc = data.notes || data.description || "No notes.";

            html += `
                <div class="pending-card" id="card-${doc.id}">
                    <div class="pending-header">
                        <h2>${recipeTitle}</h2>
                        <span style="color: #666; font-size: 12px;">Submitted by: ${recipeChef}</span>
                    </div>
                    <div style="margin: 10px 0;"><strong>Notes:</strong> ${recipeDesc}</div>
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
        loadingDiv.innerText = "Error loading data.";
    }
}

// ==========================================
// 3. ANALYTICS (Right Column)
// ==========================================

// A. POPULAR + ACTIVITY + UNDISCOVERED
async function loadAnalytics() {
    const activityList = document.getElementById('activity-list');
    const leaderboardList = document.getElementById('leaderboard-list');

    try {
        // 1. FETCH ACTIVITY
        const q = query(
            collection(db, "recipe_views"), 
            orderBy("timestamp", "desc"), 
            limit(currentActivityLimit)
        );
        const snapshot = await getDocs(q);
        
        let activityHtml = "";
        const viewCounts = {}; // Used for Leaderboard & Undiscovered

        snapshot.forEach(doc => {
            const data = doc.data();
            
            // Build Feed
            const timeStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : "Recently";
            activityHtml += `
                <div style="padding: 10px; background: #f9fafb; border-radius: 6px; font-size: 13px;">
                    <strong>${data.viewer}</strong> viewed <br>
                    <span style="color: #10b981; font-weight: bold;">${data.recipeTitle}</span>
                    <div style="color: #999; font-size: 11px; margin-top: 4px;">${timeStr}</div>
                </div>
            `;

            // Count for Leaderboard
            const title = data.recipeTitle || "Unknown Recipe";
            if (viewCounts[title]) viewCounts[title]++;
            else viewCounts[title] = 1;
        });

        activityList.innerHTML = activityHtml || "<p>No activity yet.</p>";

        // 2. BUILD LEADERBOARD
        const sortedRecipes = Object.entries(viewCounts)
            .sort(([,countA], [,countB]) => countB - countA)
            .slice(0, 5); 

        let leaderboardHtml = "";
        sortedRecipes.forEach(([title, count]) => {
            leaderboardHtml += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px;">${title}</td>
                    <td style="padding: 8px; font-weight: bold; color: #10b981;">${count}</td>
                </tr>
            `;
        });
        leaderboardList.innerHTML = leaderboardHtml || "<tr><td colspan='2'>No data</td></tr>";

        // 3. TRIGGER UNDISCOVERED CALCULATION
        loadDustyRecipes(viewCounts);

    } catch (error) {
        console.error("Error loading analytics:", error);
    }
}

// B. TOTAL COOKS + CATEGORY BREAKDOWN
// B. TOTAL COOKS + CATEGORY BREAKDOWN
async function loadDeepStats() {
    // 1. TOTAL COOKS
    const cookCountEl = document.getElementById('total-cooks-count');
    try {
        const cooksSnap = await getDocs(collection(db, "global_cooks"));
        if(cookCountEl) cookCountEl.innerText = cooksSnap.size.toLocaleString(); 
    } catch (error) {
        console.error("Error getting cooks:", error);
        if(cookCountEl) cookCountEl.innerText = "0";
    }

    // 2. RECIPE BREAKDOWN (FIXED!)
    const catListEl = document.getElementById('category-stats-list');
    try {
        const recipesSnap = await getDocs(collection(db, "recipes"));
        const totalRecipes = recipesSnap.size;
        const categoryCounts = {};

        recipesSnap.forEach(doc => {
            const data = doc.data();
            
            // --- THE FIX IS HERE ---
            // We look for 'tags' first. If it's an array (["Dessert"]), take the first item.
            let cat = "Uncategorized";
            
            if (data.tags) {
                if (Array.isArray(data.tags) && data.tags.length > 0) {
                    cat = data.tags[0]; // Grab "Desserts" from ["Desserts"]
                } else if (typeof data.tags === 'string') {
                    cat = data.tags;
                }
            } 
            // Fallbacks just in case
            else if (data.category) cat = data.category;
            else if (data.folder) cat = data.folder;

            // Count it
            if (categoryCounts[cat]) categoryCounts[cat]++;
            else categoryCounts[cat] = 1;
        });

        // Sort by count (Most popular categories first)
        const sortedCats = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
        
        let html = "";
        sortedCats.forEach(([catName, count]) => {
            const percent = Math.round((count / totalRecipes) * 100);
            html += `
                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 3px;">
                        <strong>${catName}</strong>
                        <span style="color:#666;">${count} recipes (${percent}%)</span>
                    </div>
                    <div style="width: 100%; background: #f3f4f6; height: 8px; border-radius: 4px; overflow: hidden;">
                        <div style="width: ${percent}%; background: #59c3c3; height: 100%;"></div>
                    </div>
                </div>
            `;
        });
        if(catListEl) catListEl.innerHTML = html;

    } catch (error) {
        console.error(error);
        if(catListEl) catListEl.innerHTML = "Error loading categories.";
    }
}

// C. UNDISCOVERED (Dusty) RECIPES
async function loadDustyRecipes(viewCounts) {
    const dustyList = document.getElementById('dusty-list');
    if(!dustyList) return;

    try {
        const recipesSnap = await getDocs(collection(db, "recipes"));
        let dustyHtml = "";
        let count = 0;

        recipesSnap.forEach(doc => {
            const data = doc.data();
            const title = data.name || data.title || "Untitled";
            
            // If this title is NOT in the viewCounts list
            if (!viewCounts[title]) {
                count++;
                dustyHtml += `
                    <div style="padding: 5px 0; border-bottom: 1px solid #eee; font-size: 13px; color: #666;">
                        ${title}
                    </div>
                `;
            }
        });

        if (count === 0) {
            dustyList.innerHTML = "<p style='color:green;'>Wow! Every recipe has been viewed!</p>";
        } else {
            dustyList.innerHTML = dustyHtml;
        }

    } catch (error) {
        console.error("Error finding dusty recipes:", error);
    }
}

// ==========================================
// 4. MAINTENANCE (Unreviewed & Reports)
// ==========================================

// A. UNREVIEWED RECIPES
async function loadUnreviewedRecipes() {
    const list = document.getElementById('unreviewed-list');
    if(!list) return;

    try {
        const querySnapshot = await getDocs(collection(db, "recipes"));
        let html = "";
        let count = 0;

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            // Check if reviewed is false or missing
            if (data.reviewed !== true) {
                count++;
                html += `
                    <div id="unrev-${doc.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; margin-bottom: 5px;">
                        <span style="font-size: 13px; font-weight: bold; color: #92400e;">${data.name}</span>
                        <button onclick="quickReview('${doc.id}')" style="background: #10b981; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">
                            ✅ Verify
                        </button>
                    </div>
                `;
            }
        });

        if (count === 0) {
            list.innerHTML = "<p style='color: green; font-weight: bold;'>All recipes are verified!</p>";
        } else {
            list.innerHTML = html;
        }

    } catch (error) {
        console.error("Error finding unreviewed:", error);
        list.innerHTML = "Error loading list.";
    }
}

// B. USER REPORTS
async function loadReports() {
    const list = document.getElementById('issues-list');
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
// 5. BUTTON ACTIONS (Global Functions)
// ==========================================

// Approve Queue
window.approveRecipe = async function(pendingId) {
    if(!confirm("Publish this recipe?")) return;
    try {
        const pendingRef = doc(db, "pending_recipes", pendingId);
        const snapshot = await getDoc(pendingRef);
        const data = snapshot.data();
        await addDoc(collection(db, "recipes"), { ...data, reviewed: true, createdAt: new Date() });
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

// Quick Review (Verify)
window.quickReview = async function(recipeId) {
    if(!confirm("Mark as Reviewed?")) return;
    try {
        await updateDoc(doc(db, "recipes", recipeId), { reviewed: true });
        const item = document.getElementById(`unrev-${recipeId}`);
        if(item) item.remove();
        // Refresh list if empty
        if(document.getElementById('unreviewed-list').children.length === 0) {
            loadUnreviewedRecipes();
        }
    } catch (error) { console.error(error); alert("Error updating."); }
};

// Load More Activity
window.loadMoreActivity = function() {
    currentActivityLimit += 20; 
    loadAnalytics(); 
};

// Reset Stats
window.resetStats = async function() {
    if (!confirm("⚠️ RESET ALL STATS?\n\nThis deletes ALL view history. Cannot be undone.")) return;
    try {
        const q = query(collection(db, "recipe_views"));
        const snapshot = await getDocs(q);
        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        alert("Stats cleared!");
        location.reload(); 
    } catch (error) { console.error(error); alert("Error: " + error.message); }
};

// Full Report Modal
window.openStatsModal = async function() {
    document.getElementById('statsModal').classList.remove('hidden');
    const list = document.getElementById('full-stats-list');
    list.innerHTML = "<p>Loading...</p>";

    try {
        const recipesSnap = await getDocs(collection(db, "recipes"));
        const viewsSnap = await getDocs(collection(db, "recipe_views"));

        const statsMap = {};
        recipesSnap.forEach(doc => {
            const data = doc.data();
            const name = data.name || data.title || "Untitled";
            statsMap[name] = { id: doc.id, name: name, author: data.author || "Unknown", views: 0 };
        });

        viewsSnap.forEach(doc => {
            const data = doc.data();
            const name = data.recipeTitle;
            if (statsMap[name]) statsMap[name].views++;
        });

        allRecipeData = Object.values(statsMap);
        renderStats('views');
    } catch (error) { console.error(error); list.innerHTML = "Error loading stats."; }
};

window.closeStatsModal = function() {
    document.getElementById('statsModal').classList.add('hidden');
};

window.renderStats = function(mode) {
    const list = document.getElementById('full-stats-list');
    let html = '<table style="width:100%; border-collapse: collapse;">';
    
    html += `<tr style="background: #f9fafb; text-align: left;"><th style="padding: 10px;">Recipe</th><th style="padding: 10px;">Chef</th><th style="padding: 10px; text-align: right;">${mode==='views'?'Views':'Submissions'}</th></tr>`;

    if (mode === 'views') {
        const sortedData = [...allRecipeData].sort((a, b) => b.views - a.views);
        document.getElementById('tab-views').style.background = '#e0f2fe';
        document.getElementById('tab-chefs').style.background = 'white';
        
        sortedData.forEach(item => {
            const color = item.views === 0 ? '#ef4444' : (item.views > 10 ? '#10b981' : '#333');
            html += `<tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px;">${item.name}</td><td style="padding: 10px; color: #666;">${item.author}</td><td style="padding: 10px; text-align: right; font-weight: bold; color: ${color};">${item.views}</td></tr>`;
        });
    } 
    else if (mode === 'chefs') {
        document.getElementById('tab-views').style.background = 'white';
        document.getElementById('tab-chefs').style.background = '#e0f2fe';
        
        const chefCounts = {};
        allRecipeData.forEach(r => {
            if(!chefCounts[r.author]) chefCounts[r.author] = 0;
            chefCounts[r.author]++;
        });
        const sortedChefs = Object.entries(chefCounts).sort((a, b) => b[1] - a[1]);
        sortedChefs.forEach(([author, count]) => {
             html += `<tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px;">${author}</td><td style="padding: 10px;"></td><td style="padding: 10px; text-align: right; font-weight: bold;">${count}</td></tr>`;
        });
    }
    html += '</table>';
    list.innerHTML = html;
};