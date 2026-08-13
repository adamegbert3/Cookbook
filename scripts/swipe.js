// 🃏 SWIPE TO DECIDE — a quick, Tinder-style way to narrow "what should we
// make?" down from the whole cookbook to a short, easy pick. Pick a preset
// (Breakfast, Dinner, etc.), swipe through a shuffled stack (right/👍 to
// keep it in the running, left/👎 to skip it), and whatever's left at the
// end is the shortlist.
//
// Reads from the same static_assets/cookbook_index doc the homepage and
// print page use — fast, and keeps this consistent with what's actually
// visible in the cookbook (hidden + Testing Kitchen drafts excluded, family
// filter respected).
import { db, auth } from './firebase-config.js';
import { doc, getDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { getDietaryTags, matchesFamilyFilter, getSections, hasRealSections, prettyFractions } from './recipe-model.js';

// Keep this list loosely in sync with the category buttons in homepage.html
// — presets map onto the same underlying category tags, just grouped and
// relabeled around meal times rather than dish types.
const PRESETS = [
    { emoji: '🌅', label: 'Breakfast', categories: ['Breakfast'] },
    { emoji: '🍽️', label: 'Dinner', categories: ['Main Dishes'] },
    { emoji: '🍪', label: 'Dessert', categories: ['Desserts'] },
    { emoji: '🥗', label: 'Sides & Salads', categories: ['Sides & Veggies', 'Soups & Salads'] },
    { emoji: '🥨', label: 'Snacks', categories: ['Appetizers & Snacks'] },
    { emoji: '🍞', label: 'Breads', categories: ['Breads & Rolls'] },
];

const CATEGORY_COLORS = {
    'main dishes': '#ef4444', 'desserts': '#eab308', 'appetizers & snacks': '#3b82f6',
    'breakfast': '#f97316', 'breads & rolls': '#92400e', 'soups & salads': '#8b5cf6',
    'sauces, dressings & marinades': '#14b8a6', 'sides & veggies': '#22c55e',
    'dutch oven': '#64748b', 'miscellaneous': '#9ca3af'
};

let allRecipes = [];
let deck = [];
let deckIndex = 0;
let keptRecipes = [];
let skippedCount = 0;

// Defaults to ON — an unreviewed recipe hasn't been double-checked by
// whoever submitted it, and this tool is specifically for "what should we
// actually make", not "what might work". Remembered across visits.
let reviewedOnly = localStorage.getItem('swipeReviewedOnly') !== 'false';

window.setReviewedOnly = function(value) {
    reviewedOnly = value;
    localStorage.setItem('swipeReviewedOnly', String(value));
    renderPresets();
};

function eligibleRecipes() {
    return reviewedOnly ? allRecipes.filter(r => r.r === true) : allRecipes;
}

// The homepage index (allRecipes) is compact — no ingredients/instructions,
// just enough for a card list. Cards here show the real thing, so full
// recipe docs are fetched once, lazily (only when the first deck actually
// starts), and reused for every deck after that in the same visit.
let fullRecipesById = {};
let fullDataLoaded = false;

async function ensureFullRecipesLoaded() {
    if (fullDataLoaded) return;
    console.log("🃏 [SWIPE] Loading full recipe details (ingredients/instructions)...");
    const snap = await getDocs(collection(db, "recipes"));
    snap.forEach(d => { fullRecipesById[d.id] = { id: d.id, ...d.data() }; });
    fullDataLoaded = true;
}

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "index.html";
        return;
    }
    loadRecipes();
});

