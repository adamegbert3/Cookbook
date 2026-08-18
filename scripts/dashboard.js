import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc, deleteDoc, updateDoc, 
    query, orderBy, limit, where, serverTimestamp, 
    arrayUnion, arrayRemove, deleteField
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { getSections, hasRealSections, getEditableText, buildRecipeFields } from './recipe-model.js';
import { createHousehold, listHouseholds, getHousehold, assignUserToHousehold } from './household.js';
import { parseRecipeFromHtml } from './recipe-import.js';
import { triggerDriveSyncSilently } from './drive-sync-trigger.js';

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
    loadAdminHouseholds();
    loadSuggestions();
    loadResetRequests();

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
    const isDraft = r.isDraft === true;
    const isReviewed = r.reviewed === true;
    const viewCount = r.views || 0;

    let badge = `<span class="status-badge status-live">🟢 Live</span>`;
    if (isDraft) badge = `<span class="status-badge status-hidden">🍳 Testing Kitchen</span>`;
    else if (!isReviewed) badge = `<span class="status-badge status-review">⚠️ Review</span>`;
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
        triggerDriveSyncSilently();
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
        triggerDriveSyncSilently();
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

// Every account, loaded with the roster so the person picker can offer the
// whole family rather than only people who already have activity.
let knownUsers = [];

// Names the app wrote when it couldn't identify anyone (see the note in
// renderActivityRoster). Module-level so reassignActivity can warn too.
const PLACEHOLDER_ACTIVITY_NAMES = ['family member', 'guest', 'unknown', ''];
function isPlaceholderName(name) {
    return PLACEHOLDER_ACTIVITY_NAMES.includes(String(name || '').trim().toLowerCase());
}

async function loadAnalytics(allRecipes) {
    const leaderboardList = document.getElementById('leaderboard-list');
    try {
        const q = query(collection(db, "recipe_views"), orderBy("timestamp", "desc"), limit(currentActivityLimit));
        const snapshot = await getDocs(q);

        const viewCounts = {};
        const viewDocs = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            viewDocs.push({ id: docSnap.id, ...data });
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
        cookSnap.forEach(d => cookDocs.push({ id: d.id, ...d.data() }));
    } catch (e) { console.error("Could not load cook history for the activity roster:", e); }

    let visitDocs = [];
    try {
        const visitSnap = await getDocs(query(collection(db, "site_visits_log"), orderBy("timestamp", "desc"), limit(currentActivityLimit)));
        visitSnap.forEach(d => visitDocs.push({ id: d.id, ...d.data() }));
    } catch (e) { console.error("Could not load site-visit history for the activity roster:", e); }

    // Everyone with an account, so the roster is a full family list rather
    // than only whoever happens to have activity. People who've never opened
    // a recipe still get a row saying so.
    knownUsers = [];
    try {
        const usersSnap = await getDocs(collection(db, "users"));
        usersSnap.forEach(u => {
            const data = u.data();
            knownUsers.push({ uid: u.id, name: data.Name || (data.email || '').split('@')[0] || u.id });
        });
        knownUsers.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) { console.error("Could not load profiles for the activity roster:", e); }

    const normalize = (name) => String(name || "").trim().toLowerCase();

    // Placeholder names the app itself wrote when it couldn't identify
    // anyone. The original recordCook (Dec 2025) used
    //   chef: user.displayName || "Family Member"
    // and Firebase leaves displayName null on email/password accounts unless
    // it's explicitly set — so EVERY signed-in person was recorded as
    // "Family Member". These rows therefore represent many different people
    // mixed together, not one person, and can never be assigned to somebody
    // without inventing history.
    const PLACEHOLDER_NAMES = ['family member', 'guest', 'unknown', ''];
    const isPlaceholder = (name) => PLACEHOLDER_NAMES.includes(normalize(name));

    const nameByUid = {};
    const uidByName = {};
    knownUsers.forEach(u => {
        nameByUid[u.uid] = u.name;
        uidByName[normalize(u.name)] = u.uid;
    });

    // `uid` was only added to activity records partway through the project,
    // so older ones store just a display name. Those can still be matched
    // confidently when that name belongs to exactly one profile — which is
    // what folds "Kristen Simpson viewed X" back into Kristen's row instead
    // of stranding it as a separate phantom person. Generic fallback names
    // like "Family Member" match nobody and stay unattributed on purpose.
    const resolveKey = (uid, name) =>
        uid || uidByName[normalize(name)] || `name:${normalize(name) || "guest"}`;

    const people = {};

    // Seed with every account first
    knownUsers.forEach(u => {
        people[u.uid] = { key: u.uid, name: u.name, views: [], cooks: [], visits: [], unlinked: [] };
    });

    const addRecord = (bucket, record, uid, name, collectionPath, nameField) => {
        const key = resolveKey(uid, name);
        if (!people[key]) {
            people[key] = { key, name: name || "Unknown", views: [], cooks: [], visits: [], unlinked: [] };
        }
        if (!uid && nameByUid[key]) people[key].name = nameByUid[key];
        people[key][bucket].push(record);
        // Track records that carry no uid so they can be linked permanently
        if (!uid) people[key].unlinked.push({ id: record.id, collectionPath, nameField });
    };

    viewDocs.forEach(v  => addRecord('views',  v, v.uid, v.viewer,     "recipe_views",    "viewer"));
    cookDocs.forEach(c  => addRecord('cooks',  c, c.uid, c.chef,       "global_cooks",    "chef"));
    visitDocs.forEach(v => addRecord('visits', v, v.uid, v.viewerName, "site_visits_log", "viewerName"));

    // A profile name always beats the copy frozen into a record
    Object.values(people).forEach(p => {
        if (nameByUid[p.key]) p.name = nameByUid[p.key];
    });

    const roster = Object.values(people).map(p => {
        const lastViewMillis = p.views[0] ? tsToMillis(p.views[0].timestamp) : 0;
        const lastCookMillis = p.cooks[0] ? tsToMillis(p.cooks[0].timestamp) : 0;
        const lastVisitMillis = p.visits[0] ? tsToMillis(p.visits[0].timestamp) : 0;
        return { ...p, lastViewMillis, lastCookMillis, lastVisitMillis, lastActivityMillis: Math.max(lastViewMillis, lastCookMillis, lastVisitMillis) };
    }).sort((a, b) => {
        // Most recently active first, then everyone else alphabetically
        if (b.lastActivityMillis !== a.lastActivityMillis) return b.lastActivityMillis - a.lastActivityMillis;
        return a.name.localeCompare(b.name);
    });

    personActivityMap = {};
    roster.forEach(p => { personActivityMap[p.key] = p; });

    if (roster.length === 0) {
        activityList.innerHTML = "<p>No activity yet.</p>";
        return;
    }

    const unlinkedTotal = roster.reduce((n, p) => n + p.unlinked.length, 0);
    const orphanRows = roster.filter(p => p.key.startsWith('name:')).length;

    activityList.innerHTML = `
        ${unlinkedTotal > 0 ? `
            <div style="background:#fffbeb; border:1px solid #fcd34d; border-radius:6px; padding:10px; font-size:12px; color:#92400e; margin-bottom:10px;">
                <strong>${unlinkedTotal} record(s) aren't linked to an account.</strong>
                They were saved before the cookbook recorded who did what. Matching names have been
                grouped with the right person below — tap <strong>Link</strong> to make that permanent
                (which also credits them on the leaderboard).
                ${orphanRows > 0 ? `<br>${orphanRows} row(s) couldn't be matched to anyone and need assigning by hand.` : ''}
            </div>` : ''}
        ${roster.map(p => {
        let lastActivityText = "No activity yet";
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
        const isOrphan = p.key.startsWith('name:');
        const safeKey = p.key.replace(/'/g, "\\'");
        const isIdle = p.lastActivityMillis === 0;

        // A placeholder row isn't a person at all — it's whatever the app
        // couldn't identify, from many people at once. Say so, rather than
        // presenting "Family Member" as though someone by that name exists.
        const legacy = isOrphan && isPlaceholder(p.name);
        const displayName = legacy ? "Unidentified (older records)" : escapeAttr(p.name);

        let actionsHtml = '';
        if (legacy) {
            actionsHtml = `
                <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:8px 10px; margin-top:8px; font-size:11px; color:#6b7280;">
                    The app didn't record who did these — it saved everyone under one placeholder name,
                    so they're from several different people. They can't be traced back to anyone.
                    <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
                        <button onclick="deleteOrphanActivity('${safeKey}')"
                                style="background:#dc2626; color:white; border:none; padding:5px 12px; border-radius:5px; font-size:11px; font-weight:bold; cursor:pointer;">
                            🗑️ Delete these ${p.unlinked.length} record(s)
                        </button>
                        <button onclick="reassignActivity('${safeKey}')"
                                style="background:white; color:#4f46e5; border:1px solid #c7d2fe; padding:5px 12px; border-radius:5px; font-size:11px; font-weight:bold; cursor:pointer;">
                            Assign anyway
                        </button>
                    </div>
                </div>`;
        } else if (p.unlinked.length > 0) {
            actionsHtml = `
                <button onclick="reassignActivity('${safeKey}')"
                        style="margin-top:8px; background:${isOrphan ? '#4f46e5' : '#f59e0b'}; color:white; border:none; padding:5px 12px; border-radius:5px; font-size:11px; font-weight:bold; cursor:pointer;">
                    ${isOrphan ? '🔗 Assign to a person' : `🔗 Link ${p.unlinked.length} record(s) to ${escapeAttr(p.name)}`}
                </button>`;
        }

        return `
            <div style="padding: 10px; border-bottom: 1px solid #f3f4f6; font-size: 13px; ${isIdle ? 'opacity:0.6;' : ''}">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; cursor:pointer;" onclick="openPersonActivity('${safeKey}')">
                    <strong style="${legacy ? 'color:#6b7280; font-style:italic;' : ''}">${displayName}${isOrphan && !legacy ? ' <span style="font-weight:600; font-size:11px; color:#b45309;">· no matching account</span>' : ''}</strong>
                    <span style="font-size:11px; color:#8b5cf6; font-weight:700; white-space:nowrap;">${p.views.length} view${p.views.length === 1 ? '' : 's'} · ${p.cooks.length} cook${p.cooks.length === 1 ? '' : 's'} · ${p.visits.length} visit${p.visits.length === 1 ? '' : 's'}</span>
                </div>
                <div style="color: #6b7280; margin-top: 2px; cursor:pointer;" onclick="openPersonActivity('${safeKey}')">${lastActivityText}</div>
                ${timeStr ? `<div style="color: #9ca3af; font-size: 11px;">🕒 ${timeStr}</div>` : ''}
                ${actionsHtml}
            </div>`;
    }).join('')}`;
}

