// ==========================================
// OFFLINE DOWNLOADS PAGE
// ==========================================
// Chooses which recipes are saved on this device for trips without signal.
// Uses the same localStorage store the homepage and recipe page already read
// from (OFFLINE_DATA_KEY in scripts/main.js), so anything saved here shows up
// everywhere else with no other changes. "Saved but changed" is detected by
// comparing the stored copy with what's in Firestore right now.
import { db, auth } from './firebase-config.js';
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

const OFFLINE_DATA_KEY = 'offlineRecipeData';

let serverRecipes = [];      // [{ id, name, data }] straight from Firestore
let favoriteIds = new Set();
let saved = {};              // { [id]: recipe } as stored on this device
let selected = new Set();
let currentFilter = 'all';
let searchText = '';

function readStore() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_DATA_KEY) || '{}'); }
    catch (e) { return {}; }
}

function writeStore(store) {
    try {
        localStorage.setItem(OFFLINE_DATA_KEY, JSON.stringify(store));
        return true;
    } catch (e) {
        alert("Not enough room on this device to save more recipes. Remove some and try again.");
        return false;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

// Fields the app rewrites during normal use (view counts, public-card expiry).
// They shouldn't make a saved recipe look "changed".
const VOLATILE_FIELDS = ['views', 'publicUntil', 'publicRequestedBy'];

function contentOnly(data) {
    const out = {};
    Object.keys(data).forEach(k => { if (!VOLATILE_FIELDS.includes(k)) out[k] = data[k]; });
    return JSON.stringify(out);
}

// The stored copy is { id, ...firestoreData }, so compare everything but the id.
function matchesServer(recipeData, storedCopy) {
    const { id, ...rest } = storedCopy;
    return contentOnly(recipeData) === contentOnly(rest);
}

function statusOf(recipe) {
    const copy = saved[recipe.id];
    if (!copy) return 'none';
    return matchesServer(recipe.data, copy) ? 'saved' : 'update';
}

function labelFor(status) {
    if (status === 'saved') return '✅ Saved';
    if (status === 'update') return '🔄 Changed';
    return 'Not saved';
}

function visibleRecipes() {
    return serverRecipes.filter(r => {
        const status = statusOf(r);
        if (currentFilter === 'saved' && status !== 'saved') return false;
        if (currentFilter === 'none' && status !== 'none') return false;
        if (currentFilter === 'update' && status !== 'update') return false;
        if (currentFilter === 'favorites' && !favoriteIds.has(r.id)) return false;
        if (searchText && !(r.name || '').toLowerCase().includes(searchText)) return false;
        return true;
    });
}

function storageSummary() {
    const count = Object.keys(saved).length;
    const kb = Math.round(JSON.stringify(saved).length / 1024);
    const changed = serverRecipes.filter(r => statusOf(r) === 'update').length;
    let text = `${count} recipe${count === 1 ? '' : 's'} saved on this device (about ${kb} KB)`;
    if (changed) text += ` · ${changed} changed since you saved them`;
    return text;
}

function render() {
    saved = readStore();
    document.getElementById('od-summary').textContent = storageSummary();

    const list = document.getElementById('od-list');
    const shown = visibleRecipes();
    if (shown.length === 0) {
        list.innerHTML = `<p style="padding:14px; text-align:center; color:#94a3b8;">No recipes match.</p>`;
        return;
    }

    list.innerHTML = shown.map(r => {
        const status = statusOf(r);
        const star = favoriteIds.has(r.id) ? '❤️ ' : '';
        return `
            <label class="od-item">
                <input type="checkbox" data-id="${escapeHtml(r.id)}" ${selected.has(r.id) ? 'checked' : ''}>
                <span class="od-name">${star}${escapeHtml(r.name || 'Untitled')}</span>
                <span class="od-badge ${status}">${labelFor(status)}</span>
            </label>`;
    }).join('');

    list.querySelectorAll('input[type=checkbox]').forEach(box => {
        box.addEventListener('change', () => {
            if (box.checked) selected.add(box.dataset.id);
            else selected.delete(box.dataset.id);
        });
    });
}

function downloadIds(ids) {
    if (ids.length === 0) return;
    const store = readStore();
    ids.forEach(id => {
        const r = serverRecipes.find(x => x.id === id);
        if (r) store[id] = { id, ...r.data };
    });
    if (writeStore(store)) render();
}

function removeIds(ids) {
    if (ids.length === 0) return;
    const store = readStore();
    ids.forEach(id => delete store[id]);
    if (writeStore(store)) render();
}

async function loadEverything() {
    const summary = document.getElementById('od-summary');
    try {
        const snap = await getDocs(collection(db, "recipes"));
        serverRecipes = [];
        snap.forEach(d => serverRecipes.push({ id: d.id, name: d.data().name || d.data().n, data: d.data() }));
        serverRecipes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (e) {
        console.error("🔥 [OFFLINE PAGE] Could not load the cookbook:", e);
        summary.textContent = "Can't reach the cookbook right now. Try again when you have signal.";
        return;
    }

    const user = auth.currentUser;
    if (user) {
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            const favs = userSnap.exists() ? (userSnap.data().favorites || []) : [];
            favoriteIds = new Set(favs);
        } catch (e) {
            console.warn("Could not load favorites:", e);
        }
    }
    render();
}

function bindControls() {
    document.getElementById('od-search').addEventListener('input', (e) => {
        searchText = e.target.value.trim().toLowerCase();
        render();
    });

    document.querySelectorAll('#od-filters .od-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#od-filters .od-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            render();
        });
    });

    document.getElementById('od-select-visible').addEventListener('click', () => {
        visibleRecipes().forEach(r => selected.add(r.id));
        render();
    });
    document.getElementById('od-select-none').addEventListener('click', () => {
        selected.clear();
        render();
    });

    document.getElementById('od-download-selected').addEventListener('click', () => {
        const ids = [...selected];
        if (ids.length === 0) return alert("Pick some recipes first.");
        downloadIds(ids);
        selected.clear();
        render();
    });

    document.getElementById('od-remove-selected').addEventListener('click', () => {
        const ids = [...selected].filter(id => saved[id]);
        if (ids.length === 0) return alert("None of the selected recipes are saved on this device.");
        if (!confirm(`Remove ${ids.length} recipe${ids.length === 1 ? '' : 's'} from this device?`)) return;
        removeIds(ids);
        selected.clear();
        render();
    });

    document.getElementById('od-sync-all').addEventListener('click', () => {
        const ids = serverRecipes.filter(r => statusOf(r) === 'update').map(r => r.id);
        if (ids.length === 0) return alert("Everything you saved is up to date.");
        downloadIds(ids);
        alert(`Updated ${ids.length} recipe${ids.length === 1 ? '' : 's'} on this device.`);
    });
}

bindControls();

onAuthStateChanged(auth, (user) => {
    if (user) loadEverything();
    else window.location.href = "index.html";
});
