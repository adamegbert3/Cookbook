// ==========================================
// PROFILE PAGE LOGIC
// ==========================================
import { db, auth } from './firebase-config.js'; 
import { 
    doc, getDoc, collection, getDocs 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
// ⚠️ LIST OF ADMINS (Copy your exact list from main.js here)
const ADMIN_UIDS = [
    "n5aAU1g1tBY04Ut0HnhqegSgZe92", 
    "NrY491PYN3MIrqJp4rhu5S86w2R2",
    "mPBrypCN9ab1LCEQ578E5YrX8DI2"
];

// STARTUP
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("👤 [PROFILE] Loading profile for:", user.email);
        // --- NEW: REVEAL ADMIN BUTTON ---
        if (ADMIN_UIDS.includes(user.uid)) {
            const adminBtn = document.getElementById('profile-admin-btn');
            if(adminBtn) {
                adminBtn.style.display = 'inline-flex';
                adminBtn.classList.remove('hidden');
            }
        }

        // 1. Load User Info
        loadUserProfile(user);
        
        // 2. Load Favorites
        loadUserFavorites(user);
    } else {
        window.location.href = "index.html";
    }
});

// --- 1. FILL IN PROFILE INFO ---
async function loadUserProfile(user) {
    const nameEl = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    const imgEl = document.getElementById('profile-avatar');
    const dateEl = document.getElementById('profile-joined');

    // 🚀 THE DATE FIX: Pull directly from Firebase Auth metadata first!
    if (user.metadata && user.metadata.creationTime) {
        const creationDate = new Date(user.metadata.creationTime);
        const formattedDate = creationDate.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
        if (dateEl) dateEl.innerText = `Member since ${formattedDate}`;
    }

    // Get Data from Firestore to customize Name/Avatar
    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        
        if (userSnap.exists()) {
            const data = userSnap.data();
            if (nameEl) nameEl.innerText = data.Name || user.displayName || "Chef";
            if (emailEl) emailEl.innerText = data.email || user.email;
            
            // Generate Avatar based on name
            if (imgEl && nameEl) {
                imgEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(nameEl.innerText)}&background=random&size=200`;
            }
            
            // If Firestore has a custom formatted date, let it override
            if (data.createdAt && dateEl) {
                const date = data.createdAt.toDate().toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                });
                dateEl.innerText = "Member since " + date;
            }
        }
    } catch (e) {
        console.error("🔥 [PROFILE] Error loading user profile:", e);
    }
}

// Helper: Match homepage category borders
function getCategoryClass(category) {
    if (!category) return 'border-gray'; 
    const cat = category.toLowerCase();
    
    if (cat.includes('main')) return 'border-red';
    if (cat.includes('dessert')) return 'border-yellow';
    if (cat.includes('appetizer') || cat.includes('snack')) return 'border-blue';
    if (cat.includes('breakfast')) return 'border-orange';
    if (cat.includes('bread') || cat.includes('roll')) return 'border-brown';
    if (cat.includes('soup') || cat.includes('salad')) return 'border-purple';
    if (cat.includes('sauce') || cat.includes('dressing') || cat.includes('marinade')) return 'border-teal';
    if (cat.includes('dutch')) return 'border-slate';
    if (cat.includes('misc')) return 'border-gray';
    
    return 'border-gray'; 
}

// --- 2. LOAD FAVORITE RECIPES ---
async function loadUserFavorites(user) {
    const grid = document.getElementById('favorites-grid');
    if (!grid) return;
    
    try {
        // A. Get User's Favorite IDs
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const favorites = userSnap.exists() ? (userSnap.data().favorites || []) : [];

        if (favorites.length === 0) {
            grid.innerHTML = "<p style='text-align:center; width:100%; color:#94a3b8;'>No favorites yet! Go heart some recipes ❤️</p>";
            return;
        }

        // B. Get ALL Recipes
        const recipesSnap = await getDocs(collection(db, "recipes"));
        let html = "";

        recipesSnap.forEach(docSnap => {
            const data = docSnap.data();
            // C. Only show if ID is in the list
            if (favorites.includes(docSnap.id)) {
                html += ProfileCardTemplate(docSnap.id, data);
            }
        });

        console.log(`✅ [PROFILE] Loaded ${favorites.length} favorite(s).`);
        grid.innerHTML = html || "<p style='text-align:center; width:100%; color:#94a3b8;'>No favorite recipes found.</p>";

    } catch (error) {
        console.error("🔥 [PROFILE] Error loading favorites:", error);
        grid.innerHTML = "<p>Error loading favorites.</p>";
    }
}

// --- 🚀 UPGRADED CARD TEMPLATE: 100% Identical to Homepage ---
function ProfileCardTemplate(id, recipe) {
    const recName = recipe.n || recipe.name || "Untitled Recipe";
    const recAuth = recipe.a || recipe.author || "Family";
    
    let recTags = recipe.t || recipe.tags || [];
    if (!Array.isArray(recTags)) recTags = [String(recTags)];
    
    const cat = recTags[0] || recipe.c || "Misc";
    const colorClass = getCategoryClass(cat);

    const isEgbert = recTags.includes("Egbert Favorite");
    const isWheeler = recTags.includes("Wheeler Favorite");

    let legacyBadges = `<div style="display: flex; gap: 6px; margin-top: 6px; margin-bottom: 4px; flex-wrap: wrap;">`;
    if (recipe.r || recipe.reviewed) {
        legacyBadges += `<span style="background: #d1fae5; border: 1px solid #10b981; padding: 2px 6px; border-radius: 12px; font-size: 14px; cursor: help;" title="Verified Recipe">✅</span>`;
    }
    if (isEgbert) {
        legacyBadges += `<span style="background: #e0f2fe; color: #0369a1; border: 1px solid #38bdf8; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;" title="Egbert Favorite">⭐ Egbert</span>`;
    }
    if (isWheeler) {
        legacyBadges += `<span style="background: #dcfce7; color: #15803d; border: 1px solid #4ade80; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;" title="Wheeler Favorite">⭐ Wheeler</span>`;
    }
    legacyBadges += `</div>`;

    // 🚀 THE FIX: height: 100% and flex-direction: column forces cards to stretch and align!
    return `
    <div class="recipe-card ${colorClass}" onclick="window.location.href='recipe.html?id=${id}'" style="display: flex; flex-direction: column; justify-content: space-between; height: 100%; box-sizing: border-box; cursor: pointer;">
        <button class="card-heart" style="cursor: default;" title="Saved Favorite">❤️</button>
        <div class="card-content" style="display: flex; flex-direction: column; flex-grow: 1;">
            <h2>${recName}</h2>
            <div class="recipe-author" style="margin-bottom: auto;">From: ${recAuth}</div>
            
            ${legacyBadges}

            <div class="tag-container" style="margin-top: 10px;">
                ${recTags
                    .filter(t => t !== "Egbert Favorite" && t !== "Wheeler Favorite")
                    .map(t => `<span class="tag-pill">${t}</span>`)
                    .join('')}
            </div>
        </div>
    </div>`;
}