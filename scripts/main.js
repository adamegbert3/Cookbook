// ==========================================
// 1. IMPORTS & SETUP
// ==========================================
import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, 
    serverTimestamp, arrayUnion, arrayRemove, query, orderBy, limit, onSnapshot 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

let allRecipes = [];
let userFavorites = [];
let isAdmin = false; // <-- ADD THIS

// "Built-in" admins — always work even if their users/{uid} doc is ever
// missing or corrupted. Keep in sync with firestore.rules and the
// ADMIN_UIDS arrays in scripts/dashboard.js, scripts/profile.js,
// scripts/review.js, and edit-recipe.html. Everyone else is promoted live
// via the admin console's "Manage Admin Access" widget (sets role:'admin'
// on their users/{uid} doc — no code changes needed).
const ADMIN_UIDS = [
    "n5aAU1g1tBY04Ut0HnhqegSgZe92",
    "NrY491PYN3MIrqJp4rhu5S86w2R2",
    "mPBrypCN9ab1LCEQ578E5YrX8DI2",
    "WxkJYdGYlIRs4FFdDdLcr05jUm22" // Austin
];

// Checks the hardcoded list first (instant, no network call), then falls
// back to the user's Firestore role field for admins promoted via the console.
async function checkIsAdmin(uid) {
    if (ADMIN_UIDS.includes(uid)) return true;
    try {
        const snap = await getDoc(doc(db, "users", uid));
        return snap.exists() && snap.data().role === 'admin';
    } catch (e) {
        console.error("Could not check admin role:", e);
        return false;
    }
}

console.log("✅ MAIN.JS LOADED - v19.0 (Multi-Admin)");

// ==========================================
// OFFLINE RECIPE STORAGE (plain localStorage — no Firestore persistence
// involved, so it can never block or slow down a live read; see
// firebase-config.js for why we stopped using enableIndexedDbPersistence)
// ==========================================
const OFFLINE_DATA_KEY = 'offlineRecipeData';

export function saveRecipeOffline(recipe) {
    if (!recipe || !recipe.id) return;
    try {
        const store = JSON.parse(localStorage.getItem(OFFLINE_DATA_KEY) || "{}");
        store[recipe.id] = recipe;
        localStorage.setItem(OFFLINE_DATA_KEY, JSON.stringify(store));
    } catch (e) { console.warn("Could not save recipe for offline use:", e); }
}

export function getOfflineRecipe(id) {
    try {
        const store = JSON.parse(localStorage.getItem(OFFLINE_DATA_KEY) || "{}");
        return store[id] || null;
    } catch (e) { return null; }
}

export function getOfflineRecipeIds() {
    try {
        return Object.keys(JSON.parse(localStorage.getItem(OFFLINE_DATA_KEY) || "{}"));
    } catch (e) { return []; }
}

// ==========================================
// 2. AUTH & STARTUP
//
// ⚠️ Offline note: Firebase Auth pulls https://apis.google.com/js/api.js at
// startup. With no connection that request fails, Auth throws
// auth/internal-error, and onAuthStateChanged NEVER FIRES — not even with
// null. Everything below used to live solely inside that callback, so the
// homepage simply never started loading offline and sat on "Opening
// Cookbook..." forever. (recipe.html always worked offline because
// recipePage.js races the same callback against a 3s timeout — that's the
// pattern mirrored here.)
// ==========================================
let contentStarted = false;

onAuthStateChanged(auth, async (user) => {
    contentStarted = true;
    const notSignedMsg = document.getElementById("notsigned");
    const recipeGrid = document.getElementById('recipes');
    const adminBtn = document.getElementById('admin-btn');

    if (user) {
        // 1. UI Updates
        if (notSignedMsg) notSignedMsg.classList.add('hidden');
        if (recipeGrid) recipeGrid.style.display = 'grid';

        // 2. Load content IMMEDIATELY.
        // Note we deliberately do NOT await the admin check here: for anyone
        // who isn't a built-in admin it costs a Firestore round-trip, and
        // blocking on it delayed the whole recipe list for every normal user
        // (a big chunk of the "login is hit and miss" slowness). Admin status
        // only controls whether hidden recipes are shown, so we start with
        // "not admin" and re-render below if that turns out to be wrong.
        isAdmin = ADMIN_UIDS.includes(user.uid);
        if (isAdmin && adminBtn) adminBtn.classList.add('visible');

        loadAllRecipes();
        if (document.getElementById('family-feed')) loadFamilyFeed();
        if (document.getElementById('commentsList')) loadComments();
        if (document.getElementById('chefNotes')) loadUserNote();

        // 3. Load User Preferences & Profile in background
        loadUserSettings(user);
        loadHomepageMenu(user);

        // 4. Everything below is background work — none of it blocks the
        // recipe list appearing.
        if (!isAdmin) {
            checkIsAdmin(user.uid).then(result => {
                if (!result) return;
                isAdmin = true;
                if (adminBtn) adminBtn.classList.add('visible');
                // Re-render so hidden recipes appear for the admin
                if (allRecipes.length > 0) renderLocalList(allRecipes);
            });
        }

        getDoc(doc(db, "users", user.uid)).then(userSnap => {
            let userName = user.displayName || user.email.split('@')[0];
            if (userSnap.exists()) {
                userName = userSnap.data().Name || userName;
                userFavorites = userSnap.data().favorites || [];
                // Hearts render from userFavorites, so refresh once we have
                // them — but only if there are any, to avoid a pointless
                // re-render (and scroll reset) for people with no favorites.
                if (userFavorites.length > 0 && allRecipes.length > 0) renderLocalList(allRecipes);
            }
            updateProfileIcon(userName);
        }).catch(err => console.error("Profile Error:", err));

    } else {
        // --- 🚨 UPGRADED GUEST HANDLING (The Bouncer) ---
        const currentPage = window.location.pathname.split('/').pop().toLowerCase();
        const privatePages = ['profile.html', 'admin.html', 'submit.html', 'shopping-list.html', 'recipe.html'];
        
        if (privatePages.includes(currentPage) || document.getElementById('chefNotes')) {
            window.location.href = "index.html"; 
            return;
        }

        if (notSignedMsg) notSignedMsg.classList.remove('hidden');
        if (recipeGrid) recipeGrid.style.display = 'none';

        resetProfileIcon();
    }
}, (authError) => {
    // Auth failed outright — offline is by far the most common cause.
    console.warn("⚠️ [AUTH] Could not reach the sign-in service:", authError.code || authError.message);
    startOfflineMode();
});

