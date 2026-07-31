// ==========================================
// DEDICATED RECIPE REVIEW PAGE
// Lets the admin work through unreviewed recipes (sequentially, or by
// jumping straight to one from the "still needs review" list), and search
// across every recipe — reviewed or not — to check status while flipping
// through a physical cookbook.
// ==========================================
import { db, auth } from './firebase-config.js';
import {
    collection, getDocs, doc, getDoc, updateDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// "Built-in" admins — keep in sync with firestore.rules and the ADMIN_UIDS
// arrays in scripts/dashboard.js, scripts/main.js, scripts/profile.js, and
// edit-recipe.html. Everyone else is promoted live via the admin console's
// "Manage Admin Access" widget (no code changes needed).
const ADMIN_UIDS = [
    "n5aAU1g1tBY04Ut0HnhqegSgZe92",
    "NrY491PYN3MIrqJp4rhu5S86w2R2",
    "mPBrypCN9ab1LCEQ578E5YrX8DI2",
    "WxkJYdGYlIRs4FFdDdLcr05jUm22" // Austin
];

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

let allRecipes = [];       // every recipe, kept in sync locally after each save
let currentRecipeId = null;

onAuthStateChanged(auth, async (user) => {
    if (user && await checkIsAdmin(user.uid)) {
        console.log("👨‍🍳 [REVIEW] Admin confirmed. Loading recipes...");
        loadAllRecipes();
    } else {
        console.warn("🚫 [REVIEW] Not an admin — redirecting.");
        alert("Unauthorized.");
        window.location.href = "index.html";
    }
});

async function loadAllRecipes() {
    try {
        const snap = await getDocs(collection(db, "recipes"));
        allRecipes = [];
        snap.forEach(d => allRecipes.push({ id: d.id, ...d.data() }));
        allRecipes.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        console.log(`✅ [REVIEW] Loaded ${allRecipes.length} recipe(s).`);
        renderNeedsReviewList();

        const firstNeedsReview = getNeedsReviewList()[0];
        if (firstNeedsReview) {
            selectRecipe(firstNeedsReview.id);
        } else {
            currentRecipeId = null;
            document.getElementById('review-form-container').style.display = 'none';
            document.getElementById('all-done').style.display = 'block';
        }
    } catch (e) {
        console.error("🔥 [REVIEW] Could not load recipes:", e);
        alert("Could not load recipes: " + e.message);
    }
}

function getNeedsReviewList() {
    return allRecipes.filter(r => r.reviewed !== true);
}

function updateProgressHeader() {
    const needsCount = getNeedsReviewList().length;
    const total = allRecipes.length;
    const subtitleEl = document.getElementById('progress-subtitle');
    const barFillEl = document.getElementById('progress-bar-fill');

    subtitleEl.innerText = total === 0
        ? "No recipes found."
        : (needsCount > 0 ? `${needsCount} of ${total} recipe(s) still need review` : `All ${total} recipes reviewed! 🎉`);
    barFillEl.style.width = total > 0 ? `${((total - needsCount) / total) * 100}%` : '0%';
}

function renderNeedsReviewList() {
    const listEl = document.getElementById('needs-review-list');
    const countEl = document.getElementById('needs-review-count');
    const needs = getNeedsReviewList();

    countEl.innerText = needs.length;
    listEl.innerHTML = needs.length
        ? needs.map(r => reviewListRowHtml(r)).join('')
        : `<p class="hint" style="padding: 10px 4px;">🎉 Nothing left!</p>`;

    updateProgressHeader();
}

function reviewListRowHtml(recipe) {
    const isReviewed = recipe.reviewed === true;
    const activeClass = recipe.id === currentRecipeId ? ' active' : '';
    return `
        <div class="review-list-row${activeClass}" onclick="selectRecipe('${recipe.id}')">
            <span>${recipe.name || "Untitled"}</span>
            <span class="review-status-badge ${isReviewed ? 'reviewed' : 'unreviewed'}">${isReviewed ? '✅ Reviewed' : '⚠️ Needs Review'}</span>
        </div>`;
}

// --- SEARCH (across every recipe, reviewed or not) ---
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', () => renderSearchResults(searchInput.value.trim()));

function renderSearchResults(term) {
    const resultsEl = document.getElementById('search-results');
    if (!term) {
        resultsEl.classList.add('hidden');
        resultsEl.innerHTML = '';
        return;
    }

    const lower = term.toLowerCase();
    const matches = allRecipes.filter(r => (r.name || "").toLowerCase().includes(lower));
    console.log(`🔍 [REVIEW] Searching "${term}" — ${matches.length} match(es).`);

    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = matches.length
        ? matches.map(r => reviewListRowHtml(r)).join('')
        : `<p class="hint" style="padding: 10px 4px;">No matches.</p>`;
}

// --- SELECTING A RECIPE (from either list, or after Mark Reviewed & Next) ---
window.selectRecipe = function(id) {
    const recipe = allRecipes.find(r => r.id === id);
    if (!recipe) return;

    currentRecipeId = id;
    console.log("✏️ [REVIEW] Now reviewing:", recipe.name);
    populateForm(recipe);

    renderNeedsReviewList();
    const term = searchInput.value.trim();
    if (term) renderSearchResults(term);

    document.getElementById('review-form-container').style.display = 'block';
    document.getElementById('all-done').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function populateForm(recipe) {
    const isReviewed = recipe.reviewed === true;
    document.getElementById('review-recipe-name').innerHTML =
        `✏️ ${recipe.name || "Untitled"} <span id="review-status-badge" class="review-status-badge ${isReviewed ? 'reviewed' : 'unreviewed'}">${isReviewed ? '✅ Reviewed' : '⚠️ Needs Review'}</span>`;

    let detectedCategory = "Miscellaneous";
    if (recipe.tags && Array.isArray(recipe.tags) && recipe.tags.length > 0) detectedCategory = recipe.tags[0];
    else if (recipe.category) detectedCategory = recipe.category;
    document.getElementById('r-category').value = detectedCategory;

    document.getElementById('r-name').value = recipe.name || "";
    document.getElementById('r-author').value = recipe.author || "";
    document.getElementById('r-notes').value = recipe.notes || "";
    document.getElementById('r-drive-link').value = recipe.driveUrl || "";
    document.getElementById('r-source-url').value = recipe.sourceUrl || "";

    const tagsList = recipe.tags || [];
    document.getElementById('r-fav-egbert').checked = tagsList.includes("Egbert Favorite");
    document.getElementById('r-fav-wheeler').checked = tagsList.includes("Wheeler Favorite");

    const rawIng = recipe.ingredients || recipe.recipeIngredient;
    document.getElementById('r-ingredients').value = Array.isArray(rawIng) ? rawIng.join('\n') : (rawIng || "");

    const rawInst = recipe.instructions || recipe.recipeInstructions;
    document.getElementById('r-instructions').value = Array.isArray(rawInst) ? rawInst.join('\n') : (rawInst || "");

    document.getElementById('status-msg').innerText = "";
}

function readFormFields() {
    const cat = document.getElementById('r-category').value;
    const updatedTags = [cat];
    if (document.getElementById('r-fav-egbert').checked) updatedTags.push("Egbert Favorite");
    if (document.getElementById('r-fav-wheeler').checked) updatedTags.push("Wheeler Favorite");

    const ingArray = document.getElementById('r-ingredients').value.split('\n').map(l => l.trim()).filter(Boolean);
    const instArray = document.getElementById('r-instructions').value.split('\n').map(l => l.trim()).filter(Boolean);

    return {
        name: document.getElementById('r-name').value,
        author: document.getElementById('r-author').value,
        category: cat,
        tags: updatedTags,
        ingredients: ingArray,
        recipeIngredient: ingArray,
        instructions: instArray,
        recipeInstructions: instArray,
        notes: document.getElementById('r-notes').value.trim(),
        driveUrl: document.getElementById('r-drive-link').value.trim(),
        sourceUrl: document.getElementById('r-source-url').value.trim()
    };
}

// action: 'reviewed' (Mark Reviewed & Next), 'needs-review' (flag it, found
// via search), or 'keep' (save edits, don't touch the reviewed flag)
window.saveReview = async function(action) {
    const recipe = allRecipes.find(r => r.id === currentRecipeId);
    if (!recipe) return;

    const statusEl = document.getElementById('status-msg');
    statusEl.innerText = "Saving...";

    const fields = readFormFields();
    const reviewedValue = action === 'reviewed' ? true : (action === 'needs-review' ? false : recipe.reviewed === true);

    console.log(`💾 [REVIEW] Saving "${recipe.name}" (reviewed: ${reviewedValue})...`);

    try {
        // Snapshot the pre-edit version, same as edit-recipe.html
        try {
            await addDoc(collection(db, "recipes", recipe.id, "history"), { ...recipe, timestamp: serverTimestamp() });
        } catch (historyError) {
            console.error("Could not save history snapshot:", historyError);
        }

        await updateDoc(doc(db, "recipes", recipe.id), {
            ...fields,
            reviewed: reviewedValue,
            lastUpdated: serverTimestamp()
        });

        console.log(`✅ [REVIEW] Saved "${fields.name}".`);
        Object.assign(recipe, fields, { reviewed: reviewedValue });

        renderNeedsReviewList();
        const term = searchInput.value.trim();
        if (term) renderSearchResults(term);

        if (action === 'reviewed') {
            const next = getNeedsReviewList()[0];
            if (next) {
                selectRecipe(next.id);
            } else {
                currentRecipeId = null;
                document.getElementById('review-form-container').style.display = 'none';
                document.getElementById('all-done').style.display = 'block';
            }
        } else {
            populateForm(recipe);
        }
    } catch (e) {
        console.error("🔥 [REVIEW] Save failed:", e);
        statusEl.innerText = "❌ Error: " + e.message;
    }
};

window.skipReview = function() {
    const needs = getNeedsReviewList();
    if (needs.length === 0) return;
    const idx = needs.findIndex(r => r.id === currentRecipeId);
    const next = needs[(idx + 1) % needs.length];
    console.log(`⏭️ [REVIEW] Skipping to "${next.name}" without saving.`);
    selectRecipe(next.id);
};

window.autoSplitInstructions = function() {
    const instBox = document.getElementById('r-instructions');
    let text = instBox.value;
    if (!text) return;
    if (text.includes('\n')) {
        if (!confirm("This looks like it already has lines. Split anyway?")) return;
    }
    instBox.value = text.replace(/\. /g, '.\n');
};
