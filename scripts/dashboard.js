import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc, deleteDoc, updateDoc, 
    query, orderBy, limit, where, serverTimestamp, 
    arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// --- CONFIGURATION ---
// "Built-in" admins — always work even if their users/{uid} doc is ever
// missing or corrupted. Keep in sync with firestore.rules and the
// ADMIN_UIDS arrays in scripts/main.js, scripts/profile.js, scripts/review.js,
// and edit-recipe.html. Everyone else is promoted live via "Manage Admin
// Access" below, which just sets role:'admin' on their users/{uid} doc —
// no code changes needed.
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

// Global Variables
let currentActivityLimit = 200; // higher than before so the per-person Activity roster has enough history to be useful
let allRecipeData = [];

onAuthStateChanged(auth, async (user) => {
    console.log("🔐 [AUTH STATE CHANGED] Fired!");

    if (user) {
        console.log("👤 [AUTH SUCCESS] Logged in as:", user.email);
        console.log("🆔 [AUTH UID]:", user.uid);

        const isAdmin = await checkIsAdmin(user.uid);
        console.log("🛡️ [IS ADMIN?]:", isAdmin);

        if (isAdmin) {
            console.log("👨‍🍳 Welcome, Chef! Initializing Dashboard...");
            loadAdminDashboard();
            loadReportedIssues();
        } else {
            console.warn("⚠️ [ACCESS DENIED] User is logged in, but isn't an admin (not in ADMIN_UIDS and no role:'admin' on their profile)!");
            // Comment out the redirect temporarily so you can read the console!
            // window.location.href = "index.html";
        }
    } else {
        console.error("❌ [AUTH FAIlED] No user detected. Acting as logged out.");
        // Comment out the redirect temporarily so we can debug!
        // window.location.href = "index.html";
    }
});

async function loadAdminDashboard() {
    console.log("📥 [DASHBOARD] Starting database fetch...");
    loadPendingRecipes();
    loadReports();
    loadUsageStats();
    loadPendingInvites();
    loadAdminUsersList();

    const ollamaInput = document.getElementById('ollama-server-url');
    const savedOllamaUrl = localStorage.getItem('ollamaServerUrl');
    if (ollamaInput && savedOllamaUrl) ollamaInput.value = savedOllamaUrl;

    const ollamaModelInput = document.getElementById('ollama-model-name');
    const savedOllamaModel = localStorage.getItem('ollamaModelName');
    if (ollamaModelInput && savedOllamaModel) ollamaModelInput.value = savedOllamaModel;

    try {
        console.log("⏳ [FIRESTORE] Querying 'recipes' collection...");
        const querySnapshot = await getDocs(collection(db, "recipes"));
        
        console.log(`✅ [FIRESTORE SUCCESS] Snapshot received! Empty? ${querySnapshot.empty}`);
        console.log(`📊 [FIRESTORE COUNT] Found ${querySnapshot.size} documents.`);

        allRecipeData = []; 
        querySnapshot.forEach(doc => {
            allRecipeData.push({ id: doc.id, ...doc.data() });
        });
        
        console.log("🚀 [RENDER] Passing data to renderUnifiedManager...");
        renderUnifiedManager(allRecipeData);      
        renderDeepStats(allRecipeData);      
        loadAnalytics(allRecipeData);   

        // Activating Search
        const searchInput = document.getElementById('manager-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                applyAdminFilters();
            });
        }
    } catch (error) {
        console.error("🔥 [DASHBOARD CRITICAL ERROR]:", error);
        console.error("Error Code:", error.code);
        console.error("Error Message:", error.message);
    }
}

// ==========================================
// 3. MASTER RECIPE MANAGER (v7 - CLEAN FIX)
// ==========================================
function buildRecipeRowHtml(r) {
    const isHidden = r.isHidden === true;
    const isReviewed = r.reviewed === true;
    const viewCount = r.views || 0;

    let badge = `<span class="status-badge status-live">🟢 Live</span>`;
    if (!isReviewed) badge = `<span class="status-badge status-review">⚠️ Review</span>`;
    else if (isHidden) badge = `<span class="status-badge status-hidden">❌ Hidden</span>`;

    let cat = "Misc";
    if (r.tags && Array.isArray(r.tags) && r.tags.length > 0) cat = r.tags[0];
    else if (r.category) cat = r.category;

    const toggleText = isHidden ? "Show" : "Hide";
    const toggleIcon = isHidden ? "👁️" : "🚫";

    const currentTags = r.tags || [];
    const isEgb = currentTags.includes("Egbert Favorite");
    const isWhl = currentTags.includes("Wheeler Favorite");

    return `
        <div class="recipe-manage-card">
            <div class="rmc-top">
                <span class="rmc-name">${r.name || "Untitled"}</span>
                ${badge}
            </div>
            <div class="rmc-meta">
                👤 ${r.author || "Unknown"}<br>
                📂 ${cat}<br>
                👀 ${viewCount} views
            </div>
            <div class="rmc-actions">
                <a href="edit-recipe.html?id=${r.id}" class="btn-action btn-edit">✏️ Edit</a>
                <button onclick="toggleVisibility('${r.id}', ${isHidden})" class="btn-action btn-toggle">${toggleIcon} ${toggleText}</button>
                <button onclick="deleteRecipe('${r.id}', '${r.name?.replace(/'/g, "\\'")}')" class="btn-action btn-delete">🗑️ Delete</button>
            </div>
            <div class="rmc-favorites">
                <button onclick="quickTag('${r.id}', 'Egbert Favorite', ${isEgb})" class="btn-action" style="background: ${isEgb ? '#0284c7' : '#f0f9ff'}; color: ${isEgb ? '#ffffff' : '#0369a1'}; border: 1px solid #bae6fd; font-weight: 800;" title="Toggle Egbert Favorite">
                    ${isEgb ? '★ Egb' : '☆ Egb'}
                </button>
                <button onclick="quickTag('${r.id}', 'Wheeler Favorite', ${isWhl})" class="btn-action" style="background: ${isWhl ? '#16a34a' : '#f0fdf4'}; color: ${isWhl ? '#ffffff' : '#15803d'}; border: 1px solid #bbf7d0; font-weight: 800;" title="Toggle Wheeler Favorite">
                    ${isWhl ? '★ Whl' : '☆ Whl'}
                </button>
            </div>
        </div>`;
}