async function loadRecipes() {
    try {
        const docSnap = await getDoc(doc(db, "static_assets", "cookbook_index"));
        if (!docSnap.exists()) {
            document.getElementById('preset-grid').innerHTML = "<p style='grid-column:1/-1; text-align:center;'>No recipes found.</p>";
            return;
        }

        const settings = JSON.parse(localStorage.getItem('userSettings') || '{}');
        allRecipes = (docSnap.data().recipes || [])
            .filter(r => r.h !== true && r.draft !== true)
            .filter(r => matchesFamilyFilter(r, settings.familyFilter));

        console.log(`🃏 [SWIPE] Loaded ${allRecipes.length} recipe(s).`);
        const toggle = document.getElementById('reviewed-only-toggle');
        if (toggle) toggle.checked = reviewedOnly;
        renderPresets();
    } catch (e) {
        console.error("🔥 [SWIPE] Could not load recipes:", e);
        document.getElementById('preset-grid').innerHTML = "<p style='grid-column:1/-1; text-align:center;'>Could not load recipes.</p>";
    }
}

function recipeCategories(r) {
    const tags = Array.isArray(r.t) ? r.t : [];
    return tags.length > 0 ? tags : [r.c || 'Miscellaneous'];
}

function renderPresets() {
    const grid = document.getElementById('preset-grid');
    const eligible = eligibleRecipes();

    if (allRecipes.length === 0) {
        grid.innerHTML = "<p style='grid-column:1/-1; text-align:center;'>Nothing to swipe through yet.</p>";
        return;
    }
    if (eligible.length === 0) {
        grid.innerHTML = "<p style='grid-column:1/-1; text-align:center;'>No verified recipes yet — turn off \"Only suggest Verified recipes\" below to include everything.</p>";
        return;
    }

    let html = '';
    PRESETS.forEach(preset => {
        const count = eligible.filter(r => recipeCategories(r).some(c => preset.categories.includes(c))).length;
        if (count === 0) return;
        html += `<div class="preset-btn" onclick="startDeck(${JSON.stringify(preset.categories).replace(/"/g, '&quot;')}, ${JSON.stringify(preset.label).replace(/"/g, '&quot;')})">
            <span class="emoji">${preset.emoji}</span>${preset.label}<br><span style="font-weight:400; opacity:0.6; font-size:0.8rem;">${count} recipe${count === 1 ? '' : 's'}</span>
        </div>`;
    });
    html += `<div class="preset-btn surprise" onclick="startDeck(null, 'Surprise Me')">
        <span class="emoji">🎲</span>Surprise Me<br><span style="font-weight:400; opacity:0.85; font-size:0.8rem;">${eligible.length} recipes</span>
    </div>`;

    grid.innerHTML = html;
}

function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

window.startDeck = async function(categories, label) {
    const intro = document.querySelector('#preset-screen .intro');
    const originalIntro = intro.innerText;
    if (!fullDataLoaded) intro.innerText = "⏳ Loading recipes...";

    try {
        await ensureFullRecipesLoaded();
    } catch (e) {
        console.error("🔥 [SWIPE] Could not load recipe details:", e);
        intro.innerText = originalIntro;
        alert("Could not load recipe details — check your connection and try again.");
        return;
    }
    intro.innerText = originalIntro;

    const eligible = eligibleRecipes();
    deck = shuffle(categories
        ? eligible.filter(r => recipeCategories(r).some(c => categories.includes(c)))
        : eligible);
    deckIndex = 0;
    keptRecipes = [];
    skippedCount = 0;

    document.getElementById('preset-screen').style.display = 'none';
    document.getElementById('results-screen').style.display = 'none';
    document.getElementById('deck-screen').style.display = 'block';
    document.getElementById('results-title').innerText = `Your ${label} Shortlist`;

    updateCounters();
    renderStack();
};

function updateCounters() {
    document.getElementById('deck-progress').innerText = `${deckIndex} of ${deck.length}`;
    document.getElementById('kept-count').innerText = `👍 ${keptRecipes.length}`;
    document.getElementById('skipped-count').innerText = `👎 ${skippedCount}`;
}

