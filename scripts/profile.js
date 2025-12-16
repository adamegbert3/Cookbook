// ==========================================
// PROFILE PAGE LOGIC
// ==========================================
import { db, auth } from './firebase-config.js'; 
import { 
    doc, getDoc, collection, getDocs 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// STARTUP
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 1. Load User Info
        loadUserProfile(user);
        
        // 2. Load Favorites
        loadUserFavorites(user);
    } else {
        // Not logged in? Kick them back home.
        window.location.href = "index.html";
    }
});

// --- 1. FILL IN PROFILE INFO ---
async function loadUserProfile(user) {
    const nameEl = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    const imgEl = document.getElementById('profile-avatar');
    const dateEl = document.getElementById('profile-joined');

    // Get Data from Firestore
    const userSnap = await getDoc(doc(db, "users", user.uid));
    
    if (userSnap.exists()) {
        const data = userSnap.data();
        nameEl.innerText = data.Name || user.displayName || "Chef";
        emailEl.innerText = data.email || user.email;
        
        // Generate Avatar
        imgEl.src = `https://ui-avatars.com/api/?name=${nameEl.innerText}&background=random&size=200`;
        
        // Date Format
        if(data.createdAt) {
            const date = data.createdAt.toDate().toLocaleDateString();
            dateEl.innerText = "Member since " + date;
        }
    }
}

// --- 2. LOAD FAVORITE RECIPES ---
async function loadUserFavorites(user) {
    const grid = document.getElementById('favorites-grid');
    
    try {
        // A. Get User's Favorite IDs
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const favorites = userSnap.exists() ? (userSnap.data().favorites || []) : [];

        if (favorites.length === 0) {
            grid.innerHTML = "<p>No favorites yet! Go heart some recipes ❤️</p>";
            return;
        }

        // B. Get ALL Recipes (Easier than doing 50 individual fetches)
        const recipesSnap = await getDocs(collection(db, "recipes"));
        let html = "";

        recipesSnap.forEach(doc => {
            const data = doc.data();
            // C. Only show if ID is in the list
            if (favorites.includes(doc.id)) {
                html += ProfileCardTemplate(doc.id, data);
            }
        });

        grid.innerHTML = html;

    } catch (error) {
        console.error(error);
        grid.innerHTML = "<p>Error loading favorites.</p>";
    }
}

// --- CARD TEMPLATE (Simplified for Profile) ---
function ProfileCardTemplate(id, recipe) {
    // Save data for click logic
    const safeData = encodeURIComponent(JSON.stringify({id: id, ...recipe}));

    return `
    <div class="recipe-card" onclick="goToRecipe('${id}', '${safeData}')" style="cursor:pointer; width: 250px; min-height: 200px;">
        <div style="position: absolute; top: 10px; right: 10px; font-size: 20px;">❤️</div>
        <h2 style="font-size: 1.5rem; margin-top: 30px;">${recipe.name}</h2>
        <p style="color: #666; font-size: 14px;">From: ${recipe.author || "Family"}</p>
        <div style="margin-top: 10px;">
            ${(recipe.tags || []).slice(0,2).map(t => 
                `<span style="background:#eee; padding:3px 8px; border-radius:10px; font-size:11px; margin-right:5px;">${t}</span>`
            ).join('')}
        </div>
    </div>`;
}

// Global Click Function
window.goToRecipe = function(id, dataString) {
    const data = JSON.parse(decodeURIComponent(dataString));
    localStorage.setItem("currentRecipeData", JSON.stringify(data));
    window.location.href = `recipe.html?id=${id}`;
};