// Safety net: if Auth hasn't settled shortly after load, assume we're offline
// and render whatever is cached rather than leaving the page stuck. Crucially
// this does NOT bounce anyone to the login page — being offline shouldn't log
// you out of a cookbook you already downloaded.
setTimeout(() => {
    if (!contentStarted) {
        console.warn("⚠️ [AUTH] Sign-in didn't respond in time — starting in offline mode.");
        startOfflineMode();
    }
}, 3000);

function startOfflineMode() {
    if (contentStarted) return;
    contentStarted = true;

    // Anything that needs the network would otherwise sit on "Loading..."
    const feed = document.getElementById('family-feed');
    if (feed) feed.innerHTML = `<p class="empty-feed">📴 Announcements need a connection.</p>`;

    const recipeGrid = document.getElementById('recipes');
    if (!recipeGrid) return;

    recipeGrid.style.display = 'grid';

    if (!renderFromOfflineStore(recipeGrid)) {
        recipeGrid.innerHTML = `
            <div style="text-align:center; width:100%;">
                <p>📴 You're offline, and no recipes are saved on this device yet.</p>
                <p style="font-size:12px; color:#94a3b8;">Next time you have signal, open the cookbook and tap "⛺ Download All Recipes for Offline".</p>
                <button onclick="location.reload()" class="pill-btn btn-teal">🔄 Try Again</button>
            </div>`;
    }
}

// Firebase's internal auth/internal-error surfaces as an unhandled rejection
// when offline. It's expected in that situation and already handled above —
// keep it out of the console so real errors stay visible.
window.addEventListener('unhandledrejection', (event) => {
    const msg = String(event.reason && (event.reason.code || event.reason.message) || '');
    if (msg.includes('auth/internal-error') || msg.includes('auth/network-request-failed')) {
        console.warn("⚠️ [AUTH] Ignoring expected offline auth error:", msg);
        event.preventDefault();
    }
});

// ==========================================
// 3. RECIPE LOADER
// ==========================================
// Races the real request against a timeout so a flaky connection can never
// leave the page stuck on "Opening Cookbook..." forever with no way out
// short of a manual refresh.
function withTimeout(promise, ms, timeoutMessage) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms))
    ]);
}

async function loadAllRecipes() {
    const container = document.getElementById('recipes');
    if(!container) return;

    container.innerHTML = '<p style="text-align:center; width:100%;">Opening Cookbook...</p>';

    try {
        const docRef = doc(db, "static_assets", "cookbook_index");
        const docSnap = await withTimeout(getDoc(docRef), 15000, "Taking too long to load.");

        if (docSnap.exists()) {
            const data = docSnap.data();
            allRecipes = data.recipes || [];
            renderLocalList(allRecipes);
            updateOfflineStatusLine();
            return;
        }

        // Index doc doesn't exist (never generated, or deleted) — fall
        // through to reading the recipes collection directly instead of
        // showing a dead end.
        console.warn("Homepage index missing — falling back to full collection read.");
        await loadAllRecipesDirect(container);
    } catch (e) {
        console.error("Recipe Load Error (index):", e);
        // The index read failed — try the recipes collection directly
        // before giving up. If the direct read also fails, THAT error is
        // shown, since it's the more informative one.
        try {
            await loadAllRecipesDirect(container);
        } catch (e2) {
            console.error("Recipe Load Error (direct):", e2);

            // LAST RESORT: both network paths failed (offline, or Firestore
            // is unreachable). recipe.html has always fallen back to the
            // localStorage copy that saveRecipeOffline() maintains, but the
            // homepage never did — which is why offline mode "only worked
            // online": you could never get past this screen to a recipe.
            if (renderFromOfflineStore(container)) return;

            const reason = e2.code || e2.message || e.code || e.message || "unknown error";
            container.innerHTML = `
                <div style="text-align:center; width:100%;">
                    <p>Connection trouble loading recipes.</p>
                    <p style="font-size:11px; color:#94a3b8;">(${reason})</p>
                    <p style="font-size:12px; color:#94a3b8;">No offline copy saved on this device yet — next time you're online, tap "⛺ Download All Recipes for Offline".</p>
                    <button onclick="loadAllRecipes()" class="pill-btn btn-teal">🔄 Retry</button>
                    <button onclick="emergencyCacheReset()" class="pill-btn btn-slate">🧹 Fix & Reload</button>
                    <p style="font-size:11px; color:#94a3b8; margin-top:8px;">"Fix & Reload" clears this device's cached copy of the site and fetches everything fresh.</p>
                </div>`;
        }
    }
}

