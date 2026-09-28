import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { getSections, hasRealSections, prettyFractions } from './recipe-model.js';

// No Firebase Auth involved at all on purpose — this page exists so a
// printed recipe card's QR code works for a total stranger, no login and no
// guest code. The Firestore rule (publicUntil > now) is the real gate; this
// file just renders whatever it's allowed to read. Once publicUntil passes,
// the exact same link starts failing on its own — no cleanup step needed.
const recipeId = new URLSearchParams(window.location.search).get('id');

function showError(message) {
    const statusEl = document.getElementById('share-status');
    statusEl.textContent = message;
    statusEl.style.display = 'block';
    document.getElementById('share-recipe').style.display = 'none';
}

function renderRecipe(recipe) {
    const rawIng = recipe.ingredients || recipe.recipeIngredient;
    const rawInst = recipe.instructions || recipe.recipeInstructions;

    // Same section-aware rendering as the real recipe page / print.js, via
    // the same shared helpers, so a multi-part recipe (crust + filling, say)
    // reads the same way here as everywhere else in the app.
    const ingSections = getSections(recipe, 'ingredients');
    const instSections = getSections(recipe, 'instructions');

    const ingHtml = hasRealSections(ingSections)
        ? ingSections.map(s => `
            ${s.title ? `<h4 class="print-subsection">${s.title}</h4>` : ''}
            <ul>${(s.items || []).map(i => `<li>${prettyFractions(i)}</li>`).join('')}</ul>`).join('')
        : (Array.isArray(rawIng)
            ? `<ul>${rawIng.map(i => `<li>${prettyFractions(i)}</li>`).join('')}</ul>`
            : `<p>${prettyFractions(rawIng || '')}</p>`);

    const instHtml = hasRealSections(instSections)
        ? instSections.map(s => `
            ${s.title ? `<h4 class="print-subsection">${s.title}</h4>` : ''}
            <ol>${(s.items || []).map(step => `<li>${prettyFractions(step)}</li>`).join('')}</ol>`).join('')
        : (Array.isArray(rawInst)
            ? `<ol>${rawInst.map(s => `<li>${prettyFractions(s)}</li>`).join('')}</ol>`
            : `<p>${prettyFractions(rawInst || '')}</p>`);

    document.getElementById('share-recipe').innerHTML = `
        <h1 class="recipe-title-lg">${prettyFractions(recipe.name || "Untitled")}</h1>
        <h2 class="recipe-chef">From: ${recipe.author || "Family"}</h2>
        <hr class="recipe-divider">
        <h3 class="section-header">Ingredients</h3>
        ${ingHtml}
        <h3 class="section-header">Instructions</h3>
        ${instHtml}
    `;

    document.getElementById('share-status').style.display = 'none';
    document.getElementById('share-recipe').style.display = 'block';
    document.getElementById('share-print-btn').style.display = 'inline-block';
}

async function init() {
    if (!recipeId) {
        showError("This link is missing a recipe. Ask whoever shared it with you for the full link.");
        return;
    }

    let snap;
    try {
        snap = await getDoc(doc(db, "recipes", recipeId));
    } catch (e) {
        // The Firestore rule denies this exact case (not public / doesn't
        // exist), so a permission error here means "not shared," not a
        // real outage — this is the expected path for a stale/wrong link.
        console.warn("🔗 [SHARE] Could not load recipe:", e.message);
        showError("This recipe isn't shared publicly, or the link is no longer valid.");
        return;
    }

    if (!snap.exists()) {
        showError("This recipe doesn't exist anymore.");
        return;
    }

    document.title = `${snap.data().name || "Recipe"} | Family Cookbook`;
    renderRecipe({ id: snap.id, ...snap.data() });
}

document.getElementById('share-print-btn')?.addEventListener('click', () => window.print());

init();