// Clears activity that can never be attributed to anyone.
window.deleteOrphanActivity = async function(key) {
    const person = personActivityMap[key];
    if (!person) return;

    const cooks = person.cooks.length;
    const total = person.unlinked.length;

    if (!confirm(
        `Delete ${total} unidentified record(s)?\n\n` +
        (cooks ? `This removes ${cooks} cook(s) from the "Total Meals Cooked" count — they were real meals, just with no record of who made them.\n\n` : '') +
        `This can't be undone.`
    )) return;

    console.log(`🗑️ [ACTIVITY] Deleting ${total} unidentified record(s)...`);

    let done = 0, failed = 0;
    for (const rec of person.unlinked) {
        try {
            await deleteDoc(doc(db, rec.collectionPath, rec.id));
            done++;
        } catch (e) {
            failed++;
            console.error(`Could not delete ${rec.collectionPath}/${rec.id}:`, e.message);
        }
    }

    console.log(`✅ [ACTIVITY] Deleted ${done} record(s)${failed ? `, ${failed} failed` : ''}.`);
    alert(failed
        ? `Deleted ${done}. ${failed} couldn't be removed — check the console.`
        : `Removed ${done} unidentified record(s).`);

    loadAdminDashboard();
};

// Permanently attaches records that were saved without a uid to a real
// account, so they stop being anonymous — here and on the leaderboard,
// which skips any cook record with no uid.
window.reassignActivity = async function(key) {
    const person = personActivityMap[key];
    if (!person || person.unlinked.length === 0) return;

    const isOrphan = key.startsWith('name:');
    let target;

    if (isOrphan) {
        // A placeholder row is several people's activity merged under one
        // meaningless name, so handing it to a single person credits them
        // with meals other people cooked. Allowed, but not silently.
        if (isPlaceholderName(person.name) && !confirm(
            `Heads up: these ${person.unlinked.length} record(s) were saved under a placeholder name, ` +
            `so they're probably from SEVERAL different people.\n\n` +
            `Assigning them all to one person will credit them with meals others cooked. Continue anyway?`
        )) return;

        // Nothing matched by name — ask who it belongs to.
        target = await pickPerson(person);
        if (!target) return;
    } else {
        target = { uid: person.key, name: person.name };
        if (!confirm(`Link ${person.unlinked.length} older record(s) to ${person.name}?\n\nThey're already grouped here by name; this writes the connection permanently so the leaderboard counts them too.`)) return;
    }

    console.log(`🔗 [ACTIVITY] Linking ${person.unlinked.length} record(s) to ${target.name} (${target.uid})...`);

    let done = 0, failed = 0;
    for (const rec of person.unlinked) {
        try {
            await updateDoc(doc(db, rec.collectionPath, rec.id), {
                uid: target.uid,
                [rec.nameField]: target.name
            });
            done++;
        } catch (e) {
            failed++;
            console.error(`Could not update ${rec.collectionPath}/${rec.id}:`, e.message);
        }
    }

    console.log(`✅ [ACTIVITY] Linked ${done} record(s)${failed ? `, ${failed} failed` : ''}.`);
    alert(failed
        ? `Linked ${done} record(s). ${failed} couldn't be updated — check the console.`
        : `Done — ${done} record(s) now belong to ${target.name}.`);

    loadAdminDashboard();
};