// Rebuilds the homepage list from the full recipe copies already sitting in
// localStorage (written by saveRecipeOffline() whenever a recipe is opened,
// and en masse by "Download All Recipes for Offline"). Reshapes them into
// the same compact form the online index uses so everything downstream —
// search, category filters, cards — works unchanged.
// Returns true if it managed to render something.
function renderFromOfflineStore(container) {
    let store = {};
    try {
        store = JSON.parse(localStorage.getItem(OFFLINE_DATA_KEY) || "{}");
    } catch (e) { return false; }

    const saved = Object.values(store);
    if (saved.length === 0) return false;

    console.log(`⛺ [OFFLINE] Network unavailable — showing ${saved.length} recipe(s) saved on this device.`);

    allRecipes = saved.map(data => {
        const ingredients = data.ingredients || data.recipeIngredient || [];
        return {
            id: data.id,
            n: data.name || data.n || "Untitled",
            a: data.author || data.a || "Family",
            t: data.tags || data.t || [],
            c: data.category || data.c || "Misc",
            r: data.reviewed || data.r || false,
            h: data.isHidden === true || data.h === true,
            ing: Array.isArray(ingredients) ? ingredients.join(' ').toLowerCase() : String(ingredients).toLowerCase()
        };
    });

    renderLocalList(allRecipes);
    updateOfflineStatusLine();
    showOfflineBanner(saved.length);
    return true;
}

function showOfflineBanner(count) {
    if (document.getElementById('offline-mode-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'offline-mode-banner';
    banner.style.cssText = `
        background:#fef08a; border:1px solid #eab308; color:#854d0e;
        padding:10px 14px; border-radius:8px; margin:0 0 15px 0;
        font-size:13px; text-align:center; font-weight:600;`;
    banner.innerHTML = `⛺ <strong>Offline mode</strong> — showing the ${count} recipe${count === 1 ? '' : 's'} saved on this device. Reconnect to see everything.`;

    const recipesEl = document.getElementById('recipes');
    if (recipesEl && recipesEl.parentNode) recipesEl.parentNode.insertBefore(banner, recipesEl);
}
window.loadAllRecipes = loadAllRecipes;

// Fallback path: read the recipes collection directly and reshape it to the
// same compact form the index uses, so the rest of the page works unchanged.
async function loadAllRecipesDirect(container) {
    const snap = await withTimeout(getDocs(collection(db, "recipes")), 20000, "Taking too long to load.");

    allRecipes = [];
    snap.forEach(d => {
        const data = d.data();
        const ingredients = data.ingredients || data.recipeIngredient || [];
        allRecipes.push({
            id: d.id,
            n: data.name || "Untitled",
            a: data.author || "Family",
            t: data.tags || [],
            c: data.category || "Misc",
            r: data.reviewed || false,
            h: data.isHidden === true,
            ing: Array.isArray(ingredients) ? ingredients.join(' ').toLowerCase() : String(ingredients).toLowerCase()
        });
    });

    renderLocalList(allRecipes);
    updateOfflineStatusLine();
}

// One-click recovery: wipe this device's service worker + cached site files
// and reload fresh from the network. Fixes "stuck on an old broken version".
window.emergencyCacheReset = async function() {
    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        }
        if (window.caches) {
            const names = await caches.keys();
            await Promise.all(names.map(n => caches.delete(n)));
        }
    } catch (e) { console.error("Cache reset error:", e); }
    window.location.reload();
};

function updateOfflineStatusLine() {
    const line = document.getElementById('offline-status-line');
    if (!line) return;

    const readyIds = getOfflineRecipeIds();
    const readyCount = allRecipes.filter(r => readyIds.includes(r.id)).length;

    line.innerText = readyCount > 0
        ? `⛺ ${readyCount} of ${allRecipes.length} recipes ready offline on this device.`
        : `Do this before you lose signal — recipes you've already opened stay available too.`;
}

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
    if (cat.includes('side') || cat.includes('veggie') || cat.includes('vegetable')) return 'border-green';
    if (cat.includes('dutch')) return 'border-slate';
    if (cat.includes('misc')) return 'border-gray';
    
    return 'border-gray'; 
}

let offlineChecklist = [];

