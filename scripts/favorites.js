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
import { escapeHtml, getOfflineRecipeIds } from './main.js';

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

    let legacyBadges = `<div style="display: flex; gap: 6px; margin-top: 6px; margin-bottom: 12px; flex-wrap: wrap;">`;
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

            <div class="tag-container" style="margin-top: 12px;">
                ${recTags
                    .filter(t => t !== "Egbert Favorite" && t !== "Wheeler Favorite")
                    .map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`)
                    .join('')}
            </div>
        </div>
    </div>`;
}

// Mirrors scripts/main.js's buildRecipeListRowHtml so Grid/List looks and
// behaves the same everywhere a recipe list shows up.
function FavoriteListRowTemplate(id, recipe, offlineChecklist) {
    const recName = recipe.n || recipe.name || "Untitled Recipe";
    const recAuth = recipe.a || recipe.author || "Family";

    let recTags = recipe.t || recipe.tags || [];
    if (!Array.isArray(recTags)) recTags = [String(recTags)];
    const cat = recTags.find(t => t !== "Egbert Favorite" && t !== "Wheeler Favorite") || recipe.c || "Misc";
    const colorClass = getCategoryClass(cat);

    const isOfflineReady = offlineChecklist.includes(id);
    const isVerified = recipe.r === true || recipe.reviewed === true;
    const isEgbert = recTags.includes("Egbert Favorite");
    const isWheeler = recTags.includes("Wheeler Favorite");
    const family = recipe.fam || recipe.family || "Both";

    return `
        <div class="recipe-list-row ${colorClass}"
             data-recipe-id="${escapeHtml(id)}">
            <button class="card-heart list-row-heart" style="cursor: default;" title="Saved Favorite">❤️</button>
            <div class="list-row-text">
                <div class="list-row-title">
                    <span class="list-row-name">${escapeHtml(recName)}</span>
                    <span class="list-row-author"> - ${escapeHtml(recAuth)}</span>
                </div>
                <div class="list-row-badges">
                    ${isOfflineReady ? `<span class="lr-badge lr-offline" title="Saved on this device">⛺<span class="lr-label"> Offline</span></span>` : ""}
                    ${isVerified ? `<span class="lr-badge lr-verified" title="Verified recipe">✅<span class="lr-label"> Verified</span></span>` : ""}
                    ${family !== "Both" ? `<span class="lr-badge lr-family" title="Family">👪<span class="lr-label"> ${escapeHtml(family)}</span><span class="lr-short"> ${escapeHtml(family.charAt(0))}</span></span>` : ""}
                    ${isEgbert ? `<span class="lr-badge lr-egbert" title="Egbert Favorite">⭐<span class="lr-label"> Egbert</span></span>` : ""}
                    ${isWheeler ? `<span class="lr-badge lr-wheeler" title="Wheeler Favorite">⭐<span class="lr-label"> Wheeler</span></span>` : ""}
                    <span class="list-row-cat">${escapeHtml(cat)}</span>
                </div>
            </div>
        </div>`;
}

let viewMode = localStorage.getItem('recipeViewMode') === 'list' ? 'list' : 'grid';
let cachedFavorites = null; // [{ id, data }], filled once on first load

function updateFavViewButtons() {
    document.getElementById('fav-view-grid-btn')?.classList.toggle('view-toggle-active', viewMode === 'grid');
    document.getElementById('fav-view-list-btn')?.classList.toggle('view-toggle-active', viewMode === 'list');
}

function renderFavorites() {
    const grid = document.getElementById('favorites-grid');
    if (!grid || !cachedFavorites) return;

    grid.classList.toggle('list-view', viewMode === 'list');
    updateFavViewButtons();

    if (cachedFavorites.length === 0) {
        grid.innerHTML = "<p style='text-align:center; width:100%; color:#94a3b8;'>No favorites yet! Go heart some recipes ❤️</p>";
        return;
    }

    if (viewMode === 'list') {
        const offlineChecklist = getOfflineRecipeIds();
        grid.innerHTML = cachedFavorites.map(f => FavoriteListRowTemplate(f.id, f.data, offlineChecklist)).join('');
    } else {
        grid.innerHTML = cachedFavorites.map(f => FavoriteCardTemplate(f.id, f.data)).join('');
    }
}

window.setFavoritesViewMode = function(mode) {
    viewMode = mode === 'list' ? 'list' : 'grid';
    localStorage.setItem('recipeViewMode', viewMode);
    renderFavorites();
};

async function loadFavorites(user) {
    const grid = document.getElementById('favorites-grid');
    if (!grid) return;

    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const favorites = userSnap.exists() ? (userSnap.data().favorites || []) : [];

        const recipesSnap = await getDocs(collection(db, "recipes"));
        cachedFavorites = [];
        recipesSnap.forEach(docSnap => {
            if (favorites.includes(docSnap.id)) cachedFavorites.push({ id: docSnap.id, data: docSnap.data() });
        });

        renderFavorites();
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