const MASTER_LIST_BATCH_SIZE = 30;
let masterListQueue = [];

function renderUnifiedManager(recipes) {
    const list = document.getElementById('unified-list');
    if(!list) return;

    recipes.sort((a, b) => {
        const aRev = a.reviewed === true;
        const bRev = b.reviewed === true;
        if (aRev !== bRev) return aRev ? 1 : -1;
        return (a.name || "").localeCompare(b.name || "");
    });

    if (recipes.length === 0) {
        list.innerHTML = "<div style='padding:20px; text-align:center'>No recipes found.</div>";
        return;
    }

    masterListQueue = recipes.slice();

    list.innerHTML = `
    <div class="recipe-manage-list" id="unified-cards"></div>
    <div id="unified-load-more-wrap" style="text-align:center; margin-top:15px;"></div>
    `;

    renderNextMasterBatch();
}

window.renderNextMasterBatch = function() {
    const cardsEl = document.getElementById('unified-cards');
    const wrap = document.getElementById('unified-load-more-wrap');
    if (!cardsEl) return;

    const batch = masterListQueue.splice(0, MASTER_LIST_BATCH_SIZE);
    cardsEl.insertAdjacentHTML('beforeend', batch.map(buildRecipeRowHtml).join(''));

    if (masterListQueue.length > 0) {
        wrap.innerHTML = `<button class="pill-btn btn-teal" onclick="renderNextMasterBatch()">Load ${Math.min(MASTER_LIST_BATCH_SIZE, masterListQueue.length)} More (${masterListQueue.length} remaining)</button>`;
    } else {
        wrap.innerHTML = '';
    }
};

// ACTION FUNCTIONS
window.deleteRecipe = async function(id, recipeName) {
    if(!confirm(`⚠️ DANGER: Permanently delete "${recipeName}"?`)) return;
    try {
        await deleteDoc(doc(db, "recipes", id));
        allRecipeData = allRecipeData.filter(r => r.id !== id);
        applyAdminFilters();
    } catch (error) { alert("Error deleting: " + error.message); }
};

window.toggleVisibility = async function(id, currentStatus) {
    const newStatus = !currentStatus;
    if(!confirm(`${newStatus ? "HIDE" : "PUBLISH"} this recipe?`)) return;
    try {
        await updateDoc(doc(db, "recipes", id), { isHidden: newStatus });
        const recipe = allRecipeData.find(r => r.id === id);
        if(recipe) recipe.isHidden = newStatus;
        applyAdminFilters();
    } catch (error) { alert("Could not update visibility."); }
};
// ==========================================
// QUICK-TAG HALL OF FAME TOGGLE
// ==========================================
window.quickTag = async function(id, tagString, currentlyHasTag) {
    try {
        const docRef = doc(db, "recipes", id);
        
        // 1. Update Firestore in the background
        if (currentlyHasTag) {
            await updateDoc(docRef, { tags: arrayRemove(tagString) });
        } else {
            await updateDoc(docRef, { tags: arrayUnion(tagString) });
        }

        // 2. Update local memory so we don't have to re-download the whole database!
        const recipe = allRecipeData.find(r => r.id === id);
        if (recipe) {
            if (!recipe.tags) recipe.tags = [];
            if (currentlyHasTag) {
                recipe.tags = recipe.tags.filter(t => t !== tagString);
            } else {
                recipe.tags.push(tagString);
            }
        }

        // 3. Re-render the table instantly to show the new button color —
        // through applyAdminFilters() (not a raw renderUnifiedManager call)
        // so an active search/category filter doesn't get silently dropped
        // right when you click a tag (that's what made this feel like it
        // "kicked you out" of the list).
        applyAdminFilters();

    } catch (error) {
        console.error("Error updating tag:", error);
        alert("Could not update tag: " + error.message);
    }
};

window.syncViewCounts = async function() {
    if(!confirm("Recalculate ALL view counts?")) return;
    const btn = document.getElementById('btn-sync');
    if(btn) btn.innerText = "⏳ Counting...";
    try {
        const snap = await getDocs(collection(db, "recipe_views"));
        const counts = {};
        snap.forEach(doc => {
            const rid = doc.data().recipeId;
            if(rid) counts[rid] = (counts[rid] || 0) + 1;
        });
        for (const [id, count] of Object.entries(counts)) {
            if (allRecipeData.find(r => r.id === id)) {
                await updateDoc(doc(db, "recipes", id), { views: count });
            }
        }
        alert(`Success! Reloading...`);
        location.reload(); 
    } catch (error) { alert("Sync failed: " + error.message); }
};

// HELPERS
function tsToMillis(ts) { return ts && typeof ts.toDate === 'function' ? ts.toDate().getTime() : 0; }
function tsToStr(ts) {
    if (!ts || typeof ts.toDate !== 'function') return "Recently";
    const date = ts.toDate();
    return date.toLocaleDateString() + ", " + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

// key -> { key, name, views: [...], cooks: [...] } — filled by renderActivityRoster,
// read by openPersonActivity when a roster row is clicked.
let personActivityMap = {};

async function loadAnalytics(allRecipes) {
    const leaderboardList = document.getElementById('leaderboard-list');
    try {
        const q = query(collection(db, "recipe_views"), orderBy("timestamp", "desc"), limit(currentActivityLimit));
        const snapshot = await getDocs(q);

        const viewCounts = {};
        const viewDocs = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            viewDocs.push(data);
            const title = data.recipeTitle || "Unknown Recipe";
            viewCounts[title] = (viewCounts[title] || 0) + 1;
        });

        if(leaderboardList) {
            const sortedRecipes = Object.entries(viewCounts).sort(([,countA], [,countB]) => countB - countA).slice(0, 5);
            let lbHtml = "";
            sortedRecipes.forEach(([title, count]) => {
                lbHtml += `<tr><td style="padding: 8px 5px; border-bottom: 1px solid #eee;">${title}</td><td style="font-weight: bold; border-bottom: 1px solid #eee;">${count}</td></tr>`;
            });
            leaderboardList.innerHTML = lbHtml || "<tr><td>No data</td></tr>";
        }
        renderDustyRecipes(allRecipes, viewCounts);
        await renderActivityRoster(viewDocs, allRecipes);
    } catch (error) { console.error("Error loading analytics:", error); }
}