function buildRecipeCardHtml(item) {
    const isHidden = item.h === true || item.isHidden === true;

    const recName = item.n || item.name || "Untitled Recipe";
    const recAuth = item.a || item.author || "Family";
    const recId   = item.id;
    const isOfflineReady = offlineChecklist.includes(recId);

    let recTags = item.t || item.tags || [];
    if (!Array.isArray(recTags)) {
         recTags = [String(recTags)];
    }

    const cat = recTags[0] || item.c || "Misc";
    const colorClass = getCategoryClass(cat);
    const isFav = userFavorites.includes(recId);
    const heartIcon = isFav ? "❤️" : "🤍";

    const isEgbert = recTags.includes("Egbert Favorite");
    const isWheeler = recTags.includes("Wheeler Favorite");

    // --- 🏆 CLEAN EMOJI BADGES (Dashboard Cards) ---
    let legacyBadges = `<div style="display: flex; gap: 6px; margin-top: 6px; margin-bottom: 4px; flex-wrap: wrap;">`;
    if (isOfflineReady) {
        legacyBadges += `<span style="background: #fef08a; border: 1px solid #eab308; padding: 2px 6px; border-radius: 12px; font-size: 14px; cursor: help;" title="Available offline on this device">⛺</span>`;
    }
    if (item.r || item.reviewed) {
        legacyBadges += `<span style="background: #d1fae5; border: 1px solid #10b981; padding: 2px 6px; border-radius: 12px; font-size: 14px; cursor: help;" title="Verified Recipe">✅</span>`;
    }
    if (isEgbert) {
        legacyBadges += `<span style="background: #e0f2fe; color: #0369a1; border: 1px solid #38bdf8; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;" title="Egbert Favorite">⭐ Egbert</span>`;
    }
    if (isWheeler) {
        legacyBadges += `<span style="background: #dcfce7; color: #15803d; border: 1px solid #4ade80; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;" title="Wheeler Favorite">⭐ Wheeler</span>`;
    }
    legacyBadges += `</div>`;

    // 🚨 ADMIN VISUALS: Add the eye icon and dim the card
    const eyeIcon = isHidden ? `<div style="position: absolute; top: 10px; right: 40px; font-size: 1.2rem;" title="Hidden from public">👁️</div>` : "";
    const dimStyle = isHidden ? `opacity: 0.6; background-color: #f8fafc;` : "";

    return `
        <div class="recipe-card ${colorClass}" style="${dimStyle}" onclick="goToRecipe('${recId}', '${recName.replace(/'/g, "\\'")}')">
            ${eyeIcon}
            <button class="card-heart" onclick="toggleHeart(event, '${recId}')">${heartIcon}</button>
            <div class="card-content">
                <h2>${recName}</h2>
                <div class="recipe-author">From: ${recAuth}</div>

                ${legacyBadges}

                <div class="tag-container">
                    ${recTags
                        .filter(t => t !== "Egbert Favorite" && t !== "Wheeler Favorite")
                        .map(t => `<span class="tag-pill">${t}</span>`)
                        .join('')}
                </div>
            </div>
        </div>`;
}

// --- Lazy-loaded / paginated rendering (renders a batch at a time as the user scrolls) ---
const RECIPE_BATCH_SIZE = 24;
let lazyRenderQueue = [];
let lazyRenderObserver = null;

function renderLocalList(list) {
    const container = document.getElementById('recipes');
    if(!container) return;

    offlineChecklist = getOfflineRecipeIds();

    // 1. Sort safely
    list.sort((a, b) => {
        const nameA = (a.n || a.name || "Untitled").toLowerCase();
        const nameB = (b.n || b.name || "Untitled").toLowerCase();
        return nameA.localeCompare(nameB);
    });

    // 2. Skip hidden recipes up front (unless admin) so pagination counts are accurate
    lazyRenderQueue = list.filter(item => isAdmin || !(item.h === true || item.isHidden === true));

    if (lazyRenderObserver) { lazyRenderObserver.disconnect(); lazyRenderObserver = null; }

    if (lazyRenderQueue.length === 0) {
        container.innerHTML = "<p style='text-align:center'>No recipes found.</p>";
        return;
    }

    container.innerHTML = "";
    renderNextRecipeBatch(container);
}

function renderNextRecipeBatch(container) {
    const batch = lazyRenderQueue.splice(0, RECIPE_BATCH_SIZE);
    container.insertAdjacentHTML('beforeend', batch.map(buildRecipeCardHtml).join(''));

    const oldSentinel = document.getElementById('recipes-sentinel');
    if (oldSentinel) oldSentinel.remove();

    if (lazyRenderQueue.length === 0) return;

    const sentinel = document.createElement('div');
    sentinel.id = 'recipes-sentinel';
    sentinel.style.cssText = 'grid-column: 1 / -1; height: 1px;';
    container.appendChild(sentinel);

    lazyRenderObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            lazyRenderObserver.disconnect();
            renderNextRecipeBatch(container);
        }
    }, { rootMargin: '300px' });

    lazyRenderObserver.observe(sentinel);
}

window.goToRecipe = function(id, name) {
    localStorage.setItem("currentRecipeData", JSON.stringify({ id: id, name: name }));
    window.location.href = `recipe.html?id=${id}`;
};

