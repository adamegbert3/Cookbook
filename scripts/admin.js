import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, deleteDoc 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { query, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

const listContainer = document.getElementById('pending-list');
const loadingDiv = document.getElementById('loading');

// 1. SECURITY: Only allow this page to load if YOU are logged in
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Optional: Check specific UID if you want to be extra safe
        // if(user.uid !== "YOUR_ADMIN_UID") window.location.href = "index.html";
        loadPendingRecipes();
        loadAnalytics();
    } else {
        window.location.href = "index.html"; // Kick out guests
    }
});

async function loadPendingRecipes() {
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
            html += `
                <div class="pending-card" id="card-${doc.id}">
                    <div class="pending-header">
                        <h2>${data.title || "Untitled"}</h2>
                        <span style="color: #666; font-size: 12px;">Submitted by: ${data.chef || "Unknown"}</span>
                    </div>
                    
                    <div><strong>Description:</strong> ${data.description}</div>
                    
                    <details>
                        <summary>View Ingredients</summary>
                        <pre>${data.ingredients}</pre>
                    </details>
                    
                    <details>
                        <summary>View Instructions</summary>
                        <pre>${data.instructions}</pre>
                    </details>

                    <div class="pending-actions">
                        <button class="btn-approve" onclick="approveRecipe('${doc.id}')">✅ Approve & Publish</button>
                        <button class="btn-reject" onclick="rejectRecipe('${doc.id}')">❌ Reject</button>
                    </div>
                </div>
            `;
        });

        listContainer.innerHTML = html;

    } catch (error) {
        console.error("Error loading queue:", error);
        loadingDiv.innerText = "Error loading data. Check console.";
    }
}

// 2. APPROVE FUNCTION
window.approveRecipe = async function(pendingId) {
    if(!confirm("Publish this recipe to the main cookbook?")) return;

    try {
        // A. Get the pending data
        const pendingRef = doc(db, "pending_recipes", pendingId);
        const snapshot = await getDoc(pendingRef);
        const data = snapshot.data();

        // B. Add to MAIN 'recipes' collection
        // We add "reviewed: true" so it gets the Green Checkmark automatically!
        await addDoc(collection(db, "recipes"), {
            ...data,
            reviewed: true,
            createdAt: new Date()
        });

        // C. Delete from Pending
        await deleteDoc(pendingRef);

        // D. Remove from screen
        document.getElementById(`card-${pendingId}`).remove();
        alert("Recipe Published!");

    } catch (error) {
        console.error("Error approving:", error);
        alert("Error: " + error.message);
    }
};

// 3. REJECT FUNCTION
window.rejectRecipe = async function(pendingId) {
    if(!confirm("Are you sure you want to delete this submission?")) return;

    try {
        await deleteDoc(doc(db, "pending_recipes", pendingId));
        document.getElementById(`card-${pendingId}`).remove();
    } catch (error) {
        console.error("Error rejecting:", error);
        alert("Error: " + error.message);
    }
};
// 3. ANALYTICS FUNCTION
async function loadAnalytics() {
    const activityList = document.getElementById('activity-list');
    const leaderboardList = document.getElementById('leaderboard-list');

    try {
        // --- PART A: LOAD RECENT ACTIVITY ---
        // Get the last 50 views
        const q = query(
            collection(db, "recipe_views"), 
            orderBy("timestamp", "desc"), 
            limit(50)
        );
        const snapshot = await getDocs(q);
        
        let activityHtml = "";
        const viewCounts = {}; // We will use this to count totals

        snapshot.forEach(doc => {
            const data = doc.data();
            
            // 1. Add to Feed
            const timeStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : "Recently";
            activityHtml += `
                <div style="padding: 10px; background: #f9fafb; border-radius: 6px; font-size: 13px;">
                    <strong>${data.viewer}</strong> viewed <br>
                    <span style="color: #10b981; font-weight: bold;">${data.recipeTitle}</span>
                    <div style="color: #999; font-size: 11px; margin-top: 4px;">${timeStr}</div>
                </div>
            `;

            // 2. Count for Leaderboard
            const title = data.recipeTitle || "Unknown Recipe";
            if (viewCounts[title]) {
                viewCounts[title]++;
            } else {
                viewCounts[title] = 1;
            }
        });

        activityList.innerHTML = activityHtml || "<p>No activity recorded yet.</p>";

        // --- PART B: CALCULATE LEADERBOARD ---
        // Convert our counts object into a sorted array
        const sortedRecipes = Object.entries(viewCounts)
            .sort(([,countA], [,countB]) => countB - countA) // Sort High to Low
            .slice(0, 5); // Top 5 only

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

    } catch (error) {
        console.error("Error loading analytics:", error);
        activityList.innerHTML = "Error loading logs.";
    }
}