function cardHtml(recipe, extraClass) {
    const full = fullRecipesById[recipe.id] || {};
    const cat = (recipeCategories(recipe)[0] || 'Miscellaneous');
    const color = CATEGORY_COLORS[cat.toLowerCase()] || '#9ca3af';
    const dietary = getDietaryTags({ dietary: recipe.d || [] });
    const chips = [cat, ...dietary].map(t => `<span class="tag-pill">${t}</span>`).join('');
    const isReviewed = recipe.r === true;
    const reviewBadge = isReviewed
        ? `<span class="review-badge review-yes">✅ Verified</span>`
        : `<span class="review-badge review-no">⚠️ Unreviewed</span>`;

    const rawIng = full.ingredients || full.recipeIngredient || [];
    const rawInst = full.instructions || full.recipeInstructions || [];
    const ingSections = getSections(full, 'ingredients');
    const instSections = getSections(full, 'instructions');

    const ingHtml = hasRealSections(ingSections)
        ? ingSections.map(s => `
            ${s.title ? `<div class="card-subhead">${s.title}</div>` : ''}
            <ul>${(s.items || []).map(i => `<li>${prettyFractions(i)}</li>`).join('')}</ul>`).join('')
        : (Array.isArray(rawIng) && rawIng.length
            ? `<ul>${rawIng.map(i => `<li>${prettyFractions(i)}</li>`).join('')}</ul>`
            : `<p class="card-empty">No ingredients listed.</p>`);

    const instHtml = hasRealSections(instSections)
        ? instSections.map(s => `
            ${s.title ? `<div class="card-subhead">${s.title}</div>` : ''}
            <ol>${(s.items || []).map(step => `<li>${prettyFractions(step)}</li>`).join('')}</ol>`).join('')
        : (Array.isArray(rawInst) && rawInst.length
            ? `<ol>${rawInst.map(step => `<li>${prettyFractions(step)}</li>`).join('')}</ol>`
            : `<p class="card-empty">No instructions listed.</p>`);

    return `
        <div class="swipe-card ${extraClass}" style="border-top-color:${color};" data-id="${recipe.id}">
            <div class="stamp keep">KEEP</div>
            <div class="stamp skip">SKIP</div>
            <div class="card-head">
                ${reviewBadge}
                <h2>${recipe.n || 'Untitled'}</h2>
                <div class="author">From: ${recipe.a || 'Family'}</div>
                <div class="chip-row">${chips}</div>
            </div>
            <div class="card-scroll">
                <div class="card-section-title">Ingredients</div>
                ${ingHtml}
                <div class="card-section-title">Instructions</div>
                ${instHtml}
            </div>
        </div>`;
}

function renderStack() {
    const stack = document.getElementById('card-stack');

    if (deckIndex >= deck.length) {
        showResults();
        return;
    }

    const current = deck[deckIndex];
    const next = deck[deckIndex + 1];

    stack.innerHTML = (next ? cardHtml(next, 'behind') : '') + cardHtml(current, 'top');
    updateCounters();

    const topCard = stack.querySelector('.swipe-card.top');
    if (topCard) attachDrag(topCard);
}