window.toggleHeart = async function(event, recipeId) {
    event.stopPropagation(); 
    const user = auth.currentUser;
    if (!user) return alert("Log in to favorite!");
    
    const btn = event.currentTarget;
    const userRef = doc(db, "users", user.uid);

    try {
        if (userFavorites.includes(recipeId)) {
            btn.innerText = "🤍";
            userFavorites = userFavorites.filter(id => id !== recipeId);
            await updateDoc(userRef, { favorites: arrayRemove(recipeId) });
        } else {
            btn.innerText = "❤️";
            userFavorites.push(recipeId);
            await updateDoc(userRef, { favorites: arrayUnion(recipeId) });
        }
    } catch (e) { console.error("Heart Error:", e); }
};

// ==========================================
// 4. ANNOUNCEMENTS & COMMENTS
// ==========================================
async function loadFamilyFeed() {
    const feedList = document.getElementById('family-feed');
    if (!feedList) return;
    try {
        const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"), limit(3));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) { 
            feedList.innerHTML = "<p class='empty-feed'>No announcements.</p>"; 
            return; 
        }
        
        let html = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            let icon = "📢";
            if (data.type === "new_recipe") icon = "🍳";

            html += `<div class="announce-item">
                <div class="announce-icon">${icon}</div>
                <div class="announce-text">${data.message}</div>
            </div>`;
        });
        feedList.innerHTML = html;
    } catch (e) { console.error(e); }
}

function loadComments() {
    const list = document.getElementById('commentsList');
    if (!list) return;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    if (!currentRecipe) return;
    
    const user = auth.currentUser;
    const q = query(collection(db, "recipes", currentRecipe.id, "comments"), orderBy("timestamp", "asc"));
    
    onSnapshot(q, (snap) => {
        if(snap.empty){list.innerHTML='<p class="empty-feed">No comments.</p>';return;}
        
        let html='';
        snap.forEach(docSnap => {
            const d = docSnap.data(); 
            const init = (d.author||"G").charAt(0).toUpperCase();
            
            let deleteBtn = "";
            if (user && (user.uid === d.uid || isAdmin)) {
                deleteBtn = `<span onclick="deleteComment('${docSnap.id}')" class="delete-icon" title="Delete">🗑️</span>`;
            }

            html += `
            <div class="comment-row">
                <div class="comment-avatar">${init}</div>
                <div class="comment-bubble">
                    <div class="comment-author">
                        ${d.author}
                        ${deleteBtn}
                    </div>
                    <div class="comment-text">${d.text}</div>
                </div>
            </div>`;
        });
        list.innerHTML = html;
    });
}

window.deleteComment = async function(commentId) {
    if(!confirm("Delete this comment?")) return;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    try {
        await deleteDoc(doc(db, "recipes", currentRecipe.id, "comments", commentId));
    } catch(e) { alert("Error deleting."); }
}

window.postComment = async function() {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");
    const inp = document.getElementById('commentInput');
    const val = inp.value.trim();
    if(!val) return;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    await addDoc(collection(db, "recipes", currentRecipe.id, "comments"), {
        text: val, author: user.displayName || user.email.split('@')[0], uid: user.uid, timestamp: serverTimestamp()
    });
    inp.value = "";
}

// ==========================================
// 6. NOTES & UTILS
// ==========================================
async function loadUserNote() {
    const noteSection = document.getElementById('notes-section');
    const noteBox = document.getElementById('chefNotes');
    const printNotes = document.getElementById('print-chef-notes');
    
    if (!noteSection || !noteBox) return;
    
    const user = auth.currentUser;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    
    if (!user || !currentRecipe) {
        noteSection.classList.add('hidden');
        return;
    }

    noteSection.classList.remove('hidden');

    try {
        const noteRef = doc(db, "users", user.uid, "private_notes", currentRecipe.id);
        const docSnap = await getDoc(noteRef);
        
        if (docSnap.exists() && docSnap.data().text) {
            const text = docSnap.data().text;
            noteBox.value = text;
            if(printNotes) printNotes.innerText = text;
            noteSection.classList.remove('no-print'); 
        } else {
            if(printNotes) printNotes.innerText = "";
            noteSection.classList.add('no-print'); 
        }
    } catch (e) { console.error(e); }
}

window.saveNote = async function() {
    const noteSection = document.getElementById('notes-section');
    const noteBox = document.getElementById('chefNotes');
    const printNotes = document.getElementById('print-chef-notes');
    
    const user = auth.currentUser;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    
    if (!user || !noteBox || !currentRecipe) return alert("Please log in to save notes.");
    
    const textValue = noteBox.value.trim();

    try {
        const noteRef = doc(db, "users", user.uid, "private_notes", currentRecipe.id);
        await setDoc(noteRef, { text: textValue, updatedAt: serverTimestamp(), recipeName: currentRecipe.name || currentRecipe.n });
        
        if(printNotes) printNotes.innerText = textValue;
        if (textValue && noteSection) {
            noteSection.classList.remove('no-print');
        } else if (noteSection) {
            noteSection.classList.add('no-print');
        }

        const status = document.getElementById('saveStatus');
        if(status) { status.innerText = "Saved!"; setTimeout(() => status.innerText = "", 2000); }
    } catch (e) { alert("Error saving note."); }
};

