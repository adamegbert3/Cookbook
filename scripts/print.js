import { db, auth } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where, documentId } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { getSections, hasRealSections } from './recipe-model.js';

let indexedRecipes = [];

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "index.html";
        return;
    }
    loadPickList();
});

async function loadPickList() {
    const container = document.getElementById('print-pick-list');
    console.log("🖨️ [PRINT] Loading the recipe pick list...");
    try {
        const docSnap = await getDoc(doc(db, "static_assets", "cookbook_index"));
        if (!docSnap.exists()) {
            console.warn("🖨️ [PRINT] No cookbook_index doc found.");
            container.innerHTML = "<p style='text-align:center;'>No recipes found.</p>";
            return;
        }

        indexedRecipes = (docSnap.data().recipes || []).filter(r => r.h !== true);
        console.log(`✅ [PRINT] Loaded ${indexedRecipes.length} recipe(s) into the pick list.`);
        indexedRecipes.sort((a, b) => (a.n || "").localeCompare(b.n || ""));

        const byCategory = {};
        indexedRecipes.forEach(r => {
            const cat = (r.t && r.t[0]) || r.c || "Miscellaneous";
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(r);
        });

        const sortedCats = Object.keys(byCategory).sort();

        container.innerHTML = sortedCats.map(cat => `
            <div class="print-pick-card" data-category="${cat}">
                <h3>
                    ${cat} <span style="font-size:12px; color:#9ca3af; font-weight:normal;">(${byCategory[cat].length})</span>
                    <button class="pill-btn btn-slate" onclick="selectCategory('${cat.replace(/'/g, "\\'")}', true)">All</button>
                </h3>
                ${byCategory[cat].map(r => `
                    <label class="print-pick-row">
                        <input type="checkbox" class="print-pick-checkbox" value="${r.id}">
                        ${r.n}
                    </label>
                `).join('')}
            </div>
        `).join('');

        // Arriving from a single recipe's Share dialog (print.html?id=…) —
        // pre-tick that recipe and scroll to it, so "print just this one"
        // stays one tap even though printing now lives on this page.
        const preselectId = new URLSearchParams(window.location.search).get('id');
        if (preselectId) {
            const box = container.querySelector(`.print-pick-checkbox[value="${CSS.escape(preselectId)}"]`);
            if (box) {
                box.checked = true;
                box.closest('.print-pick-row').scrollIntoView({ behavior: 'smooth', block: 'center' });
                console.log("🖨️ [PRINT] Pre-selected recipe from the share link:", preselectId);
            }
        }

    } catch (e) {
        console.error("Print pick list error:", e);
        container.innerHTML = "<p style='text-align:center; color:red;'>Could not load recipes.</p>";
    }
}

window.selectAll = function(state) {
    document.querySelectorAll('.print-pick-checkbox').forEach(cb => { cb.checked = state; });
};

window.selectCategory = function(category, state) {
    const card = document.querySelector(`.print-pick-card[data-category="${CSS.escape(category)}"]`);
    if (!card) return;
    card.querySelectorAll('.print-pick-checkbox').forEach(cb => { cb.checked = state; });
};

// Firestore's `where(documentId(), 'in', ...)` accepts at most 30 values per
// query, so a big "select everything" print run is fetched in batches of 30
// instead of firing one getDoc() per recipe — that N-individual-round-trips
// approach (with zero progress feedback) was the "takes forever, nothing
// logged" slowness.
const PRINT_FETCH_CHUNK_SIZE = 30;

function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

window.printSelected = async function(options = {}) {
    const asBook = options.asBook === true;
    const ids = Array.from(document.querySelectorAll('.print-pick-checkbox:checked')).map(cb => cb.value);
    if (ids.length === 0) return alert("Pick at least one recipe first.");

    const output = document.getElementById('print-output');
    output.innerHTML = `<p style="text-align:center;">Preparing ${ids.length} recipe(s)...</p>`;
    console.log(`🖨️ [PRINT] Preparing ${ids.length} recipe(s) for printing...`);

    try {
        const idChunks = chunkArray(ids, PRINT_FETCH_CHUNK_SIZE);
        const recipesById = {};

        for (let i = 0; i < idChunks.length; i++) {
            const progressMsg = `Fetching batch ${i + 1} of ${idChunks.length}...`;
            console.log(`🖨️ [PRINT] ${progressMsg}`);
            output.innerHTML = `<p style="text-align:center;">${progressMsg}</p>`;

            const batchQuery = query(collection(db, "recipes"), where(documentId(), "in", idChunks[i]));
            const snap = await getDocs(batchQuery);
            snap.forEach(d => { recipesById[d.id] = { id: d.id, ...d.data() }; });
        }

        // Keep the order the user picked them in — object key order from the
        // batched fetch above isn't guaranteed to match.
        const recipes = ids.map(id => recipesById[id]).filter(Boolean);
        console.log(`✅ [PRINT] Fetched ${recipes.length} of ${ids.length} recipe(s). Building ${asBook ? 'cookbook' : 'print'} layout...`);

        output.innerHTML = asBook
            ? buildCookbookHtml(recipes)
            : recipes.map(recipeToPrintHtml).join('');

        console.log("🖨️ [PRINT] Opening the print dialog now...");
        printOnly(output);

    } catch (e) {
        console.error("🔥 [PRINT] Print error:", e);
        alert("Could not prepare recipes for printing.");
    }
};