// ==========================================
// ACTIVITY ROSTER (who's been doing what, grouped per person instead of
// one flat "X viewed Y" feed) — click a person to see their full history.
// Combines three sources: recipe_views (opened a specific recipe),
// global_cooks ("I Made This"), and site_visits_log (just opened the site
// at all — added so people who only browse without opening a recipe still
// show up here instead of only counting toward the anonymous Site Usage tally).
// ==========================================
async function renderActivityRoster(viewDocs, allRecipes) {
    const activityList = document.getElementById('activity-list');
    if (!activityList) return;

    let cookDocs = [];
    try {
        const cookSnap = await getDocs(query(collection(db, "global_cooks"), orderBy("timestamp", "desc"), limit(currentActivityLimit)));
        cookSnap.forEach(d => cookDocs.push(d.data()));
    } catch (e) { console.error("Could not load cook history for the activity roster:", e); }

    let visitDocs = [];
    try {
        const visitSnap = await getDocs(query(collection(db, "site_visits_log"), orderBy("timestamp", "desc"), limit(currentActivityLimit)));
        visitSnap.forEach(d => visitDocs.push(d.data()));
    } catch (e) { console.error("Could not load site-visit history for the activity roster:", e); }

    // Group per person.
    //
    // The tricky part: `uid` was only added to recipe_views recently, so one
    // person's history is a mix of newer records that HAVE a uid and older
    // ones that only have a display name. Keying naively on `uid || name`
    // therefore split the same person into two rows — which is exactly the
    // "some people are on there multiple times" problem.
    //
    // So: first learn every name→uid pairing from the records that do carry
    // a uid, then use that to attach the older name-only records to the same
    // person instead of stranding them in their own row.
    const normalize = (name) => String(name || "").trim().toLowerCase();
    const nameToUid = {};
    const learnName = (uid, name) => {
        if (uid && normalize(name)) nameToUid[normalize(name)] = uid;
    };

    viewDocs.forEach(v => learnName(v.uid, v.viewer));
    cookDocs.forEach(c => learnName(c.uid, c.chef));
    visitDocs.forEach(v => learnName(v.uid, v.viewerName));

    const personKey = (uid, name) =>
        uid || nameToUid[normalize(name)] || `name:${normalize(name) || "guest"}`;

    const people = {};

    viewDocs.forEach(v => {
        const key = personKey(v.uid, v.viewer);
        if (!people[key]) people[key] = { key, name: v.viewer || "Guest", views: [], cooks: [], visits: [] };
        if (v.viewer) people[key].name = v.viewer;
        people[key].views.push(v);
    });

    cookDocs.forEach(c => {
        const key = personKey(c.uid, c.chef);
        if (!people[key]) people[key] = { key, name: c.chef || "Family Member", views: [], cooks: [], visits: [] };
        if (c.chef) people[key].name = c.chef;
        people[key].cooks.push(c);
    });

    visitDocs.forEach(v => {
        const key = personKey(v.uid, v.viewerName);
        if (!people[key]) people[key] = { key, name: v.viewerName || "Family Member", views: [], cooks: [], visits: [] };
        if (v.viewerName) people[key].name = v.viewerName;
        people[key].visits.push(v);
    });

    const roster = Object.values(people).map(p => {
        const lastViewMillis = p.views[0] ? tsToMillis(p.views[0].timestamp) : 0;
        const lastCookMillis = p.cooks[0] ? tsToMillis(p.cooks[0].timestamp) : 0;
        const lastVisitMillis = p.visits[0] ? tsToMillis(p.visits[0].timestamp) : 0;
        return { ...p, lastViewMillis, lastCookMillis, lastVisitMillis, lastActivityMillis: Math.max(lastViewMillis, lastCookMillis, lastVisitMillis) };
    }).sort((a, b) => b.lastActivityMillis - a.lastActivityMillis);

    personActivityMap = {};
    roster.forEach(p => { personActivityMap[p.key] = p; });

    if (roster.length === 0) {
        activityList.innerHTML = "<p>No activity yet.</p>";
        return;
    }

    activityList.innerHTML = roster.map(p => {
        let lastActivityText = "No recent activity";
        let lastActivityTs = null;

        if (p.lastActivityMillis > 0) {
            if (p.lastActivityMillis === p.lastCookMillis) {
                const recipeName = (allRecipes.find(r => r.id === p.cooks[0].recipeId) || {}).name;
                lastActivityText = `🎉 cooked <strong>${recipeName || "a recipe"}</strong>`;
                lastActivityTs = p.cooks[0].timestamp;
            } else if (p.lastActivityMillis === p.lastViewMillis) {
                lastActivityText = `👀 viewed <strong>${p.views[0].recipeTitle || "a recipe"}</strong>`;
                lastActivityTs = p.views[0].timestamp;
            } else {
                lastActivityText = `🏠 visited the site`;
                lastActivityTs = p.visits[0].timestamp;
            }
        }
        const timeStr = lastActivityTs ? tsToStr(lastActivityTs) : "";

        return `
            <div style="padding: 10px; border-bottom: 1px solid #f3f4f6; font-size: 13px; cursor: pointer;" onclick="openPersonActivity('${p.key.replace(/'/g, "\\'")}')">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <strong>${p.name}</strong>
                    <span style="font-size:11px; color:#8b5cf6; font-weight:700; white-space:nowrap;">${p.views.length} view${p.views.length === 1 ? '' : 's'} · ${p.cooks.length} cook${p.cooks.length === 1 ? '' : 's'} · ${p.visits.length} visit${p.visits.length === 1 ? '' : 's'}</span>
                </div>
                <div style="color: #6b7280; margin-top: 2px;">${lastActivityText}</div>
                <div style="color: #9ca3af; font-size: 11px;">🕒 ${timeStr}</div>
            </div>`;
    }).join('');
}

