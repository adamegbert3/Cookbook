// ==========================================
// BOTTOM NAV: "Menu" popup, Search shortcut, profile initials
// ==========================================
// Tapping the Menu icon in the bottom nav (present on every main page) pops
// this small modal instead of navigating anywhere directly — it's just a
// short list of links (Weekly Menu, the last recipe you were on, and
// Favorites), each on its own dedicated page. Self-contained and reads
// localStorage directly rather than importing main.js, so it works the
// same on every page regardless of whether that page happens to load
// main.js for anything else. Also fills in the Profile icon's initials
// circle, for the same reason — a direct Firebase Auth import here works
// identically everywhere, instead of relying on whatever auth flow (or
// none) each page's own script happens to run.
import { db, auth } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function getLastRecipe() {
    try {
        const list = JSON.parse(localStorage.getItem('recentlyViewedRecipes')) || [];
        return list[0] || null;
    } catch (e) {
        return null;
    }
}

function buildModal() {
    if (document.getElementById('nav-menu-modal')) return;

    const lastRecipe = getLastRecipe();
    const modal = document.createElement('div');
    modal.id = 'nav-menu-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
        <div style="background: var(--bg-card); padding: 20px; border-radius: 12px; width: 320px; max-width: 90%; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 10px 0; color: var(--accent-teal); text-align:center;">Menu</h3>
            <a href="weekly-menu.html" class="nav-menu-row">📅 Weekly Menu</a>
            ${lastRecipe ? `<a href="recipe.html?id=${encodeURIComponent(lastRecipe.id)}" class="nav-menu-row">🕰️ Continue: ${escapeHtml(lastRecipe.name)}</a>` : ''}
            <a href="favorites.html" class="nav-menu-row">❤️ Favorite Recipes</a>
            <button onclick="closeNavMenuModal()" class="pill-btn btn-slate" style="width:100%; margin-top:15px; justify-content:center;">Close</button>
        </div>
    `;
    document.body.appendChild(modal);
}

window.openNavMenuModal = function(event) {
    if (event) event.preventDefault();
    buildModal();
    document.getElementById('nav-menu-modal').classList.remove('hidden');
};

window.closeNavMenuModal = function() {
    document.getElementById('nav-menu-modal')?.classList.add('hidden');
};

// From the homepage, just opens the existing search bar in place (no
// reload); from anywhere else, the link's own href does the navigating to
// homepage.html?search=1, which main.js's setupSearch() auto-opens on load.
window.handleBottomNavSearch = function(event) {
    if (document.body.dataset.page === 'homepage') {
        event.preventDefault();
        document.getElementById('header-search-btn')?.click();
    }
};

function getInitials(name) {
    return (name || "?").trim().split(/\s+/).filter(Boolean).map(n => n[0]).join('').toUpperCase().substring(0, 2) || "?";
}

async function updateBottomNavAvatar(user) {
    const icons = document.querySelectorAll('.bottom-nav-avatar');
    if (!icons.length) return;

    let name = user.displayName || (user.email ? user.email.split('@')[0] : 'Chef');
    try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists() && snap.data().Name) name = snap.data().Name;
    } catch (e) {}

    const initials = getInitials(name);
    icons.forEach(el => { el.textContent = initials; });
}

onAuthStateChanged(auth, (user) => {
    if (user) updateBottomNavAvatar(user);
});
