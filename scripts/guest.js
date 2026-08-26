import { db, auth } from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

const code = new URLSearchParams(window.location.search).get('code');

function showError(message) {
    const statusEl = document.getElementById('guest-status');
    const gridEl = document.getElementById('recipes');
    if (gridEl) gridEl.innerHTML = '';
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.display = 'block';
    }
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Deliberately trimmed down from main.js's buildRecipeCardHtml — no admin
// eye-icon, no personalization badges, no favorite heart (favoriting still
// works fine once they're actually on recipe.html). Reuses the same
// .recipe-card/.tag-pill classes from recipes.css so it looks identical to
// the real homepage's cards, just with less on it.
function buildGuestCardHtml(r) {
    let cat = "Misc";
    if (r.tags && Array.isArray(r.tags) && r.tags.length > 0) cat = r.tags[0];
    else if (r.category) cat = r.category;

    return `
        <div class="recipe-card" data-recipe-id="${escapeHtml(r.id)}" data-recipe-name="${escapeHtml(r.name)}">
            <div class="card-content">
                <h2>${escapeHtml(r.name || "Untitled")}</h2>
                <div class="recipe-author">From: ${escapeHtml(r.author || "Unknown")}</div>
                <div class="tag-container">
                    <span class="tag-pill">${escapeHtml(cat)}</span>
                </div>
            </div>
        </div>`;
}

// Same handoff main.js's goToRecipe uses, so recipe.html's own "loaded from
// cache while we wait on the network" fast path works identically for guests.
function goToRecipe(id, name) {
    localStorage.setItem("currentRecipeData", JSON.stringify({ id, name }));
    window.location.href = `recipe.html?id=${id}`;
}

function setupGuestCardClicks() {
    const container = document.getElementById('recipes');
    if (!container || container.dataset.clicksBound === 'true') return;
    container.dataset.clicksBound = 'true';
    container.addEventListener('click', (event) => {
        const card = event.target.closest('[data-recipe-id]');
        if (card) goToRecipe(card.dataset.recipeId, card.dataset.recipeName);
    });
}

function renderGuestRecipes(recipes) {
    const gridEl = document.getElementById('recipes');
    if (!gridEl) return;

    if (recipes.length === 0) {
        gridEl.innerHTML = "<p style='text-align:center; color:#94a3b8; grid-column:1/-1;'>Nothing's been shared with you yet — check back soon!</p>";
        return;
    }

    recipes.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    gridEl.innerHTML = recipes.map(buildGuestCardHtml).join('');
    setupGuestCardClicks();
}

async function init() {
    if (!code) {
        showError("This link is missing a guest code. Ask whoever shared it with you for the full link.");
        return;
    }

    let codeSnap;
    try {
        codeSnap = await getDoc(doc(db, "guest_codes", code));
    } catch (e) {
        console.error("🎟️ [GUEST] Could not check the guest code:", e);
        showError("Couldn't check that link right now. Check your connection and try again.");
        return;
    }

    if (!codeSnap.exists() || codeSnap.data().active !== true) {
        showError("This guest link isn't active anymore. Ask whoever shared it with you for a new one.");
        return;
    }

    const codeData = codeSnap.data();

    // Wait for the first auth-state tick so we know whether this browser
    // already has a signed-in session (a real member, or a returning guest)
    // before deciding whether a new anonymous one is needed.
    const user = await new Promise((resolve) => {
        const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
    });

    let uid;
    if (user) {
        uid = user.uid;
    } else {
        try {
            const cred = await signInAnonymously(auth);
            uid = cred.user.uid;
        } catch (e) {
            console.error("🎟️ [GUEST] Could not start a guest session:", e);
            showError("Couldn't start your guest session. Check your connection and try again.");
            return;
        }
    }

    try {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
            await setDoc(userRef, {
                Name: codeData.name,
                role: 'guest',
                guestCode: code,
                family: 'Both',
                createdAt: serverTimestamp()
            });
        } else {
            const data = userSnap.data();
            // Only ever touches an account that's already a guest (this
            // device switching to a different code, or the admin renamed
            // them) — a real member's users/{uid} doc has role !== 'guest'
            // and is left alone.
            if (data.role === 'guest' && (data.guestCode !== code || data.Name !== codeData.name)) {
                await updateDoc(userRef, { guestCode: code, Name: codeData.name });
            }
        }
    } catch (e) {
        console.error("🎟️ [GUEST] Could not set up your guest profile:", e);
        showError("Couldn't set up your guest visit right now. Check your connection and try again.");
        return;
    }

    const bannerEl = document.getElementById('guest-banner');
    if (bannerEl) {
        bannerEl.textContent = `🎟️ Hi, ${codeData.name}! Here's what's shared with you.`;
        bannerEl.style.display = 'block';
    }

    const recipeIds = codeData.recipeIds || [];
    const recipes = (await Promise.all(recipeIds.map(async (id) => {
        try {
            const snap = await getDoc(doc(db, "recipes", id));
            return snap.exists() ? { id: snap.id, ...snap.data() } : null;
        } catch (e) {
            console.warn(`🎟️ [GUEST] Could not load recipe ${id}:`, e.message);
            return null;
        }
    }))).filter(Boolean);

    const statusEl = document.getElementById('guest-status');
    if (statusEl) statusEl.style.display = 'none';
    renderGuestRecipes(recipes);
}

init();