window.openPersonActivity = function(key) {
    const person = personActivityMap[key];
    const modal = document.getElementById('person-activity-modal');
    const titleEl = document.getElementById('person-activity-title');
    const bodyEl = document.getElementById('person-activity-body');
    if (!person || !modal) return;

    titleEl.innerText = `🕵️‍♀️ ${person.name}`;

    const combined = [
        ...person.views.map(v => ({ type: 'view', title: v.recipeTitle || 'a recipe', ts: v.timestamp })),
        ...person.cooks.map(c => ({ type: 'cook', title: (allRecipeData.find(r => r.id === c.recipeId) || {}).name || 'a recipe', ts: c.timestamp })),
        ...person.visits.map(v => ({ type: 'visit', title: '', ts: v.timestamp }))
    ].sort((a, b) => tsToMillis(b.ts) - tsToMillis(a.ts));

    const LABELS = { cook: '🎉 Cooked', view: '👀 Viewed', visit: '🏠 Visited the site' };

    bodyEl.innerHTML = combined.length
        ? combined.map(item => `
            <div style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 13px;">
                <strong>${LABELS[item.type]}</strong> ${item.title}
                <div style="color: #9ca3af; font-size: 11px;">🕒 ${tsToStr(item.ts)}</div>
            </div>`).join('')
        : "<p>No activity found.</p>";

    modal.style.display = 'flex';
};
window.closePersonActivityModal = function() {
    const modal = document.getElementById('person-activity-modal');
    if (modal) modal.style.display = 'none';
};

async function loadPendingRecipes() {
    const loadingDiv = document.getElementById('loading');
    const listContainer = document.getElementById('pending-list');
    if(!listContainer) return;
    try {
        const querySnapshot = await getDocs(collection(db, "pending_recipes"));
        if (querySnapshot.empty) { if(loadingDiv) loadingDiv.innerText = "No pending recipes!"; return; }
        if(loadingDiv) loadingDiv.style.display = 'none';
        let html = '';
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const ingredients = data.ingredients || data.recipeIngredient || [];
            const instructions = data.instructions || data.recipeInstructions || [];
            const category = (data.tags && data.tags[0]) || data.category || "Uncategorized";

            const ingHtml = Array.isArray(ingredients) && ingredients.length > 0
                ? `<ul>${ingredients.map(i => `<li>${i}</li>`).join('')}</ul>`
                : `<p class="pending-empty">No ingredients listed.</p>`;

            const instHtml = Array.isArray(instructions) && instructions.length > 0
                ? `<ol>${instructions.map(s => `<li>${s}</li>`).join('')}</ol>`
                : `<p class="pending-empty">No instructions listed.</p>`;

            const notesHtml = data.notes ? `<div class="pending-notes"><strong>📝 Notes:</strong> ${data.notes}</div>` : '';

            html += `
                <div class="pending-card" id="card-${doc.id}">
                    <div class="pending-header"><h2>${data.name || "Untitled"}</h2><span>${data.author || "Unknown"} · ${category}</span></div>
                    <div class="pending-body">
                        <div class="pending-col">
                            <h4>Ingredients</h4>
                            ${ingHtml}
                        </div>
                        <div class="pending-col">
                            <h4>Instructions</h4>
                            ${instHtml}
                        </div>
                    </div>
                    ${notesHtml}
                    <div class="pending-actions">
                        <button class="btn-approve" onclick="approveRecipe('${doc.id}')">✅ Approve</button>
                        <button class="btn-reject" onclick="rejectRecipe('${doc.id}')">❌ Reject</button>
                    </div>
                </div>`;
        });
        listContainer.innerHTML = html;
    } catch (error) { console.error(error); }
}

window.approveRecipe = async function(id) {
    if(!confirm("Publish?")) return;
    try {
        const snap = await getDoc(doc(db, "pending_recipes", id));
        await addDoc(collection(db, "recipes"), { ...snap.data(), reviewed: true, createdAt: new Date() });
        await deleteDoc(doc(db, "pending_recipes", id));
        document.getElementById(`card-${id}`).remove();
    } catch (e) { alert(e.message); }
};
window.rejectRecipe = async function(id) {
    if(confirm("Delete?")) { await deleteDoc(doc(db, "pending_recipes", id)); document.getElementById(`card-${id}`).remove(); }
};
// ==========================================
// FAMILY MEMBER INVITES (self-service signup — no admin credentials ever
// touch the browser; the invited person creates their own account via
// invite.html + scripts/invite-signup.js)
// ==========================================
window.createInvite = async function() {
    const nameInput = document.getElementById('invite-name');
    const emailInput = document.getElementById('invite-email');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    if (!name || !email) return alert("Name and email are both required.");

    console.log(`👪 [INVITE] Creating invite for ${name} <${email}>...`);

    try {
        // Invites always create a normal user account — Admin access is
        // never granted at signup (see firestore.rules), only afterward via
        // "Manage Admin Access" once they've signed up.
        const inviteRef = await addDoc(collection(db, "invites"), {
            name,
            email,
            used: false,
            createdAt: serverTimestamp()
        });

        const basePath = location.pathname.replace(/admin\.html$/, '');
        const link = `${location.origin}${basePath}invite.html?id=${inviteRef.id}`;
        document.getElementById('invite-link-output').value = link;
        document.getElementById('invite-result').style.display = 'block';

        console.log("✅ [INVITE] Created:", inviteRef.id);
        nameInput.value = "";
        emailInput.value = "";
        loadPendingInvites();
    } catch (e) {
        console.error("🔥 [INVITE] Could not create invite:", e);
        alert("Could not create invite: " + e.message);
    }
};

window.copyInviteLink = function() {
    const input = document.getElementById('invite-link-output');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => alert("Link copied!"));
};

window.loadPendingInvites = async function() {
    const list = document.getElementById('pending-invites-list');
    if (!list) return;
    try {
        const snap = await getDocs(query(collection(db, "invites"), orderBy("createdAt", "desc")));
        const pending = [];
        snap.forEach(d => { const data = d.data(); if (!data.used) pending.push({ id: d.id, ...data }); });

        if (pending.length === 0) { list.innerHTML = ''; return; }

        list.innerHTML = `<p style="font-size:11px; color:#6b7280; margin-bottom:6px;">Pending invites (not signed up yet):</p>` +
            pending.map(inv => `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #f3f4f6; font-size:12px;">
                    <span>${inv.name} (${inv.email})</span>
                    <button onclick="revokeInvite('${inv.id}')" style="background:#fee2e2; color:#b91c1c; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; white-space:nowrap;">Revoke</button>
                </div>`).join('');
    } catch (e) {
        console.error("🔥 [INVITE] Could not load pending invites:", e);
    }
};

window.revokeInvite = async function(id) {
    if (!confirm("Revoke this invite? The link will stop working.")) return;
    try {
        await deleteDoc(doc(db, "invites", id));
        console.log("🗑️ [INVITE] Revoked:", id);
        loadPendingInvites();
    } catch (e) { alert("Could not revoke: " + e.message); }
};