function updateProfileIcon(name) {
    const iconEl = document.getElementById('header-profile-icon');
    if (!iconEl) return;
    const initials = (name || "Guest").split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#0d9488" /><text x="50%" y="50%" dy=".35em" fill="white" font-family="Arial, sans-serif" font-weight="bold" font-size="16" text-anchor="middle">${initials}</text></svg>`;
    iconEl.src = `data:image/svg+xml;base64,${btoa(svg)}`;
}

function resetProfileIcon() {
    const iconEl = document.getElementById('header-profile-icon');
    if (iconEl) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#cbd5e1" /><path d="M20 20a8 8 0 100-16 8 8 0 000 16zm0 4c-5.33 0-16 2.67-16 8v4h32v-4c0-5.33-10.67-8-16-8z" fill="white"/></svg>`;
        iconEl.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    }
}

// ==========================================
// UNIFIED HOMEPAGE FILTERING
// ==========================================
let currentCategoryFilter = null;
let currentFavFilter = null; // 🚀 NEW: Tracks favorites independently!

window.applyHomepageFilters = function() {
    const searchInput = document.getElementById('searchbar');
    const term = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const showReviewedOnly = document.getElementById('reviewed-toggle') ? document.getElementById('reviewed-toggle').checked : false;
    
    let filtered = allRecipes;

    // 1. Filter by Reviewed Status
    if (showReviewedOnly) {
        filtered = filtered.filter(r => r.r === true || r.reviewed === true);
    }

    // 2. Filter by Dish Type Category
    if (currentCategoryFilter) {
        filtered = filtered.filter(r => {
            const tags = r.t || [];
            return tags.includes(currentCategoryFilter);
        });
    }

    // 3. 🚀 Filter by Family Favorite (Stacks with Dish Type!)
    if (currentFavFilter) {
        filtered = filtered.filter(r => {
            const tags = r.t || [];
            return tags.includes(currentFavFilter);
        });
    }

    // 4. Filter by Search Term (matches recipe name OR ingredients)
    if (term) {
        filtered = filtered.filter(r =>
            (r.n || "").toLowerCase().includes(term) ||
            (r.ing || "").includes(term)
        );
    }

    renderLocalList(filtered);
    updateActiveSearchChip(term);
};

// Keeps the active search term visible on the page (and clearable) instead
// of it disappearing into a closed overlay with no trace once you search.
function updateActiveSearchChip(term) {
    const chip = document.getElementById('active-search-chip');
    const chipTerm = document.getElementById('active-search-term');
    if (!chip || !chipTerm) return;

    if (term) {
        chipTerm.innerText = term;
        chip.classList.remove('hidden');
    } else {
        chip.classList.add('hidden');
    }
}

window.clearHomepageSearch = function() {
    const input = document.getElementById('searchbar');
    if (input) input.value = "";
    console.log("🔍 [SEARCH] Cleared.");
    applyHomepageFilters();
};

let searchDebounceTimer = null;

function setupSearch() {
    const openBtn = document.getElementById('header-search-btn');
    const overlay = document.getElementById('search-overlay');
    const closeBtn = document.getElementById('close-search');
    const form = document.getElementById('search-form');
    const input = document.getElementById('searchbar');

    if (!openBtn) return;
    openBtn.onclick = () => { overlay.classList.remove('hidden'); setTimeout(() => input.focus(), 100); };
    if (closeBtn) closeBtn.onclick = () => overlay.classList.add('hidden');

    // Live filtering as you type (debounced), so results update in real time
    // instead of only after hitting GO.
    if (input) input.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => applyHomepageFilters(), 250);
    });

    if (form) form.onsubmit = (e) => {
        e.preventDefault();
        console.log("🔍 [SEARCH] Searching for:", input.value.trim());
        applyHomepageFilters();
        overlay.classList.add('hidden');
        // Keep the typed term in the box (and shown in the chip below) —
        // clearing it made it impossible to tell what you'd searched for.
    }
}

function setupCategoryFilters() {
    const buttons = document.querySelectorAll('.folders button');
    buttons.forEach(btn => {
        btn.onclick = () => {
            const tag = btn.innerText.trim();
            const isFavoriteBtn = tag === "Egbert Favorite" || tag === "Wheeler Favorite";
            
            if (isFavoriteBtn) {
                // Handle Favorite buttons independently
                if (btn.classList.contains('active-filter')) {
                    btn.classList.remove('active-filter');
                    currentFavFilter = null;
                } else {
                    buttons.forEach(b => {
                        if (b.innerText.trim() === "Egbert Favorite" || b.innerText.trim() === "Wheeler Favorite") {
                            b.classList.remove('active-filter');
                        }
                    });
                    btn.classList.add('active-filter');
                    currentFavFilter = tag;
                }
            } else {
                // Handle Dish Type categories independently
                if (btn.classList.contains('active-filter')) {
                    btn.classList.remove('active-filter');
                    currentCategoryFilter = null;
                } else {
                    buttons.forEach(b => {
                        const btnText = b.innerText.trim();
                        if (btnText !== "Egbert Favorite" && btnText !== "Wheeler Favorite") {
                            b.classList.remove('active-filter');
                        }
                    });
                    btn.classList.add('active-filter');
                    currentCategoryFilter = tag;
                }
            }
            
            applyHomepageFilters(); 
        };
    });
}