// The card's ingredients/instructions scroll vertically, so a thumb drag
// can't be assumed to mean "swipe to decide" the instant it starts — it
// might just be someone reading the recipe. Direction is decided on the
// first few pixels of movement: mostly-vertical hands the gesture to the
// browser's native scrolling (never captured, never prevented); only a
// mostly-horizontal move becomes the swipe-to-decide drag.
function attachDrag(card) {
    let startX = 0, startY = 0, deltaX = 0, deltaY = 0, mode = null, isDown = false;
    const keepStamp = card.querySelector('.stamp.keep');
    const skipStamp = card.querySelector('.stamp.skip');

    const reset = () => { mode = null; deltaX = 0; deltaY = 0; };

    const onPointerDown = (e) => {
        // Mouse "pointermove" fires just from hovering, with no button
        // pressed — without this flag, moving the mouse anywhere over the
        // card (never having clicked) was read as a drag from an
        // uninitialized start point, throwing the card way off to one side.
        isDown = true;
        startX = e.clientX;
        startY = e.clientY;
        reset();
    };

    const onPointerMove = (e) => {
        if (!isDown || mode === 'scroll') return;
        deltaX = e.clientX - startX;
        deltaY = e.clientY - startY;

        if (mode === null) {
            if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
            if (Math.abs(deltaY) > Math.abs(deltaX)) { mode = 'scroll'; return; }
            mode = 'swipe';
            card.setPointerCapture(e.pointerId);
        }

        const rotate = deltaX / 18;
        card.style.transform = `translate(${deltaX}px, ${deltaY * 0.4}px) rotate(${rotate}deg)`;

        const pull = Math.min(Math.abs(deltaX) / 100, 1);
        if (deltaX > 0) { keepStamp.style.opacity = pull; skipStamp.style.opacity = 0; }
        else { skipStamp.style.opacity = pull; keepStamp.style.opacity = 0; }
    };

    const onPointerUp = () => {
        isDown = false;
        if (mode !== 'swipe') { reset(); return; }
        const THRESHOLD = 100;
        if (deltaX > THRESHOLD) decide('keep');
        else if (deltaX < -THRESHOLD) decide('skip');
        else {
            card.style.transition = 'transform 0.25s ease';
            card.style.transform = '';
            keepStamp.style.opacity = 0;
            skipStamp.style.opacity = 0;
            setTimeout(() => { card.style.transition = ''; }, 250);
        }
        reset();
    };

    card.addEventListener('pointerdown', onPointerDown);
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp);
    card.addEventListener('pointercancel', onPointerUp);
}

function flingCard(card, direction) {
    card.style.transition = 'transform 0.3s ease';
    card.style.transform = `translate(${direction * 600}px, -40px) rotate(${direction * 30}deg)`;
}

// Shared by drag release, the 👍/👎 buttons, and arrow keys — always the
// single source of truth for "what happens when a decision is made". Flings
// the top card off itself (rather than relying on the caller to have
// already animated it) so a button tap or arrow key looks the same as a
// drag release, not an abrupt jump-cut.
window.decide = function(outcome) {
    const current = deck[deckIndex];
    if (!current) return;

    const topCard = document.querySelector('#card-stack .swipe-card.top');
    if (topCard) flingCard(topCard, outcome === 'keep' ? 1 : -1);

    if (outcome === 'keep') keptRecipes.push(current);
    else skippedCount++;

    deckIndex++;
    // Let the fling animation play out before the DOM is rebuilt underneath it.
    setTimeout(renderStack, topCard ? 260 : 0);
};

document.addEventListener('keydown', (e) => {
    if (document.getElementById('deck-screen').style.display !== 'block') return;
    if (e.key === 'ArrowRight') decide('keep');
    else if (e.key === 'ArrowLeft') decide('skip');
});

function showResults() {
    document.getElementById('deck-screen').style.display = 'none';
    document.getElementById('results-screen').style.display = 'block';

    const list = document.getElementById('results-list');
    if (keptRecipes.length === 0) {
        list.innerHTML = '';
        list.insertAdjacentHTML('afterend', '<p class="results-empty" id="results-empty-msg">You skipped everything — no shame, try another category!</p>');
    } else {
        document.getElementById('results-empty-msg')?.remove();
        list.innerHTML = keptRecipes.map(r => `
            <a class="result-row" href="recipe.html?id=${encodeURIComponent(r.id)}">
                ${r.n || 'Untitled'} <span class="r-author">— ${r.a || 'Family'}</span>
            </a>`).join('');
    }

    console.log(`🃏 [SWIPE] Session done: ${keptRecipes.length} kept, ${skippedCount} skipped.`);
}

window.restartPresets = function() {
    document.getElementById('results-screen').style.display = 'none';
    document.getElementById('deck-screen').style.display = 'none';
    document.getElementById('preset-screen').style.display = 'block';
};
