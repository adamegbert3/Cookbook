import { db, auth } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where, documentId } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

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

window.printSelected = async function() {
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
        console.log(`✅ [PRINT] Fetched ${recipes.length} of ${ids.length} recipe(s). Building print layout...`);

        output.innerHTML = recipes.map(recipeToPrintHtml).join('');

        console.log("🖨️ [PRINT] Opening the print dialog now...");
        setTimeout(() => window.print(), 300);

    } catch (e) {
        console.error("🔥 [PRINT] Print error:", e);
        alert("Could not prepare recipes for printing.");
    }
};

function recipeToPrintHtml(recipe) {
    const rawIng = recipe.ingredients || recipe.recipeIngredient;
    const rawInst = recipe.instructions || recipe.recipeInstructions;

    const ingHtml = Array.isArray(rawIng)
        ? `<ul>${rawIng.map(i => `<li>${i}</li>`).join('')}</ul>`
        : `<p>${rawIng || ''}</p>`;

    const instHtml = Array.isArray(rawInst)
        ? `<ol>${rawInst.map(s => `<li>${s}</li>`).join('')}</ol>`
        : `<p>${rawInst || ''}</p>`;

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