// ==========================================
// MANAGE ADMIN ACCESS — promote/demote anyone straight from the console,
// no code edits or redeploy needed (unlike the original 3 ADMIN_UIDS, which
// stay hardcoded on purpose — see the comment on ADMIN_UIDS above).
// ==========================================
window.loadAdminUsersList = async function() {
    const listEl = document.getElementById('admin-users-list');
    if (!listEl) return;

    listEl.innerHTML = "<p style='color:#9ca3af; font-size:13px;'>Loading users...</p>";

    try {
        const snap = await getDocs(collection(db, "users"));
        const users = [];
        snap.forEach(d => users.push({ uid: d.id, ...d.data() }));
        users.sort((a, b) => (a.Name || a.email || "").localeCompare(b.Name || b.email || ""));

        console.log(`👑 [ADMIN ACCESS] Loaded ${users.length} user(s).`);

        if (users.length === 0) {
            listEl.innerHTML = "<p style='color:#9ca3af; font-size:13px;'>No users found.</p>";
            return;
        }

        listEl.innerHTML = users.map(u => {
            const isBuiltIn = ADMIN_UIDS.includes(u.uid);
            const isRoleAdmin = u.role === 'admin';
            const label = u.Name || u.email || u.uid;

            let statusBadge, actionBtn;
            if (isBuiltIn) {
                statusBadge = `<span style="background:#e0e7ff; color:#3730a3; font-size:11px; font-weight:700; padding:3px 8px; border-radius:10px;" title="Set in code (ADMIN_UIDS) — can't be changed here">🔒 Admin (built-in)</span>`;
                actionBtn = '';
            } else if (isRoleAdmin) {
                statusBadge = `<span style="background:#d1fae5; color:#065f46; font-size:11px; font-weight:700; padding:3px 8px; border-radius:10px;">👑 Admin</span>`;
                actionBtn = `<button onclick="demoteToUser('${u.uid}', '${label.replace(/'/g, "\\'")}')" style="background:#fee2e2; color:#b91c1c; border:none; padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer; white-space:nowrap;">Demote to User</button>`;
            } else {
                statusBadge = `<span style="background:#f3f4f6; color:#374151; font-size:11px; font-weight:700; padding:3px 8px; border-radius:10px;">User</span>`;
                actionBtn = `<button onclick="promoteToAdmin('${u.uid}', '${label.replace(/'/g, "\\'")}')" style="background:#16a34a; color:white; border:none; padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold; white-space:nowrap;">Promote to Admin</button>`;
            }

            return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f3f4f6; font-size:13px; flex-wrap:wrap;">
                    <div>
                        <div style="font-weight:600;">${label}</div>
                        ${u.email && u.Name ? `<div style="font-size:11px; color:#9ca3af;">${u.email}</div>` : ''}
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${statusBadge}
                        ${actionBtn}
                    </div>
                </div>`;
        }).join('');
    } catch (e) {
        console.error("🔥 [ADMIN ACCESS] Could not load users:", e);
        listEl.innerHTML = "<p style='color:red; font-size:13px;'>Could not load users: " + e.message + "</p>";
    }
};

window.promoteToAdmin = async function(uid, label) {
    if (!confirm(`Give ${label} Admin access? They'll be able to edit/delete recipes, manage users, and see all dashboard data.`)) return;
    try {
        await updateDoc(doc(db, "users", uid), { role: 'admin' });
        console.log(`✅ [ADMIN ACCESS] Promoted ${label} (${uid}) to admin.`);
        loadAdminUsersList();
    } catch (e) {
        console.error("🔥 [ADMIN ACCESS] Promote failed:", e);
        alert("Could not promote: " + e.message);
    }
};

window.demoteToUser = async function(uid, label) {
    if (!confirm(`Remove Admin access from ${label}?`)) return;
    try {
        await updateDoc(doc(db, "users", uid), { role: 'user' });
        console.log(`✅ [ADMIN ACCESS] Demoted ${label} (${uid}) to user.`);
        loadAdminUsersList();
    } catch (e) {
        console.error("🔥 [ADMIN ACCESS] Demote failed:", e);
        alert("Could not demote: " + e.message);
    }
};

window.postAnnouncement = async function() {
    const input = document.getElementById('announce-input');
    if (input.value) { await addDoc(collection(db, "announcements"), { message: input.value, type: "alert", timestamp: serverTimestamp() }); alert("Posted!"); input.value=""; }
};
window.uploadBulkRecipes = async function() {
    const input = document.getElementById('bulk-input');
    try {
        const recipes = JSON.parse(input.value);
        if(confirm(`Upload ${recipes.length}?`)) {
            for(const r of recipes) {
                const ingredients = r.recipeIngredient || r.ingredients || [];
                const instructions = r.recipeInstructions || r.instructions || [];
                await addDoc(collection(db, "recipes"), {
                    name: r.name, author: r.author, tags: r.tags,
                    ingredients, recipeIngredient: ingredients,
                    instructions, recipeInstructions: instructions,
                    notes: r.notes || "",
                    reviewed: false
                });
            }
            alert("Done!"); input.value="";
        }
    } catch(e) { alert("Invalid JSON"); }
};
function renderDeepStats(recipes) {
    const cookCountEl = document.getElementById('total-cooks-count');
    getDocs(collection(db, "global_cooks")).then(snap => { if(cookCountEl) cookCountEl.innerText = snap.size.toLocaleString(); });
    const catListEl = document.getElementById('category-stats-list');
    if(!catListEl) return;

    const totalEl = document.getElementById('stats-total-count');
    if (totalEl) totalEl.innerText = `${recipes.length} total recipe${recipes.length === 1 ? '' : 's'}`;

    const categoryCounts = {};
    recipes.forEach(data => {
        let cat = "Uncategorized";
        if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) cat = data.tags[0];
        else if (data.category) cat = data.category;
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
    const sortedCats = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
    let html = "";
    sortedCats.forEach(([catName, count]) => {
        const percent = Math.round((count / recipes.length) * 100);
        html += `<div style="margin-bottom:5px;"><div style="display:flex; justify-content:space-between; font-size:12px;"><strong>${catName}</strong><span>${count}</span></div><div style="background:#f3f4f6; height:6px;"><div style="width:${percent}%; background:#59c3c3; height:100%;"></div></div></div>`;
    });
    catListEl.innerHTML = html;
}
// ==========================================
// FREE SITE USAGE CHART (from the "site_visits" collection, no billing needed)
// ==========================================
let usageDailyCounts = {};

async function loadUsageStats() {
    const chartEl = document.getElementById('usage-chart');
    if (!chartEl) return;

    try {
        const snap = await getDocs(collection(db, "site_visits"));
        usageDailyCounts = {};
        snap.forEach(d => { usageDailyCounts[d.id] = d.data().count || 0; });
        renderUsageChart('day');
    } catch (error) {
        console.error("Error loading usage stats:", error);
        chartEl.innerHTML = "<p style='color:#9ca3af; font-size:13px;'>Could not load usage stats.</p>";
    }
}

function dateKey(d) { return d.toISOString().slice(0, 10); }

function renderUsageChart(range) {
    const chartEl = document.getElementById('usage-chart');
    if (!chartEl) return;

    const today = new Date();
    let buckets = [];

    if (range === 'day') {
        for (let i = 13; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            buckets.push({
                label: d.toLocaleDateString('en-US', { weekday: 'short' }),
                value: usageDailyCounts[dateKey(d)] || 0
            });
        }
    } else if (range === 'week') {
        for (let i = 7; i >= 0; i--) {
            let sum = 0;
            for (let j = 0; j < 7; j++) {
                const d = new Date(today);
                d.setDate(d.getDate() - (i * 7 + j));
                sum += usageDailyCounts[dateKey(d)] || 0;
            }
            const weekStart = new Date(today);
            weekStart.setDate(weekStart.getDate() - (i * 7 + 6));
            buckets.push({ label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: sum });
        }
    } else { // month
        for (let i = 5; i >= 0; i--) {
            const monthDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const monthKey = monthDate.toISOString().slice(0, 7); // YYYY-MM
            let sum = 0;
            Object.keys(usageDailyCounts).forEach(key => {
                if (key.startsWith(monthKey)) sum += usageDailyCounts[key];
            });
            buckets.push({ label: monthDate.toLocaleDateString('en-US', { month: 'short' }), value: sum });
        }
    }

    const max = Math.max(...buckets.map(b => b.value), 1);
    chartEl.innerHTML = buckets.map(b => `
        <div style="display:flex; flex-direction:column; align-items:center; flex:1; gap:6px;">
            <div style="font-size:11px; font-weight:700; color:#374151;">${b.value}</div>
            <div style="width:100%; max-width:28px; background:#f3f4f6; border-radius:4px; height:90px; display:flex; align-items:flex-end; overflow:hidden;">
                <div style="width:100%; background:linear-gradient(180deg, #10b981, #059669); height:${(b.value / max) * 100}%;"></div>
            </div>
            <div style="font-size:10px; color:#6b7280; text-align:center;">${b.label}</div>
        </div>
    `).join('');
}

window.setUsageRange = function(range, btn) {
    document.querySelectorAll('.usage-range-btn').forEach(b => b.classList.remove('active-filter'));
    if (btn) btn.classList.add('active-filter');
    renderUsageChart(range);
};

function renderDustyRecipes(recipes, viewCounts) {
    const dustyList = document.getElementById('dusty-list');
    if(!dustyList) return;
    let html = "";
    let count = 0;
    recipes.forEach(r => { if (!viewCounts[r.name]) { count++; html += `<div style="padding:5px 0; border-bottom:1px solid #eee; font-size:13px;">${r.name}</div>`; }});
    dustyList.innerHTML = count === 0 ? "<p style='color:green;'>All viewed!</p>" : html;
}
window.loadReports = async function() {
    const list = document.getElementById('issues-list');
    if(!list) return;
    const q = query(collection(db, "recipe_reports"), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    let html = "";
    snap.forEach(doc => { html += `<div style="background:#fff5f5; padding:5px; margin-bottom:5px;">${doc.data().recipeName}: ${doc.data().issue} <button onclick="resolveIssue('${doc.id}')">✅</button></div>`; });
    list.innerHTML = html || "No issues.";
};
window.resolveIssue = async function(id) { if(confirm("Resolve?")) { await deleteDoc(doc(db, "recipe_reports", id)); window.loadReports(); }};
window.openStatsModal = function() { const m = document.getElementById('stats-modal'); if(m) { m.style.display='flex'; renderDeepStats(allRecipeData); }};
window.closeStatsModal = function() { document.getElementById('stats-modal').style.display='none'; };
window.generateMegaIndex = async function() {
    if(!confirm("Update Homepage?")) return;
    
    const snap = await getDocs(collection(db, "recipes"));
    const list = [];
    
    snap.forEach(d => {
        const data = d.data();
        const ingredients = data.ingredients || data.recipeIngredient || [];
        list.push({
            id: d.id,
            n: data.name || "Untitled",
            a: data.author || "Family",          // 👨‍🍳 ADDED THIS BACK IN!
            t: data.tags || [],
            c: data.category || "Misc",
            r: data.reviewed || false,
            h: data.isHidden === true,
            // Compact lowercase ingredient text so homepage search can match ingredients too
            ing: Array.isArray(ingredients) ? ingredients.join(' ').toLowerCase() : String(ingredients).toLowerCase()
        });
    });
    
    console.log("🚀 SAVING THIS TO FIREBASE INDEX:", list);
    
    try {
        await setDoc(doc(db, "static_assets", "cookbook_index"), { recipes: list });
        alert("Index Updated! Authors restored."); 
    } catch (error) {
        console.error("FIREBASE SAVE ERROR:", error);
        alert("Error saving: " + error.message);
    }
};
// --- NEW: ADMIN FILTERING LOGIC ---
let currentAdminCategory = "All";

window.filterAdmin = function(category) {
    currentAdminCategory = category;
    applyAdminFilters();
};

function applyAdminFilters() {
    const searchInput = document.getElementById('manager-search');
    const term = searchInput ? searchInput.value.toLowerCase().trim() : "";
    
    let filtered = allRecipeData;

    // 1. Filter by Category First
    if (currentAdminCategory !== "All") {
        filtered = filtered.filter(r => {
            let cat = "Misc";
            if (r.tags && Array.isArray(r.tags) && r.tags.length > 0) cat = r.tags[0];
            else if (r.category) cat = r.category;
            return cat.includes(currentAdminCategory);
        });
    }

    // 2. Filter by Search Term Second
    if (term) {
        filtered = filtered.filter(r => 
            (r.name || "").toLowerCase().includes(term) || 
            (r.author || "").toLowerCase().includes(term)
        );
    }

    renderUnifiedManager(filtered);
};
// ==========================================
// DATA BACKUP EXPORT
// ==========================================
window.exportRecipes = function() {
    if (!allRecipeData || allRecipeData.length === 0) {
        alert("No recipes loaded to export. Please wait a moment and try again.");
        return;
    }

    if(!confirm(`Download a backup of all ${allRecipeData.length} recipes?`)) return;

    // 1. Convert the recipe array into a nicely formatted JSON string
    const dataStr = JSON.stringify(allRecipeData, null, 2);
    
    // 2. Create a Blob (a file-like object)
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    // 3. Create a temporary invisible link to trigger the download
    const a = document.createElement("a");
    a.href = url;
    
    // Name the file with today's date so you know when you backed it up!
    const date = new Date().toISOString().split('T')[0]; // Gets YYYY-MM-DD
    a.download = `Family_Cookbook_Backup_${date}.json`;
    
    // 4. Click the link and clean up
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
// ==========================================
// REPORTED ISSUES LOGIC
// ==========================================
window.loadReportedIssues = async function() {
    const tbody = document.getElementById('reports-table-body');
    if (!tbody) return;
    
    try {
        const snap = await getDocs(collection(db, "recipe_reports")); 
        
        if (snap.empty) {
            tbody.innerHTML = `<tr class="reports-empty-row"><td colspan="5" style="text-align:center; padding: 15px; color: var(--primary);">No reported issues! 🎉</td></tr>`;
            return;
        }
        
        let html = "";
        snap.forEach(d => {
            const data = d.data();
            
            // 1. Robust Date Parsing (Fixes the "Unknown" bug)
            let dateStr = "Unknown";
            if (data.createdAt) {
                if (typeof data.createdAt.toDate === 'function') {
                    dateStr = data.createdAt.toDate().toLocaleDateString();
                } else if (data.createdAt.seconds) {
                    dateStr = new Date(data.createdAt.seconds * 1000).toLocaleDateString();
                } else {
                    // Fallback for normal string dates
                    dateStr = new Date(data.createdAt).toLocaleDateString(); 
                }
            }

            // 2. Get Reporter Info
            const reporter = data.userName || data.userEmail || "Anonymous";
            
            const recipeId = data.recipeId || "";
            const recipeName = data.recipeName || "View Recipe";
            const issue = data.issue || data.message || data.reason || "No details provided";
            
            html += `
                <tr id="report-${d.id}" style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 10px; color: var(--primary);">${dateStr}</td>
                    <td style="padding: 10px; font-weight: bold; color: var(--accent-teal);">${reporter}</td>
                    <td style="padding: 10px;">
                        <a href="recipe.html?id=${recipeId}" target="_blank" style="color: var(--primary); font-weight: bold; text-decoration: underline;">${recipeName}</a>
                    </td>
                    <td style="padding: 10px; color: var(--primary);">${issue}</td>
                    <td style="padding: 10px;">
                        <button onclick="resolveReport('${d.id}')" class="pill-btn btn-teal" style="padding: 5px 10px; font-size: 12px;">✅ Resolve</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } catch (e) {
        console.error("Error loading reports:", e);
        tbody.innerHTML = `<tr class="reports-empty-row"><td colspan="5" style="text-align:center; padding: 15px; color: red;">Error loading reports.</td></tr>`;
    }
};

window.resolveReport = async function(reportId) {
    if(!confirm("Mark this issue as resolved and remove it from the list?")) return;
    try {
        const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js");
        await deleteDoc(doc(db, "recipe_reports", reportId));

        const row = document.getElementById(`report-${reportId}`);
        if(row) row.remove();

        const tbody = document.getElementById('reports-table-body');
        if (tbody && tbody.children.length === 0) {
             tbody.innerHTML = `<tr class="reports-empty-row"><td colspan="5" style="text-align:center; padding: 15px; color: var(--primary);">No reported issues! 🎉</td></tr>`;
        }
    } catch (e) {
        alert("Error resolving report: " + e.message);
    }
};

// ==========================================
// WEBSITE-INTEGRATED AI RECIPE SCAN
// Calls a local Ollama install directly from this page — free, and nothing
// leaves this computer. Only works when Ollama is running on the same
// machine you're viewing this page from. See local-tools/scan-recipe/README.md.
// ==========================================
// Keep this list in sync with submit.html's #category, edit-recipe.html's
// #e-category, the admin filter pills above, and the folder buttons in
// homepage.html.
const SCAN_CATEGORIES = [
    'Appetizers & Snacks', 'Breads & Rolls', 'Breakfast', 'Desserts', 'Dutch Oven',
    'Main Dishes', 'Miscellaneous', 'Sauces, Dressings & Marinades', 'Sides & Veggies', 'Soups & Salads'
];

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

const MAX_PDF_PAGES = 10; // safety cap so one huge PDF can't hang the browser/model — bump if you regularly scan longer multi-recipe documents

async function pdfFileToImages(file) {
    if (!window.pdfjsLib) throw new Error("PDF support didn't load — check your internet connection and reload the page.");

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const images = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        images.push(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
    }

    images.truncated = pdf.numPages > MAX_PDF_PAGES ? pdf.numPages : null;
    return images;
}

function getOllamaBaseUrl() {
    const input = document.getElementById('ollama-server-url');
    const typed = input ? input.value.trim() : '';
    const saved = typed || localStorage.getItem('ollamaServerUrl') || 'http://localhost:11434';
    if (typed) localStorage.setItem('ollamaServerUrl', typed);
    return saved.replace(/\/$/, ''); // strip trailing slash
}

function getOllamaModel() {
    const input = document.getElementById('ollama-model-name');
    const typed = input ? input.value.trim() : '';
    const saved = typed || localStorage.getItem('ollamaModelName') || 'llama3.2-vision';
    if (typed) localStorage.setItem('ollamaModelName', typed);
    return saved;
}

// One file can contain anywhere from 0 to many recipes: a single photo
// might catch two recipes side by side on a cookbook spread, a multi-page
// PDF might be one recipe that spans every page, or it might be several
// separate recipes with no way to know the count ahead of time. So every
// file is scanned as "find ALL the recipes in here" and always returns an
// array, rather than assuming one file == one recipe.
async function scanOneFile(file) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const images = isPdf ? await pdfFileToImages(file) : [await fileToBase64(file)];
    const truncatedAt = images.truncated || null; // set by pdfFileToImages if the PDF had more pages than MAX_PDF_PAGES

    const prompt = `You are reading ${images.length > 1 ? `${images.length} pages/photos of a recipe document` : 'a photo of a recipe card/cookbook page'}.

This may contain a SINGLE recipe (possibly spread across all the pages/photos given), or it may contain MULTIPLE SEPARATE recipes (even within one page/photo, like a cookbook spread). Carefully figure out how many distinct recipes are actually present:
- If ingredients/instructions clearly continue from one page to the next, that's still ONE recipe — combine its content across those pages.
- If a new title/ingredient list starts partway through, that's a NEW, separate recipe.

Respond with ONLY raw JSON (no markdown fences, no commentary): a JSON ARRAY containing one object per distinct recipe found, in this shape:
[
  {
    "name": "Recipe title",
    "author": "Person's name if credited on the card, otherwise an empty string",
    "category": "One of: ${SCAN_CATEGORIES.join(' | ')}",
    "ingredients": ["one ingredient per array item, as written"],
    "instructions": ["one step per array item, in order"],
    "notes": "Any extra notes/tips on the card, or an empty string"
  }
]

If nothing readable/recipe-like is present, respond with an empty array: []`;

    const res = await fetch(`${getOllamaBaseUrl()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: getOllamaModel(),
            prompt,
            images,
            stream: false,
            format: 'json'
        })
    });

    if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error || ''; } catch (e) { /* body wasn't JSON */ }
        if (/unknown model architecture/i.test(detail)) {
            throw new Error(`Ollama can't load "${getOllamaModel()}" (unsupported on your installed Ollama version) — try a different model in "🧠 Model not loading?" below, e.g. llava`);
        }
        throw new Error(`Ollama returned ${res.status}${detail ? ': ' + detail : ''}`);
    }

    const data = await res.json();
    const raw = (data.response || '').trim();
    const cleaned = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);

    // Be defensive: models don't always follow "always return an array"
    // instructions perfectly, so accept a bare object too.
    const recipes = Array.isArray(parsed) ? parsed : [parsed];

    const formatted = recipes
        .filter(r => r && !r.error && (r.name || (r.ingredients && r.ingredients.length)))
        .map(r => ({
            name: r.name || 'Untitled',
            author: r.author || '',
            tags: [SCAN_CATEGORIES.includes(r.category) ? r.category : 'Miscellaneous'],
            ingredients: r.ingredients || [],
            instructions: r.instructions || [],
            notes: r.notes || ''
        }));

    return { recipes: formatted, truncatedAt };
}

window.scanRecipePhoto = async function() {
    const fileInput = document.getElementById('scan-photo-input');
    const statusEl = document.getElementById('scan-photo-status');
    const resultBox = document.getElementById('scan-photo-result');
    const btn = document.getElementById('scan-photo-btn');

    const files = Array.from(fileInput.files || []);
    if (files.length === 0) { statusEl.innerText = "Choose one or more photos/PDFs first."; return; }

    // Browsers permanently block a secure (HTTPS) page from calling a plain
    // HTTP address — including Ollama at localhost — with no way to opt in
    // from this side. If we're on the live HTTPS site, fail fast with a
    // clear explanation instead of a cryptic "Load failed" from the browser.
    const ollamaUrl = getOllamaBaseUrl();
    if (location.protocol === 'https:' && ollamaUrl.startsWith('http://')) {
        statusEl.innerHTML = `❌ Can't reach Ollama from the secure (https://) site — browsers block that connection entirely, there's no setting to allow it.<br>Run <code>node local-tools/scan-recipe/serve-locally.mjs</code> and open the printed <code>http://localhost:8080</code> link instead, then scan from there.`;
        return;
    }

    btn.disabled = true;
    resultBox.style.display = 'none';

    const results = [];
    const failures = [];
    const warnings = [];

    // Scan one file at a time — local models handle one request at a time
    // much more reliably than several fired off in parallel.
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        statusEl.innerText = `⏳ Scanning ${i + 1} of ${files.length}: ${file.name}...`;
        try {
            const { recipes: found, truncatedAt } = await scanOneFile(file);
            if (found.length === 0) {
                failures.push(`${file.name} (no recipe found)`);
            } else {
                results.push(...found);
                if (found.length > 1) console.log(`${file.name}: found ${found.length} recipes in one file.`);
            }
            if (truncatedAt) {
                warnings.push(`${file.name} has ${truncatedAt} pages, only the first ${MAX_PDF_PAGES} were scanned — split it if recipes are missing.`);
            }
        } catch (error) {
            console.error(`Scan failed for ${file.name}:`, error);
            failures.push(`${file.name} (${error.message})`);
        }
    }

    btn.disabled = false;

    if (results.length > 0) {
        document.getElementById('scan-photo-json').value = JSON.stringify(results, null, 2);
        resultBox.style.display = 'block';
    }

    let summary = `✅ Found ${results.length} recipe(s) across ${files.length} file(s).`;
    if (warnings.length > 0) summary += ` ⚠️ ${warnings.join(' ')}`;
    if (failures.length > 0) summary += ` Issues: ${failures.join(', ')}.`;
    if (results.length === 0) summary = "❌ Nothing could be scanned — is Ollama running on this computer with OLLAMA_ORIGINS=* ollama serve?";
    statusEl.innerText = summary;
};

window.sendScanToUploadStation = function() {
    const scanJson = document.getElementById('scan-photo-json').value;
    const bulkInput = document.getElementById('bulk-input');

    try {
        const scanned = JSON.parse(scanJson);
        let existing = [];
        if (bulkInput.value.trim()) {
            try {
                existing = JSON.parse(bulkInput.value);
                if (!Array.isArray(existing)) existing = [];
            } catch (e) { existing = []; }
        }
        bulkInput.value = JSON.stringify([...existing, ...scanned], null, 2);
        bulkInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
        alert("Could not merge into the upload box: " + e.message);
    }
};