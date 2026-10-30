// ==========================================
// BOTTOM NAV: "Menu" popup, Search shortcut, profile initials
// ==========================================
// Tapping the Menu icon in the bottom nav (present on every main page) pops
// this small modal instead of navigating anywhere directly — it's just a
// short list of links, each on its own dedicated page. Self-contained and
// reads localStorage directly rather than importing main.js, so it works
// the same on every page regardless of whether that page happens to load
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

// One row = an icon in a colored circle, a bold title, and a short
// sub-line saying what it actually does — plain text rows alone read as
// a wall of links with no way to tell them apart at a glance.
function menuRow(href, icon, color, title, subtitle) {
    return `
        <a href="${href}" class="nav-menu-row">
            <span class="nav-menu-row-icon" style="background:${color};">${icon}</span>
            <span class="nav-menu-row-text">
                <span class="nav-menu-row-title">${title}</span>
                <span class="nav-menu-row-sub">${subtitle}</span>
            </span>
        </a>`;
}

function buildModal() {
    if (document.getElementById('nav-menu-modal')) return;

    const lastRecipe = getLastRecipe();
    const modal = document.createElement('div');
    modal.id = 'nav-menu-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
        <div style="background: var(--bg-card); padding: 18px; border-radius: 14px; width: 340px; max-width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.25);">
            <h3 style="margin: 0 0 12px 4px; color: var(--accent-teal); text-align:left;">Menu</h3>
            <div class="nav-menu-list">
                ${menuRow('kitchen.html', '🥬', '#287768', 'My Kitchen', 'Inventory, dated meals & shopping')}
                ${menuRow('weekly-menu.html', '📅', '#0d9488', 'Meal Planner', "This week's menu & shopping list")}
                ${lastRecipe ? menuRow(`recipe.html?id=${encodeURIComponent(lastRecipe.id)}`, '🕰️', '#7c3aed', 'Continue Reading', escapeHtml(lastRecipe.name)) : ''}
                ${menuRow('favorites.html', '❤️', '#dc2626', 'Favorites', 'Your saved recipes')}
                ${menuRow('offline-downloads.html', '📥', '#2563eb', 'Download Recipes', 'Save recipes for offline use')}
                ${menuRow('print.html', '🖨️', '#ea580c', 'Print Recipes', 'Print recipe cards')}
                ${menuRow('settings.html', '⚙️', '#475569', 'Settings', 'Theme, text size, account')}
            </div>
            <button onclick="closeNavMenuModal()" class="pill-btn btn-slate" style="width:100%; margin-top:14px; justify-content:center;">Close</button>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeNavMenuModal(); });
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