// Detaches the recipe-picker UI from the document while printing.
//
// `.no-print { display: none }` hid it visually but left every node in the
// tree — and the print stylesheet applies a very broad
// `div, span, p, li { ... !important }` rule, so the browser still had to
// recompute styles and lay out the ENTIRE cookbook picker (one row per
// recipe) before it could render even a 3-recipe printout. That's the
// "console says it's done, then it hangs" delay. Physically removing the
// picker means the print document contains only what's being printed.
function printOnly(output) {
    const main = document.querySelector('main');
    const placeholder = document.createComment('picker-hidden-while-printing');
    const parent = main && main.parentNode;

    if (parent) parent.replaceChild(placeholder, main);
    output.style.display = 'block';

    const restore = () => {
        if (parent && placeholder.parentNode) parent.replaceChild(main, placeholder);
        output.style.display = '';
        window.removeEventListener('afterprint', restore);
        console.log("🖨️ [PRINT] Print dialog closed, picker restored.");
    };
    window.addEventListener('afterprint', restore);

    // Let the browser paint the detached layout once before opening the
    // dialog, then hard-restore after a while in case afterprint never
    // fires (Safari has historically been unreliable about it).
    requestAnimationFrame(() => {
        window.print();
        setTimeout(restore, 60000);
    });
}

// ==========================================
// GIFT-ABLE COOKBOOK LAYOUT
// Title page → table of contents → a divider before each category →
// the recipes, grouped and alphabetised within each category.
// ==========================================
function recipeCategory(recipe) {
    if (Array.isArray(recipe.tags) && recipe.tags.length > 0) return recipe.tags[0];
    return recipe.category || "Miscellaneous";
}

function buildCookbookHtml(recipes) {
    const title = (document.getElementById('book-title')?.value || "Our Family Cookbook").trim();
    const subtitle = (document.getElementById('book-subtitle')?.value || "").trim();

    // Group by category, alphabetise categories and recipes within them
    const byCategory = {};
    recipes.forEach(r => {
        const cat = recipeCategory(r);
        (byCategory[cat] = byCategory[cat] || []).push(r);
    });
    const categories = Object.keys(byCategory).sort();
    categories.forEach(cat => byCategory[cat].sort((a, b) => (a.name || "").localeCompare(b.name || "")));

    const printedOn = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // 1. Cover
    const cover = `
        <div class="book-cover">
            <img src="images/logo.jpg" alt="">
            <h1>${title}</h1>
            ${subtitle ? `<p class="book-subtitle">${subtitle}</p>` : ''}
            <hr class="book-rule">
            <p class="book-meta">${recipes.length} recipes · ${categories.length} sections</p>
            <p class="book-meta">${printedOn}</p>
        </div>`;

    // 2. Table of contents
    const toc = `
        <div class="book-toc">
            <h2>Contents</h2>
            ${categories.map(cat => `
                <div class="book-toc-category">${cat}</div>
                ${byCategory[cat].map(r => `
                    <div class="book-toc-item">
                        <span>${r.name || "Untitled"}</span>
                        <span class="toc-author">${r.author || "Family"}</span>
                    </div>`).join('')}
            `).join('')}
        </div>`;

    // 3. Divider + recipes per category
    const body = categories.map(cat => {
        const count = byCategory[cat].length;
        return `
            <div class="book-divider">
                <h2>${cat}</h2>
                <p class="divider-count">${count} recipe${count === 1 ? '' : 's'}</p>
            </div>
            ${byCategory[cat].map(recipeToPrintHtml).join('')}`;
    }).join('');

    console.log(`📖 [COOKBOOK] Built "${title}" — ${recipes.length} recipes across ${categories.length} sections.`);
    return cover + toc + body;
}

function recipeToPrintHtml(recipe) {
    const rawIng = recipe.ingredients || recipe.recipeIngredient;
    const rawInst = recipe.instructions || recipe.recipeInstructions;

    // Multi-part recipes print with their group headings intact
    const ingSections = getSections(recipe, 'ingredients');
    const instSections = getSections(recipe, 'instructions');

    const ingHtml = hasRealSections(ingSections)
        ? ingSections.map(s => `
            ${s.title ? `<h4 class="print-subsection">${s.title}</h4>` : ''}
            <ul>${(s.items || []).map(i => `<li>${i}</li>`).join('')}</ul>`).join('')
        : (Array.isArray(rawIng)
            ? `<ul>${rawIng.map(i => `<li>${i}</li>`).join('')}</ul>`
            : `<p>${rawIng || ''}</p>`);

    const instHtml = hasRealSections(instSections)
        ? instSections.map(s => `
            ${s.title ? `<h4 class="print-subsection">${s.title}</h4>` : ''}
            <ol>${(s.items || []).map(step => `<li>${step}</li>`).join('')}</ol>`).join('')
        : (Array.isArray(rawInst)
            ? `<ol>${rawInst.map(s => `<li>${s}</li>`).join('')}</ol>`
            : `<p>${rawInst || ''}</p>`);

    const notesHtml = recipe.notes && String(recipe.notes).trim()
        ? `<h3 class="section-header">📝 Recipe Notes</h3><p style="white-space:pre-wrap;">${recipe.notes}</p>`
        : '';

    return `
        <div class="print-recipe-block">
            <h1 class="recipe-title-lg">${recipe.name || "Untitled"}</h1>
            <h2 class="recipe-chef">From: ${recipe.author || "Family"}</h2>
            <hr class="recipe-divider">
            <h3 class="section-header">Ingredients</h3>
            ${ingHtml}
            <h3 class="section-header">Instructions</h3>
            ${instHtml}
            ${notesHtml}
        </div>
    `;
}