setTimeout(() => { setupSearch(); setupCategoryFilters(); }, 500);

// ==========================================
// 7. WEEKLY MENU LOGIC (Responsive, Clickable & Deletable)
// ==========================================
async function loadHomepageMenu(user) {
    try {
        const querySnapshot = await getDocs(collection(db, "users", user.uid, "weekly_plan"));
        
        querySnapshot.forEach((doc) => {
            const dayFull = doc.id; 
            const data = doc.data();
            const shortDay = dayFull.substring(0, 3); 
            const box = document.getElementById(`menu-${shortDay}`);
            
            if (box) {
                if (data.meals && data.meals.length > 0) {
                    let html = "";
                    
                    data.meals.forEach(meal => {
                        const uniqueId = meal.addedAt || 0;
                        const safeName = (meal.name || "Unknown").replace(/'/g, "\\'");
                        const recipeId = meal.id;

                        // Custom meals (leftovers, takeout, etc) have no recipe id to
                        // link to — show them as plain text instead of a broken link.
                        const nameHtml = recipeId
                            ? `<a href="recipe.html?id=${recipeId}" style="text-decoration: none; flex-grow: 1; overflow: hidden; margin-right: 8px;">
                                   <span style="font-size: 13px; color: var(--primary); font-weight: 600; text-align: left; line-height: 1.3; display: block; white-space: normal;">
                                       ${meal.name}
                                   </span>
                               </a>`
                            : `<span style="font-size: 13px; color: var(--primary); font-weight: 600; text-align: left; line-height: 1.3; flex-grow: 1; overflow: hidden; margin-right: 8px; white-space: normal;">
                                   🍽️ ${meal.name}
                               </span>`;

                        html += `
                        <div style="background: var(--bg-card); margin-top: 4px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; box-shadow: var(--shadow-sm);">
                            ${nameHtml}
                            <button onclick="deleteMealFromMenu('${dayFull}', ${uniqueId}, '${safeName}')"
                                  style="background: none; border: none; cursor: pointer; color: #ef4444; font-size: 18px; font-weight: bold; padding: 0; line-height: 1;">
                                &times;
                            </button>
                        </div>`;
                    });
                    
                    box.innerHTML = html;
                } else {
                    box.innerHTML = `<span style="color:#9ca3af; font-size: 12px; font-style: italic;">Nothing planned</span>`;
                }
            }
        });
    } catch (e) {
        console.error("Error loading menu widget:", e);
    }
}

window.deleteMealFromMenu = async function(dayFull, uniqueId, mealName) {
    const user = auth.currentUser;
    if (!user) return;

    if(!confirm(`Remove "${mealName}" from ${dayFull}?`)) return;

    const shortDay = dayFull.substring(0, 3);
    const box = document.getElementById(`menu-${shortDay}`);
    
    if(box) box.style.opacity = "0.5";

    try {
        const docRef = doc(db, "users", user.uid, "weekly_plan", dayFull);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const currentMeals = docSnap.data().meals || [];
            
            const newMeals = currentMeals.filter(m => {
                if (uniqueId !== 0 && m.addedAt) {
                    return m.addedAt !== uniqueId;
                }
                return m.name !== mealName;
            });

            await updateDoc(docRef, { meals: newMeals });
            loadHomepageMenu(user);
            if(box) box.style.opacity = "1";
        }
    } catch (e) {
        console.error("Delete Error:", e);
        alert("Could not delete item.");
        if(box) box.style.opacity = "1";
    }
};

// --- CUSTOM (NON-RECIPE) WEEKLY MEALS — leftovers, takeout, etc ---
window.openCustomMealModal = function() {
    if (!auth.currentUser) return alert("Please sign in to save menus!");
    const modal = document.getElementById('customMealModal');
    if (modal) modal.classList.remove('hidden');
};

window.closeCustomMealModal = function() {
    const modal = document.getElementById('customMealModal');
    if (modal) modal.classList.add('hidden');
    const nameInput = document.getElementById('customMealName');
    if (nameInput) nameInput.value = "";
};

window.confirmAddCustomMeal = async function() {
    const user = auth.currentUser;
    if (!user) return alert("You must be logged in.");

    const name = document.getElementById('customMealName').value.trim();
    if (!name) return alert("Give this meal a name first.");

    const day = document.getElementById('customMealDay').value;
    const mealType = document.getElementById('customMealType').value;

    console.log(`🍽️ [CUSTOM MEAL] Adding "${name}" to ${day} (${mealType})...`);

    try {
        const mealData = { id: null, name, ingredients: [], type: mealType, addedAt: Date.now() };
        const docRef = doc(db, "users", user.uid, "weekly_plan", day);
        await setDoc(docRef, { meals: arrayUnion(mealData) }, { merge: true });

        console.log("✅ [CUSTOM MEAL] Saved.");
        closeCustomMealModal();
        loadHomepageMenu(user);
    } catch (e) {
        console.error("🔥 [CUSTOM MEAL] Error:", e);
        alert("Could not save this meal.");
    }
};