// Scrollable picker. Replaces a prompt(), which silently truncated the list
// after about nine names — so most of the family simply wasn't offered.
function pickPerson(person) {
    return new Promise((resolve) => {
        const modal = document.getElementById('person-picker-modal');
        const listEl = document.getElementById('person-picker-list');
        const titleEl = document.getElementById('person-picker-summary');

        const total = person.views.length + person.cooks.length + person.visits.length;
        titleEl.innerHTML = `<strong>"${escapeAttr(person.name)}"</strong> — ${person.cooks.length} cooks, ${person.views.length} views, ${person.visits.length} visits (${total} records)`;

        listEl.innerHTML = knownUsers.map(u => `
            <button class="person-picker-option" data-uid="${escapeAttr(u.uid)}" data-name="${escapeAttr(u.name)}"
                    style="display:block; width:100%; text-align:left; background:white; border:1px solid #e5e7eb;
                           border-radius:6px; padding:10px 12px; margin-bottom:6px; cursor:pointer; font-size:13px;">
                ${escapeAttr(u.name)}
            </button>`).join('');

        const cleanup = () => {
            modal.style.display = 'none';
            listEl.onclick = null;
            document.getElementById('person-picker-cancel').onclick = null;
        };

        listEl.onclick = (e) => {
            const btn = e.target.closest('.person-picker-option');
            if (!btn) return;
            cleanup();
            resolve({ uid: btn.dataset.uid, name: btn.dataset.name });
        };

        document.getElementById('person-picker-cancel').onclick = () => { cleanup(); resolve(null); };

        modal.style.display = 'flex';
    });
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

window.loadPendingRecipes = async function loadPendingRecipes() {
    const loadingDiv = document.getElementById('loading');
    const listContainer = document.getElementById('pending-list');
    if(!listContainer) return;
    try {
        const querySnapshot = await getDocs(collection(db, "pending_recipes"));
        if (querySnapshot.empty) {
            if(loadingDiv) loadingDiv.innerText = "No pending recipes!";
            updateAttentionCounts({ pending: 0 });
            return;
        }
        updateAttentionCounts({ pending: querySnapshot.size });
        if(loadingDiv) loadingDiv.style.display = 'none';
        let html = '';
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const ingredients = data.ingredients || data.recipeIngredient || [];
            const instructions = data.instructions || data.recipeInstructions || [];
            const category = (data.tags && data.tags[0]) || data.category || "Uncategorized";

            // Show multi-part submissions with their group headings intact
            const ingSections = getSections(data, 'ingredients');
            const instSections = getSections(data, 'instructions');

            const ingHtml = hasRealSections(ingSections)
                ? ingSections.map(s => `${s.title ? `<h5 style="margin:8px 0 2px 0; color:#b45309;">${s.title}</h5>` : ''}<ul>${(s.items || []).map(i => `<li>${i}</li>`).join('')}</ul>`).join('')
                : (Array.isArray(ingredients) && ingredients.length > 0
                    ? `<ul>${ingredients.map(i => `<li>${i}</li>`).join('')}</ul>`
                    : `<p class="pending-empty">No ingredients listed.</p>`);

            const instHtml = hasRealSections(instSections)
                ? instSections.map(s => `${s.title ? `<h5 style="margin:8px 0 2px 0; color:#b45309;">${s.title}</h5>` : ''}<ol>${(s.items || []).map(i => `<li>${i}</li>`).join('')}</ol>`).join('')
                : (Array.isArray(instructions) && instructions.length > 0
                    ? `<ol>${instructions.map(s => `<li>${s}</li>`).join('')}</ol>`
                    : `<p class="pending-empty">No instructions listed.</p>`);

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
                        <button class="btn-toggle" style="flex:1; padding:10px; border-radius:8px; font-weight:700; font-size:13px; cursor:pointer;" onclick="editPendingRecipe('${doc.id}')">✏️ Edit First</button>
                        <button class="btn-reject" onclick="rejectRecipe('${doc.id}')">❌ Reject</button>
                    </div>
                </div>`;
        });
        listContainer.innerHTML = html;
    } catch (error) { console.error(error); }
};

// ==========================================
// "NEEDS YOUR ATTENTION" SUMMARY
// Each loader reports its own count here as it finishes, so the panel fills
// in progressively instead of waiting on the slowest query. This is the
// closest thing to a notification the free Firebase tier allows — real
// email/push would need a paid plan or an external service.
// ==========================================
const attentionCounts = { pending: null, suggestions: null, reports: null, reviewRequests: null, resetRequests: null };

function updateAttentionCounts(partial) {
    Object.assign(attentionCounts, partial);

    const el = document.getElementById('attention-counts');
    if (!el) return;

    const chip = (emoji, label, count, href, colour) => {
        if (count === null) return '';
        const muted = count === 0;
        return `<a href="${href}" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px;
                    background:${muted ? '#f3f4f6' : colour.bg}; color:${muted ? '#9ca3af' : colour.fg};
                    border:1px solid ${muted ? '#e5e7eb' : colour.border};
                    padding:8px 14px; border-radius:20px; font-size:13px; font-weight:700;">
                    ${emoji} ${label}: ${count}
                </a>`;
    };

    const parts = [
        chip('🛡️', 'Awaiting approval', attentionCounts.pending, '#pending-list',
             { bg: '#ede9fe', fg: '#5b21b6', border: '#c4b5fd' }),
        chip('📬', 'Suggested fixes', attentionCounts.suggestions, '#suggestions-list',
             { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' }),
        chip('🔑', 'Password resets', attentionCounts.resetRequests, '#reset-requests-list',
             { bg: '#ede9fe', fg: '#5b21b6', border: '#c4b5fd' }),
        chip('🙋', 'Review requests', attentionCounts.reviewRequests, '#reports-table-body',
             { bg: '#ffedd5', fg: '#9a3412', border: '#fdba74' }),
        chip('🚩', 'Reported issues', attentionCounts.reports, '#reports-table-body',
             { bg: '#fee2e2', fg: '#b91c1c', border: '#fca5a5' })
    ].filter(Boolean);

    el.innerHTML = parts.length
        ? parts.join('')
        : `<span style="color:#9ca3af; font-size:13px;">Checking…</span>`;

    // Turn the whole panel green when there's genuinely nothing to do
    const total = ['pending', 'suggestions', 'reports', 'resetRequests'].reduce((sum, k) => sum + (attentionCounts[k] || 0), 0);
    const panel = document.getElementById('attention-panel');
    if (panel && total === 0 && attentionCounts.reports !== null) {
        panel.style.borderLeftColor = '#16a34a';
        panel.querySelector('h3').innerHTML = '✅ All Caught Up';
        panel.querySelector('h3').style.color = '#15803d';
    }
}

// ==========================================
// PASSWORD RESET REQUESTS
// A browser can't set someone else's password from a code we invent —
// Firebase only allows it via its own emailed link, an already-signed-in
// user, or admin credentials (which can never ship to a browser). So the
// control lives in the approval step instead: the request sits here until
// an admin has confirmed with the person directly, and only then is the
// link sent — to that person's own mailbox, which nobody else can read.
// ==========================================
window.loadResetRequests = async function() {
    const listEl = document.getElementById('reset-requests-list');
    if (!listEl) return;

    try {
        const snap = await getDocs(collection(db, "password_reset_requests"));
        const pending = [];
        snap.forEach(d => { const data = d.data(); if (data.status === 'pending') pending.push({ id: d.id, ...data }); });

        const millis = (ts) => (ts && typeof ts.toDate === 'function') ? ts.toDate().getTime() : 0;
        pending.sort((a, b) => millis(b.requestedAt) - millis(a.requestedAt));

        console.log(`🔑 [RESET] ${pending.length} pending request(s).`);
        updateAttentionCounts({ resetRequests: pending.length });

        if (pending.length === 0) {
            listEl.innerHTML = `<p style="color:#9ca3af; font-size:13px;">No password reset requests. 🎉</p>`;
            return;
        }

        // Match requests to known accounts so an unrecognised address is
        // obvious at a glance — that's the main sign of a bogus request.
        const usersSnap = await getDocs(collection(db, "users"));
        const knownByEmail = {};
        usersSnap.forEach(u => { const e = (u.data().email || '').toLowerCase(); if (e) knownByEmail[e] = u.data().Name || e; });

        listEl.innerHTML = pending.map(req => {
            const known = knownByEmail[(req.email || '').toLowerCase()];
            const when = req.requestedAt && req.requestedAt.toDate
                ? req.requestedAt.toDate().toLocaleString()
                : 'just now';

            return `
                <div id="reset-req-${req.id}" style="border:1px solid ${known ? '#ddd6fe' : '#fca5a5'}; background:${known ? '#f5f3ff' : '#fef2f2'}; border-radius:8px; padding:12px; margin-bottom:10px;">
                    <div style="font-weight:800; font-size:14px;">${escapeAttr(known || 'Unrecognised address')}</div>
                    <div style="font-size:12px; color:#4c1d95; margin-top:2px;">${escapeAttr(req.email)}</div>
                    <div style="font-size:11px; color:#6b7280; margin-top:2px;">🕒 ${when}</div>
                    ${known
                        ? `<p style="font-size:11px; color:#5b21b6; margin:8px 0 0 0;">✔️ Matches an existing account. Confirm with them, then approve.</p>`
                        : `<p style="font-size:11px; color:#b91c1c; margin:8px 0 0 0;"><strong>⚠️ No account uses this address.</strong> Almost certainly a typo or junk — dismiss it.</p>`}
                    <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                        <button onclick="approveResetRequest('${req.id}', '${escapeAttr(req.email)}')" class="btn-action" style="background:#7c3aed; color:white; font-weight:bold;">📧 Approve &amp; Send Link</button>
                        <button onclick="dismissResetRequest('${req.id}')" class="btn-action btn-delete">✖️ Dismiss</button>
                    </div>
                </div>`;
        }).join('');
    } catch (e) {
        console.error("🔥 [RESET] Could not load requests:", e);
        listEl.innerHTML = `<p style="color:red; font-size:13px;">Could not load requests: ${e.message}</p>`;
    }
};

window.approveResetRequest = async function(id, email) {
    if (!confirm(`Have you already confirmed with them directly that they asked for this?\n\nApproving emails a password reset link to:\n${email}`)) return;

    try {
        // sendPasswordResetEmail doesn't require being signed in as that
        // person, so an admin can trigger it on their behalf. The link still
        // only works from their own inbox.
        const { sendPasswordResetEmail } = await import("https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js");
        await sendPasswordResetEmail(auth, email);

        await updateDoc(doc(db, "password_reset_requests", id), {
            status: 'approved',
            approvedAt: serverTimestamp()
        });

        console.log("✅ [RESET] Link sent to:", email);
        alert(`Reset link sent to ${email}.\n\nTell them to check spam if it doesn't arrive.`);
        loadResetRequests();
    } catch (e) {
        console.error("🔥 [RESET] Could not send:", e);
        if (e.code === 'auth/user-not-found') {
            alert("No account uses that email address — nothing was sent. Dismiss this request.");
        } else {
            alert("Could not send the reset link: " + e.message);
        }
    }
};

window.dismissResetRequest = async function(id) {
    if (!confirm("Dismiss this request? No reset link will be sent.")) return;
    try {
        await deleteDoc(doc(db, "password_reset_requests", id));
        document.getElementById(`reset-req-${id}`)?.remove();
        console.log("✖️ [RESET] Dismissed.");
        loadResetRequests();
    } catch (e) { alert("Could not dismiss: " + e.message); }
};

// ==========================================
// SUGGESTED FIXES FROM FAMILY MEMBERS
// ==========================================
window.loadSuggestions = async function() {
    const listEl = document.getElementById('suggestions-list');
    if (!listEl) return;

    try {
        const snap = await getDocs(query(collection(db, "recipe_suggestions"), orderBy("createdAt", "desc")));
        const pending = [];
        snap.forEach(d => { const data = d.data(); if (data.status !== 'resolved') pending.push({ id: d.id, ...data }); });

        console.log(`📬 [SUGGESTIONS] ${pending.length} pending.`);
        updateAttentionCounts({ suggestions: pending.length });

        if (pending.length === 0) {
            listEl.innerHTML = `<p style="color:#9ca3af; font-size:13px;">No suggested fixes right now. 🎉</p>`;
            return;
        }

        listEl.innerHTML = pending.map(s => {
            const p = s.proposed || {};
            const ingPreview = (p.ingredients || []).slice(0, 6).join(' · ');
            const more = (p.ingredients || []).length > 6 ? ` …+${p.ingredients.length - 6} more` : '';
            return `
                <div id="suggestion-${s.id}" style="border:1px solid #fde68a; background:#fffbeb; border-radius:8px; padding:12px; margin-bottom:10px;">
                    <div style="font-weight:800; font-size:14px;">${escapeAttr(s.recipeName || 'Unknown recipe')}</div>
                    <div style="font-size:11px; color:#92400e; margin-top:2px;">Suggested by ${escapeAttr(s.suggestedBy || 'Someone')}</div>
                    ${s.reason ? `<div style="margin-top:8px; font-size:13px; background:#fff; border:1px solid #fde68a; border-radius:6px; padding:8px;"><strong>Their note:</strong> ${escapeAttr(s.reason)}</div>` : ''}
                    <div style="margin-top:8px; font-size:12px; color:#374151;">
                        <strong>Proposed ingredients:</strong> ${escapeAttr(ingPreview)}${more}
                    </div>
                    <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                        <a href="recipe.html?id=${encodeURIComponent(s.recipeId)}" target="_blank" class="btn-action btn-toggle" style="text-decoration:none;">👀 View current</a>
                        <button onclick="applySuggestion('${s.id}')" class="btn-action" style="background:#16a34a; color:white; font-weight:bold;">✅ Apply to shared recipe</button>
                        <button onclick="dismissSuggestion('${s.id}')" class="btn-action btn-delete">✖️ Dismiss</button>
                    </div>
                </div>`;
        }).join('');
    } catch (e) {
        console.error("🔥 [SUGGESTIONS] Could not load:", e);
        listEl.innerHTML = `<p style="color:red; font-size:13px;">Could not load suggestions: ${e.message}</p>`;
    }
};

window.applySuggestion = async function(id) {
    if (!confirm("Apply this suggested version to the shared recipe everyone sees?\n\nThe current version is saved to the recipe's history first.")) return;

    try {
        const sugSnap = await getDoc(doc(db, "recipe_suggestions", id));
        if (!sugSnap.exists()) return alert("That suggestion no longer exists.");
        const suggestion = sugSnap.data();

        // Snapshot the current version before overwriting, same as the editor
        const beforeSnap = await getDoc(doc(db, "recipes", suggestion.recipeId));
        if (beforeSnap.exists()) {
            try {
                await addDoc(collection(db, "recipes", suggestion.recipeId, "history"), {
                    ...beforeSnap.data(), timestamp: serverTimestamp()
                });
            } catch (e) { console.error("Could not snapshot history:", e); }
        }

        await updateDoc(doc(db, "recipes", suggestion.recipeId), {
            ...suggestion.proposed,
            lastUpdated: serverTimestamp()
        });
        await updateDoc(doc(db, "recipe_suggestions", id), { status: 'resolved', resolvedAt: serverTimestamp() });

        console.log(`✅ [SUGGESTIONS] Applied to "${suggestion.recipeName}".`);
        alert("Applied! Remember to hit 'Update Homepage Index' so the change shows in search.");
        loadSuggestions();
    loadResetRequests();
    } catch (e) {
        console.error("🔥 [SUGGESTIONS] Apply failed:", e);
        alert("Could not apply: " + e.message);
    }
};

window.dismissSuggestion = async function(id) {
    if (!confirm("Dismiss this suggestion? The shared recipe stays as it is.")) return;
    try {
        await deleteDoc(doc(db, "recipe_suggestions", id));
        document.getElementById(`suggestion-${id}`)?.remove();
        console.log("✖️ [SUGGESTIONS] Dismissed.");
        loadSuggestions();
    loadResetRequests();
    } catch (e) { alert("Could not dismiss: " + e.message); }
};

// ==========================================
// EDIT A SUBMISSION BEFORE APPROVING IT
// Typos and formatting are easiest to fix while it's still in the queue —
// approving first would briefly publish the unfixed version. The card turns
// into a form in place; the recipe stays in pending_recipes until you're
// happy with it.
// ==========================================
window.editPendingRecipe = async function(id) {
    const card = document.getElementById(`card-${id}`);
    if (!card) return;

    try {
        const snap = await getDoc(doc(db, "pending_recipes", id));
        if (!snap.exists()) return alert("That submission no longer exists.");
        const data = snap.data();

        const categoryOptions = SCAN_CATEGORIES.map(c =>
            `<option value="${c}" ${((data.tags && data.tags[0]) || data.category) === c ? 'selected' : ''}>${c}</option>`
        ).join('');

        card.innerHTML = `
            <div class="pending-header"><h2>✏️ Editing submission</h2></div>
            <label style="font-size:12px; font-weight:700;">Recipe Name</label>
            <input type="text" id="pe-name-${id}" value="${escapeAttr(data.name || '')}" style="width:100%; padding:8px; margin:4px 0 10px 0; border:1px solid #ddd; border-radius:6px;">

            <label style="font-size:12px; font-weight:700;">From (Chef)</label>
            <input type="text" id="pe-author-${id}" value="${escapeAttr(data.author || '')}" style="width:100%; padding:8px; margin:4px 0 10px 0; border:1px solid #ddd; border-radius:6px;">

            <label style="font-size:12px; font-weight:700;">Category</label>
            <select id="pe-category-${id}" style="width:100%; padding:8px; margin:4px 0 10px 0; border:1px solid #ddd; border-radius:6px;">${categoryOptions}</select>

            <label style="font-size:12px; font-weight:700;">Ingredients <span style="font-weight:400; color:#6b7280;">(one per line — "## Crust" starts a new part)</span></label>
            <textarea id="pe-ingredients-${id}" rows="8" style="width:100%; padding:8px; margin:4px 0 10px 0; border:1px solid #ddd; border-radius:6px; font-size:13px;">${escapeAttr(getEditableText(data, 'ingredients'))}</textarea>

            <label style="font-size:12px; font-weight:700;">Instructions <span style="font-weight:400; color:#6b7280;">(one step per line)</span></label>
            <textarea id="pe-instructions-${id}" rows="8" style="width:100%; padding:8px; margin:4px 0 10px 0; border:1px solid #ddd; border-radius:6px; font-size:13px;">${escapeAttr(getEditableText(data, 'instructions'))}</textarea>

            <label style="font-size:12px; font-weight:700;">Notes</label>
            <textarea id="pe-notes-${id}" rows="2" style="width:100%; padding:8px; margin:4px 0 10px 0; border:1px solid #ddd; border-radius:6px; font-size:13px;">${escapeAttr(data.notes || '')}</textarea>

            <div class="pending-actions">
                <button class="btn-approve" onclick="savePendingRecipe('${id}', true)">✅ Save &amp; Approve</button>
                <button class="btn-toggle" style="flex:1; padding:10px; border-radius:8px; font-weight:700; font-size:13px; cursor:pointer;" onclick="savePendingRecipe('${id}', false)">💾 Save, Keep in Queue</button>
                <button class="btn-reject" onclick="loadPendingRecipes()">✖️ Cancel</button>
            </div>`;
    } catch (e) {
        console.error("🔥 [PENDING] Could not open editor:", e);
        alert("Could not open that submission: " + e.message);
    }
};

// Minimal escape for values placed inside HTML attributes / textareas.
function escapeAttr(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.savePendingRecipe = async function(id, thenApprove) {
    const val = (prefix) => document.getElementById(`pe-${prefix}-${id}`).value;

    const updated = {
        name: val('name').trim(),
        author: val('author').trim(),
        category: val('category'),
        tags: [val('category')],
        notes: val('notes').trim(),
        ...buildRecipeFields(val('ingredients'), 'ingredients'),
        ...buildRecipeFields(val('instructions'), 'instructions')
    };

    try {
        await updateDoc(doc(db, "pending_recipes", id), updated);
        console.log(`💾 [PENDING] Saved edits to "${updated.name}".`);

        if (thenApprove) {
            await approveRecipe(id, { skipConfirm: true });
        } else {
            loadPendingRecipes();
        }
    } catch (e) {
        console.error("🔥 [PENDING] Save failed:", e);
        alert("Could not save: " + e.message);
    }
};

window.approveRecipe = async function(id, options = {}) {
    if (!options.skipConfirm && !confirm("Publish this recipe to the cookbook?")) return;
    try {
        const snap = await getDoc(doc(db, "pending_recipes", id));
        await addDoc(collection(db, "recipes"), { ...snap.data(), reviewed: true, createdAt: new Date() });
        await deleteDoc(doc(db, "pending_recipes", id));
        console.log(`✅ [PENDING] Approved and published "${snap.data().name}".`);
        document.getElementById(`card-${id}`)?.remove();
        triggerDriveSyncSilently();
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
// Skips O/0 and I/1 so a code can be read aloud or texted without confusion.
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateInviteCode(length = 8) {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += INVITE_CODE_ALPHABET[Math.floor(Math.random() * INVITE_CODE_ALPHABET.length)];
    }
    return code;
}

window.createInvite = async function() {
    const nameInput = document.getElementById('invite-name');
    const emailInput = document.getElementById('invite-email');
    const codeInput = document.getElementById('invite-code');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    if (!name || !email) return alert("Name and email are both required.");

    // The code IS the document id, which is what makes it the secret (see
    // the /invites rules). Uppercased so it's case-insensitive in practice.
    const typed = codeInput.value.trim().toUpperCase().replace(/\s+/g, '');
    const code = typed || generateInviteCode();

    if (typed && typed.length < 4) return alert("Give the code at least 4 characters.");

    console.log(`👪 [INVITE] Creating invite for ${name} <${email}> with code ${code}...`);

    try {
        // Don't silently overwrite an invite that already uses this code
        const existing = await getDoc(doc(db, "invites", code));
        if (existing.exists()) return alert(`The code ${code} is already in use. Pick another.`);

        // Invites always create a normal user account — Admin access is
        // never granted at signup (see firestore.rules), only afterward via
        // "Manage Admin Access" once they've signed up.
        await setDoc(doc(db, "invites", code), {
            name,
            email,
            used: false,
            createdAt: serverTimestamp()
        });

        const basePath = location.pathname.replace(/admin\.html$/, '');
        document.getElementById('invite-code-output').innerText = code;
        document.getElementById('invite-link-output').value = `${location.origin}${basePath}invite.html?id=${code}`;
        document.getElementById('invite-result').style.display = 'block';

        console.log("✅ [INVITE] Created with code:", code);
        nameInput.value = "";
        emailInput.value = "";
        codeInput.value = "";
        loadPendingInvites();
    } catch (e) {
        console.error("🔥 [INVITE] Could not create invite:", e);
        alert("Could not create invite: " + e.message);
    }
};

window.copyInviteCode = function() {
    const code = document.getElementById('invite-code-output').innerText;
    navigator.clipboard.writeText(code).then(() => alert(`Copied: ${code}`));
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
                    <span>
                        ${inv.name} (${inv.email})<br>
                        <span style="font-family:monospace; font-weight:800; letter-spacing:1px; color:#166534;">${inv.id}</span>
                    </span>
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

// ==========================================
// USER DOCUMENT SHAPE + REPAIR
//
// Firestore's console defaults every hand-added field to a *string*, so a
// user document created by clicking "Add field" ends up with favorites: ""
// and role: "" instead of an array and a proper role. That mostly limps
// along (an empty string is falsy, so `favorites || []` saves us), but it's
// fragile — `.includes()` on a string does substring matching, and a
// non-array `favorites` is a real bug waiting to happen.
//
// Keep in sync with scripts/invite-signup.js and local-tools/add-user.
//
// There is deliberately NO `notes` field: a person's private Chef's Notes
// are stored one per recipe in the users/{uid}/private_notes/{recipeId}
// subcollection. Firestore's console lists subcollections below the fields
// rather than among them, so they can look absent — but a `notes` field
// here would be a second, unread place that looks like it holds them.
// ==========================================
const USER_DOC_SHAPE = {
    Name:        { type: 'string', fallback: (d, uid) => d.Name || (d.email || '').split('@')[0] || 'Family Member' },
    email:       { type: 'string', fallback: (d) => d.email || '' },
    role:        { type: 'string', fallback: (d) => (d.role === 'admin' ? 'admin' : 'user') },
    favorites:   { type: 'array',  fallback: () => [] },
    householdId: { type: 'nullable-string', fallback: (d) => d.householdId || null }
};

// Fields that shouldn't be on a user document at all. A stray `notes: ""`
// (added by hand, or by an earlier version of this file) is misleading
// because it looks like it should hold the recipe notes but never does.
const OBSOLETE_USER_FIELDS = ['notes'];

// Returns the fields on this doc that are missing or the wrong type.
function findUserDocProblems(data, uid) {
    const problems = [];

    Object.entries(USER_DOC_SHAPE).forEach(([field, spec]) => {
        const value = data[field];
        const missing = value === undefined;

        let wrongType = false;
        if (!missing) {
            if (spec.type === 'array') wrongType = !Array.isArray(value);
            else if (spec.type === 'string') wrongType = typeof value !== 'string' || (field === 'role' && value === '');
            else if (spec.type === 'nullable-string') wrongType = value !== null && typeof value !== 'string';
        }

        if (missing || wrongType) {
            problems.push({ field, missing, was: value, fix: spec.fallback(data, uid) });
        }
    });

    // createdAt should be a real Timestamp, not a string or absent
    if (!data.createdAt || typeof data.createdAt.toDate !== 'function') {
        problems.push({ field: 'createdAt', missing: !data.createdAt, was: data.createdAt, fix: 'serverTimestamp' });
    }

    // Strip fields that shouldn't exist
    OBSOLETE_USER_FIELDS.forEach(field => {
        if (data[field] !== undefined) {
            problems.push({ field, missing: false, obsolete: true, was: data[field], fix: 'delete' });
        }
    });

    return problems;
}

window.repairUserDocs = async function() {
    const statusEl = document.getElementById('user-repair-status');
    const setStatus = (html) => { if (statusEl) statusEl.innerHTML = html; };

    setStatus("<span style='color:#6b7280;'>Checking every user document…</span>");

    try {
        const snap = await getDocs(collection(db, "users"));
        const broken = [];

        snap.forEach(d => {
            const problems = findUserDocProblems(d.data(), d.id);
            if (problems.length > 0) broken.push({ uid: d.id, name: d.data().Name || d.id, problems });
        });

        console.log(`🩺 [USER REPAIR] ${broken.length} of ${snap.size} document(s) need fixing.`);

        if (broken.length === 0) {
            setStatus(`<span style="color:#15803d; font-weight:700;">✅ All ${snap.size} user documents look correct.</span>`);
            return;
        }

        const summary = broken.map(b =>
            `• <strong>${escapeAttr(b.name)}</strong>: ${b.problems.map(p =>
                `${p.field} ${p.obsolete ? '(remove — unused)' : p.missing ? '(missing)' : '(wrong type)'}`).join(', ')}`
        ).join('<br>');

        setStatus(`
            <div style="background:#fffbeb; border:1px solid #fcd34d; border-radius:6px; padding:10px; font-size:12px; color:#92400e;">
                <strong>${broken.length} document(s) need fixing:</strong><br>${summary}
                <button onclick="applyUserDocRepairs()" style="background:#f59e0b; color:white; border:none; padding:7px 14px; border-radius:6px; cursor:pointer; font-weight:bold; margin-top:10px;">
                    🩹 Fix them
                </button>
            </div>`);

        // Stash for the apply step so we don't re-scan
        window.__pendingUserRepairs = broken;
    } catch (e) {
        console.error("🔥 [USER REPAIR] Scan failed:", e);
        setStatus(`<span style="color:red;">Could not check: ${e.message}</span>`);
    }
};

window.applyUserDocRepairs = async function() {
    const broken = window.__pendingUserRepairs || [];
    const statusEl = document.getElementById('user-repair-status');
    if (broken.length === 0) return;

    statusEl.innerHTML = "<span style='color:#6b7280;'>Fixing…</span>";

    let fixed = 0;
    for (const entry of broken) {
        const patch = {};
        entry.problems.forEach(p => {
            if (p.fix === 'serverTimestamp') patch[p.field] = serverTimestamp();
            else if (p.fix === 'delete') patch[p.field] = deleteField();
            else patch[p.field] = p.fix;
        });

        try {
            // merge:true so we only touch the broken fields and leave
            // everything else (including favourites people have set) alone
            await setDoc(doc(db, "users", entry.uid), patch, { merge: true });
            fixed++;
            console.log(`🩹 [USER REPAIR] Fixed ${entry.name}:`, Object.keys(patch).join(', '));
        } catch (e) {
            console.error(`🔥 [USER REPAIR] Could not fix ${entry.name}:`, e);
        }
    }

    window.__pendingUserRepairs = [];
    statusEl.innerHTML = `<span style="color:#15803d; font-weight:700;">✅ Fixed ${fixed} of ${broken.length} document(s).</span>`;
    loadAdminUsersList();
};

// ==========================================
// HOUSEHOLDS (admin side)
// People can create/join their own household with a code in Settings; this
// is the "just set it up for me" path for anyone who'd rather not.
// ==========================================
window.adminCreateHousehold = async function() {
    const input = document.getElementById('new-household-name');
    const name = input.value.trim();
    if (!name) return alert("Give the household a name first.");

    try {
        const user = auth.currentUser;
        const created = await createHousehold(user.uid, name);
        // The admin creating a household on someone else's behalf shouldn't
        // silently move their OWN menu into it — drop back out immediately,
        // leaving the household in place with its join code.
        await assignUserToHousehold(user.uid, null);

        input.value = "";
        alert(`Created "${name}".\nJoin code: ${created.code}`);
        loadAdminHouseholds();
    } catch (e) {
        console.error("🔥 [HOUSEHOLD] Create failed:", e);
        alert("Could not create household: " + e.message);
    }
};

window.loadAdminHouseholds = async function() {
    const listEl = document.getElementById('admin-households-list');
    if (!listEl) return;

    try {
        const [households, usersSnap] = await Promise.all([
            listHouseholds(),
            getDocs(collection(db, "users"))
        ]);

        const users = [];
        usersSnap.forEach(d => users.push({ uid: d.id, ...d.data() }));
        users.sort((a, b) => (a.Name || a.email || "").localeCompare(b.Name || b.email || ""));

        console.log(`🏠 [HOUSEHOLD] Loaded ${households.length} household(s).`);

        const householdOptions = (selectedId) =>
            `<option value="">— Not in a household —</option>` +
            households.map(h => `<option value="${h.id}" ${h.id === selectedId ? 'selected' : ''}>${h.name}</option>`).join('');

        const householdsHtml = households.length === 0
            ? `<p style="font-size:12px; color:#9ca3af;">No households yet.</p>`
            : households.map(h => {
                const memberNames = (h.members || [])
                    .map(uid => (users.find(u => u.uid === uid) || {}).Name || "Unknown")
                    .join(', ');
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f3f4f6; font-size:13px; flex-wrap:wrap;">
                        <div>
                            <div style="font-weight:700;">${h.name}</div>
                            <div style="font-size:11px; color:#9ca3af;">
                                Code <strong style="font-family:monospace;">${h.code}</strong>
                                · ${(h.members || []).length} member${(h.members || []).length === 1 ? '' : 's'}
                                ${memberNames ? `· ${memberNames}` : ''}
                            </div>
                        </div>
                        <button onclick="adminDeleteHousehold('${h.id}', '${(h.name || '').replace(/'/g, "\\'")}')" style="background:#fee2e2; color:#b91c1c; border:none; padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Delete</button>
                    </div>`;
            }).join('');

        const assignHtml = users.map(u => `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid #f9fafb; font-size:13px; flex-wrap:wrap;">
                <span style="font-weight:600;">${u.Name || u.email || u.uid}</span>
                <select onchange="adminAssignHousehold('${u.uid}', this.value)" style="padding:4px 8px; border:1px solid #ddd; border-radius:4px; font-size:12px; max-width:220px;">
                    ${householdOptions(u.householdId || "")}
                </select>
            </div>`).join('');

        listEl.innerHTML = `
            ${householdsHtml}
            <details style="margin-top:14px;">
                <summary style="cursor:pointer; font-size:12px; font-weight:bold; color:#0e7490;">👥 Assign people to a household</summary>
                <div style="margin-top:10px;">${assignHtml}</div>
            </details>`;
    } catch (e) {
        console.error("🔥 [HOUSEHOLD] Could not load households:", e);
        listEl.innerHTML = `<p style="color:red; font-size:13px;">Could not load households: ${e.message}</p>`;
    }
};

window.adminAssignHousehold = async function(uid, householdId) {
    try {
        await assignUserToHousehold(uid, householdId || null);
        console.log(`🏠 [HOUSEHOLD] Assigned ${uid} to ${householdId || 'no household'}.`);
        loadAdminHouseholds();
    } catch (e) {
        console.error("🔥 [HOUSEHOLD] Assign failed:", e);
        alert("Could not change household: " + e.message);
    }
};

window.adminDeleteHousehold = async function(id, name) {
    if (!confirm(`Delete "${name}"?\n\nEveryone in it goes back to their own private menu and shopping list. The shared menu/list for this household is removed.`)) return;
    try {
        // Take everyone out first so nobody is left pointing at a household
        // that no longer exists.
        const household = await getHousehold(id);
        for (const uid of (household?.members || [])) {
            await assignUserToHousehold(uid, null);
        }
        await deleteDoc(doc(db, "households", id));
        console.log(`🗑️ [HOUSEHOLD] Deleted "${name}".`);
        loadAdminHouseholds();
    } catch (e) {
        console.error("🔥 [HOUSEHOLD] Delete failed:", e);
        alert("Could not delete: " + e.message);
    }
};

window.postAnnouncement = async function() {
    const input = document.getElementById('announce-input');
    if (input.value) { await addDoc(collection(db, "announcements"), { message: input.value, type: "alert", timestamp: serverTimestamp() }); alert("Posted!"); input.value=""; }
};
window.uploadBulkRecipes = async function() {
    const input = document.getElementById('bulk-input');
    const draftCheckbox = document.getElementById('bulk-upload-as-draft');
    const asDraft = draftCheckbox ? draftCheckbox.checked : false;
    try {
        const recipes = JSON.parse(input.value);
        const confirmMsg = asDraft
            ? `Add ${recipes.length} to your Testing Kitchen? Only you'll see them until you release each one.`
            : `Upload ${recipes.length}?`;
        if(confirm(confirmMsg)) {
            for(const r of recipes) {
                const ingredients = r.recipeIngredient || r.ingredients || [];
                const instructions = r.recipeInstructions || r.instructions || [];
                await addDoc(collection(db, "recipes"), {
                    name: r.name, author: r.author, tags: r.tags,
                    ingredients, recipeIngredient: ingredients,
                    instructions, recipeInstructions: instructions,
                    ingredientSections: r.ingredientSections || [],
                    instructionSections: r.instructionSections || [],
                    notes: r.notes || "",
                    sourceUrl: r.sourceUrl || "",
                    isDraft: asDraft,
                    reviewed: false
                });
            }
            alert("Done!"); input.value="";
            triggerDriveSyncSilently();
        }
    } catch(e) { alert("Invalid JSON"); }
};

// ==========================================
// IMPORT RECIPE FROM A LINK
// ==========================================
function mergeIntoUploadStation(jsonText) {
    const bulkInput = document.getElementById('bulk-input');
    const incoming = JSON.parse(jsonText);
    let existing = [];
    if (bulkInput.value.trim()) {
        try {
            existing = JSON.parse(bulkInput.value);
            if (!Array.isArray(existing)) existing = [];
        } catch (e) { existing = []; }
    }
    bulkInput.value = JSON.stringify([...existing, ...incoming], null, 2);
    bulkInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

window.importRecipeFromUrl = async function() {
    const input = document.getElementById('import-recipe-url');
    const statusEl = document.getElementById('import-recipe-status');
    const resultBox = document.getElementById('import-recipe-result');
    const btn = document.getElementById('import-recipe-btn');

    const url = input.value.trim();
    if (!url) { statusEl.innerText = "Paste a recipe link first."; return; }

    btn.disabled = true;
    resultBox.style.display = 'none';
    statusEl.innerText = "⏳ Fetching...";

    let recipe = null;
    let lastError = null;

    // 1. Try straight from the browser — works on the rare site that
    // allows cross-origin reads, and needs no local setup at all.
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`That site returned an error (${res.status}).`);
        const html = await res.text();
        recipe = parseRecipeFromHtml(html, url);
        console.log("🔗 [IMPORT] Direct browser fetch worked.");
    } catch (e) {
        lastError = e;
        console.log("🔗 [IMPORT] Direct fetch didn't work (expected for most sites), trying the local helper...", e.message);
    }

    // 2. Fall back to the local import helper — only reachable when this
    // page is being served by local-tools/scan-recipe/serve-locally.mjs,
    // which fetches server-side with no such restriction.
    if (!recipe) {
        try {
            statusEl.innerText = "⏳ Trying the local import helper...";
            const res = await fetch('/api/import-recipe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "Import failed.");
            recipe = data.recipe;
            console.log("🔗 [IMPORT] Local helper worked.");
        } catch (e) {
            lastError = e;
        }
    }

    btn.disabled = false;

    if (!recipe) {
        statusEl.innerHTML = `❌ Couldn't import that one: ${lastError ? lastError.message : 'unknown error'}.<br>
            Most recipe sites need the local helper — run <code>node local-tools/scan-recipe/serve-locally.mjs</code>
            and open the printed <code>http://localhost:8080</code> link, then try again from there.`;
        return;
    }

    document.getElementById('import-recipe-json').value = JSON.stringify([recipe], null, 2);
    resultBox.style.display = 'block';
    statusEl.innerText = `✅ Found "${recipe.name}" — ${recipe.ingredients.length} ingredients, ${recipe.instructions.length} steps. Review it below before sending.`;
    input.value = "";
};

window.sendImportToUploadStation = function() {
    try {
        mergeIntoUploadStation(document.getElementById('import-recipe-json').value);
    } catch (e) {
        alert("Could not merge into the upload box: " + e.message);
    }
};

// ==========================================
// GOOGLE DRIVE SYNC (manual trigger — see drive-sync-trigger.js for the
// automatic version fired after saves/approvals/deletes)
// ==========================================
window.triggerDriveSync = async function() {
    const btn = document.getElementById('drive-sync-btn');
    const statusEl = document.getElementById('drive-sync-status');
    btn.disabled = true;
    statusEl.innerText = "⏳ Starting...";
    try {
        const res = await fetch('/api/sync-to-drive', { method: 'POST' });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Could not start the sync.");
        statusEl.innerText = data.status === 'queued'
            ? "⏳ A sync was already running — yours is queued right behind it."
            : "☁️ Sync started in the background — this can take a minute or two for a large cookbook. Check local-tools/sync-to-drive/logs/sync.log for progress.";
    } catch (e) {
        statusEl.innerHTML = `❌ Couldn't reach the local sync helper: ${e.message}.<br>
            This only works while viewing this page over <code>http://localhost:8080</code> — run
            <code>node local-tools/scan-recipe/serve-locally.mjs</code> first.`;
    }
    btn.disabled = false;
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
            draft: data.isDraft === true,        // Testing Kitchen — never shown outside it
            fam: data.family || 'Both',          // family separation filter
            d: Array.isArray(data.dietary) ? data.dietary : [],  // dietary/allergy tags
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
            updateAttentionCounts({ reports: 0, reviewRequests: 0 });
            return;
        }

        // Newest first. Without this the list came back in document-ID
        // order, so a report filed thirty seconds ago could sit anywhere in
        // the table — which is exactly why a new "review requested" looked
        // like nothing had happened at all.
        const rows = [];
        snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
        const millis = (ts) => (ts && typeof ts.toDate === 'function') ? ts.toDate().getTime()
                             : (ts && ts.seconds ? ts.seconds * 1000 : 0);
        rows.sort((a, b) => millis(b.createdAt) - millis(a.createdAt));

        updateAttentionCounts({
            reports: rows.filter(r => r.type !== 'review_request').length,
            reviewRequests: rows.filter(r => r.type === 'review_request').length
        });

        let html = "";
        rows.forEach(data => {
            const d = { id: data.id };

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

            // A "please verify this" request is a different job from "this
            // recipe is wrong", so it gets its own colour and a direct link
            // into the review page rather than looking like another report.
            const isReviewRequest = data.type === 'review_request';
            const rowStyle = isReviewRequest
                ? 'background:#fffbeb; border-left:4px solid #f59e0b;'
                : '';
            const actionHtml = isReviewRequest
                ? `<a href="review.html" class="btn-action" style="background:#f59e0b; color:white; font-weight:bold; text-decoration:none; margin-right:6px;">📋 Review</a>
                   <button onclick="resolveReport('${d.id}')" class="pill-btn btn-teal" style="padding: 5px 10px; font-size: 12px;">✅ Done</button>`
                : `<button onclick="resolveReport('${d.id}')" class="pill-btn btn-teal" style="padding: 5px 10px; font-size: 12px;">✅ Resolve</button>`;

            html += `
                <tr id="report-${d.id}" style="border-bottom: 1px solid var(--border); ${rowStyle}">
                    <td style="padding: 10px; color: var(--primary);">${dateStr}</td>
                    <td style="padding: 10px; font-weight: bold; color: var(--accent-teal);">${reporter}</td>
                    <td style="padding: 10px;">
                        <a href="recipe.html?id=${recipeId}" target="_blank" style="color: var(--primary); font-weight: bold; text-decoration: underline;">${recipeName}</a>
                    </td>
                    <td style="padding: 10px; color: var(--primary);">${issue}</td>
                    <td style="padding: 10px; white-space: nowrap;">${actionHtml}</td>
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
    'Appetizers & Snacks', 'Beverages', 'Breads & Rolls', 'Breakfast', 'Desserts', 'Dutch Oven',
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