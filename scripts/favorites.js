// ==========================================
// FAVORITES PAGE LOGIC
// ==========================================
// Adapted from profile.js's copy of this same logic — same duplication
// pattern used across this project rather than sharing one function
// between pages.
import { db, auth } from './firebase-config.js';
import {
    doc, getDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { escapeHtml } from './main.js';

function getCategoryClass(category) {
    if (!category) return 'border-gray';
    const cat = category.toLowerCase();

    if (cat.includes('main')) return 'border-red';
    if (cat.includes('dessert')) return 'border-yellow';
    if (cat.includes('appetizer') || cat.includes('snack')) return 'border-blue';
    if (cat.includes('beverage') || cat.includes('drink')) return 'border-cyan';
    if (cat.includes('breakfast')) return 'border-orange';
    if (cat.includes('bread') || cat.includes('roll')) return 'border-brown';
    if (cat.includes('soup') || cat.includes('salad')) return 'border-purple';
    if (cat.includes('sauce') || cat.includes('dressing') || cat.includes('marinade')) return 'border-teal';
    if (cat.includes('dutch')) return 'border-slate';
    if (cat.includes('misc')) return 'border-gray';

    return 'border-gray';
}

function FavoriteCardTemplate(id, recipe) {
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

    return `
    <div class="recipe-card ${colorClass}" data-recipe-id="${escapeHtml(id)}" style="display: flex; flex-direction: column; justify-content: space-between; height: 100%; box-sizing: border-box; cursor: pointer;">
        <button class="card-heart" style="cursor: default;" title="Saved Favorite">❤️</button>
        <div class="card-content" style="display: flex; flex-direction: column; flex-grow: 1;">
            <h2>${escapeHtml(recName)}</h2>
            <div class="recipe-author" style="margin-bottom: auto;">From: ${escapeHtml(recAuth)}</div>

            ${legacyBadges}

            <div class="tag-container" style="margin-top: 10px;">
                ${recTags
                    .filter(t => t !== "Egbert Favorite" && t !== "Wheeler Favorite")
                    .map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`)
                    .join('')}
            </div>
        </div>
    </div>`;
}

async function loadFavorites(user) {
    const grid = document.getElementById('favorites-grid');
    if (!grid) return;

    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const favorites = userSnap.exists() ? (userSnap.data().favorites || []) : [];

        if (favorites.length === 0) {
            grid.innerHTML = "<p style='text-align:center; width:100%; color:#94a3b8;'>No favorites yet! Go heart some recipes ❤️</p>";
            return;
        }

        const recipesSnap = await getDocs(collection(db, "recipes"));
        let html = "";

        recipesSnap.forEach(docSnap => {
            const data = docSnap.data();
            if (favorites.includes(docSnap.id)) {
                html += FavoriteCardTemplate(docSnap.id, data);
            }
        });

        grid.innerHTML = html || "<p style='text-align:center; width:100%; color:#94a3b8;'>No favorite recipes found.</p>";
    } catch (error) {
        console.error("🔥 [FAVORITES] Error loading favorites:", error);
        grid.innerHTML = "<p>Error loading favorites.</p>";
    }
}

document.getElementById('favorites-grid')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-recipe-id]');
    if (card) window.location.href = `recipe.html?id=${encodeURIComponent(card.dataset.recipeId)}`;
});

onAuthStateChanged(auth, (user) => {
    if (user) loadFavorites(user);
});