// ==========================================
// 8. SETTINGS & THEME ENGINE
// ==========================================
const cachedSettings = JSON.parse(localStorage.getItem('userSettings'));
if (cachedSettings) {
    console.log("🎨 [THEME] Applied cached settings from LocalStorage");
    applyTheme(cachedSettings);
}

export async function saveUserSettings(settings) {
    const user = auth.currentUser;
    if (!user) {
        console.error("❌ [SETTINGS] Cannot save: No user logged in.");
        alert("Error: You must be logged in to save settings.");
        return;
    }

    localStorage.setItem('userSettings', JSON.stringify(settings));
    applyTheme(settings);

    try {
        const docRef = doc(db, "users", user.uid, "settings", "preferences");
        await setDoc(docRef, settings);
        console.log("✅ [SETTINGS] Firebase Save Success!");
    } catch (e) {
        console.error("🔥 [SETTINGS] Firebase Save FAILED:", e);
        alert("Could not save to cloud. Check console for error.");
    }
}

export async function loadUserSettings(user) {
    if (!user) return;
    try {
        const docRef = doc(db, "users", user.uid, "settings", "preferences");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const settings = docSnap.data();
            localStorage.setItem('userSettings', JSON.stringify(settings));
            applyTheme(settings);
        }
    } catch (e) {
        console.error("❌ [SETTINGS] Load Error:", e);
    }
}

// Font size is stored as a plain point value now (e.g. 16), but older
// accounts may still have the original 'normal'/'large'/'xlarge' presets —
// map those to numbers so everyone lands on the same continuous scale.
export function resolveFontSizePx(fontSize) {
    if (typeof fontSize === 'number') return fontSize;
    const legacyMap = { normal: 16, large: 18, xlarge: 20 };
    return legacyMap[fontSize] || 16;
}

function applyTheme(settings) {
    const html = document.documentElement;
    if (settings.theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        html.removeAttribute('data-theme');
    }
    html.style.setProperty('--base-size', resolveFontSizePx(settings.fontSize) + 'px');
    html.setAttribute('data-font', settings.fontStyle || 'inter');
}

window.quickToggleTheme = async function() {
    let settings = JSON.parse(localStorage.getItem('userSettings')) || {
        theme: 'light',
        fontSize: 'normal',
        fontStyle: 'inter'
    };
    
    const isDark = settings.theme === 'dark';
    settings.theme = isDark ? 'light' : 'dark';
    
    const html = document.documentElement;
    if (settings.theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        html.removeAttribute('data-theme');
    }
    
    updateThemeIcons(settings.theme);
    localStorage.setItem('userSettings', JSON.stringify(settings));

    const user = auth.currentUser;
    if (user) {
        try {
            const docRef = doc(db, "users", user.uid, "settings", "preferences");
            await setDoc(docRef, settings);
        } catch (e) { console.error("Could not save theme to cloud:", e); }
    }
};

function updateThemeIcons(theme) {
    const homeBtn = document.getElementById('homeThemeBtn');
    const recipeBtn = document.getElementById('recipeThemeBtn');
    
    if (homeBtn) {
        homeBtn.innerText = theme === 'dark' ? '☀️' : '🌙';
    }
    if (recipeBtn) {
        recipeBtn.innerText = theme === 'dark' ? '☀️ Day Mode' : '🌙 Night Mode';
    }
}

setTimeout(() => {
    let settings = JSON.parse(localStorage.getItem('userSettings')) || {};
    updateThemeIcons(settings.theme || 'light');
}, 500);

// ==========================================
// 9. ⛺ DOWNLOAD ALL RECIPES FOR OFFLINE (e.g. camping/no-signal use)
// Stores the actual recipe content in localStorage (see saveRecipeOffline
// above) — plain, synchronous, and can't hang the way Firestore's own
// persistence layer could.
// ==========================================
window.downloadAllForOffline = async function(event) {
    const btn = event ? event.currentTarget : document.querySelector('button[onclick*="downloadAllForOffline"]');
    let originalText = "⛺ Download All Recipes for Offline";

    if (btn) {
        originalText = btn.innerHTML;
        btn.innerHTML = "⏳ Downloading Cookbook...";
        btn.disabled = true;
    }

    try {
        console.log("⛺ Fetching all recipes so they're cached for offline use...");
        const querySnapshot = await getDocs(collection(db, "recipes"));

        const store = {};
        querySnapshot.forEach((docSnap) => { store[docSnap.id] = { id: docSnap.id, ...docSnap.data() }; });
        localStorage.setItem(OFFLINE_DATA_KEY, JSON.stringify(store));

        const count = Object.keys(store).length;
        console.log(`✅ ${count} recipes are now cached for offline use.`);
        if (btn) {
            btn.innerHTML = `⛺ All ${count} Recipes Ready Offline!`;
            btn.style.backgroundColor = "#15803d";
        }

        renderLocalList(allRecipes);
        updateOfflineStatusLine();
    } catch (error) {
        console.error("❌ Offline download failed:", error);
        alert("Could not download recipes. Make sure you're online first, then try again.");
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
};