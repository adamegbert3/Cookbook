import { db, auth } from './firebase-config.js';
import {
    doc, getDoc, addDoc, collection, serverTimestamp, setDoc, arrayUnion, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { saveUserSettings, resolveFontSizePx, saveRecipeOffline, getOfflineRecipe,
         isTestModeOn, canUseTestMode, updateTestModeUi } from './main.js';
import { getSections, hasRealSections, flattenSections, getRecipeFamily, getDietaryTags, prettyFractions } from './recipe-model.js';
import { getPlanPath } from './household.js';

const urlParams = new URLSearchParams(window.location.search);
const recipeId = urlParams.get('id');

// ==========================================
// INGREDIENT <-> STEP MATCHING (simple keyword heuristic, no AI needed)
// ==========================================
const INGREDIENT_STOPWORDS = new Set([
    'cup', 'cups', 'tbsp', 'tbsps', 'tablespoon', 'tablespoons', 'tsp', 'tsps', 'teaspoon', 'teaspoons',
    'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'gram', 'grams', 'kg', 'ml', 'liter', 'liters',
    'clove', 'cloves', 'pinch', 'dash', 'slice', 'slices', 'can', 'cans', 'package', 'packages', 'box', 'boxes',
    'bag', 'bags', 'jar', 'jars', 'stick', 'sticks', 'large', 'small', 'medium', 'fresh', 'freshly', 'ground',
    'room', 'temperature', 'chopped', 'diced', 'minced', 'sliced', 'melted', 'softened', 'divided', 'optional',
    'plus', 'more', 'taste', 'about', 'approximately', 'each', 'and', 'or', 'the', 'for', 'with', 'into', 'of', 'to', 'a', 'an'
]);

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractKeywords(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !INGREDIENT_STOPWORDS.has(w) && isNaN(Number(w)));
}

function matchIngredientsForStep(stepText, ingredientsArr) {
    if (!Array.isArray(ingredientsArr) || ingredientsArr.length === 0) return [];
    const stepLower = (stepText || '').toLowerCase();
    return ingredientsArr.filter(ing => {
        const keywords = extractKeywords(ing);
        return keywords.some(kw => new RegExp(`\\b${escapeRegex(kw)}\\b`).test(stepLower));
    });
}

function stepIngredientsHtml(matched) {
    if (!matched || matched.length === 0) return "";
    return `<div class="step-ingredients">${matched.map(i => `<span class="ing-chip">🧂 ${i}</span>`).join('')}</div>`;
}

// ==========================================
// RECIPE SCALING (0.5x / 1x / 2x / 3x)
// ==========================================
const UNICODE_FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const NICE_FRACTIONS = [[0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'], [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [7 / 8, '7/8'], [1, '']];

function parseLeadingQuantity(line) {
    // Mixed number: "1 1/2 cups"
    let m = line.match(/^(\d+)\s+(\d+)\/(\d+)/);
    if (m) return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), raw: m[0] };

    // Simple fraction: "1/2 cup"
    m = line.match(/^(\d+)\/(\d+)/);
    if (m) return { value: Number(m[1]) / Number(m[2]), raw: m[0] };

    // Range: "2-3 cups"
    m = line.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
    if (m) return { value: [Number(m[1]), Number(m[2])], raw: m[0], isRange: true };

    // Whole number or decimal: "2 cups" / "1.5 tsp"
    m = line.match(/^(\d+(?:\.\d+)?)/);
    if (m) return { value: Number(m[1]), raw: m[0] };

    // Unicode fraction, optionally preceded by a whole number: "1½ cups" / "½ cup"
    m = line.match(/^(\d+\s*)?([¼½¾⅓⅔⅛⅜⅝⅞])/);
    if (m) {
        const whole = m[1] ? Number(m[1].trim()) : 0;
        return { value: whole + UNICODE_FRACTIONS[m[2]], raw: m[0] };
    }

    return null;
}

function formatQuantity(value) {
    if (value <= 0) return '0';

    const whole = Math.floor(value);
    const frac = value - whole;

    let best = NICE_FRACTIONS[0];
    let bestDiff = Infinity;
    for (const entry of NICE_FRACTIONS) {
        const diff = Math.abs(frac - entry[0]);
        if (diff < bestDiff) { bestDiff = diff; best = entry; }
    }

    if (bestDiff > 0.05) {
        // Not close to a common cooking fraction — just show a clean decimal
        return String(Math.round(value * 100) / 100);
    }

    let wholePart = whole;
    let fracLabel = best[1];
    if (best[0] === 1) { wholePart += 1; fracLabel = ''; }

    if (wholePart === 0 && fracLabel) return fracLabel;
    if (fracLabel) return `${wholePart} ${fracLabel}`;
    return String(wholePart);
}

function scaleIngredientLine(line, factor) {
    if (factor === 1 || typeof line !== 'string') return line;

    const parsed = parseLeadingQuantity(line);
    if (!parsed) return line; // No leading quantity (e.g. "Salt to taste") — leave untouched

    const rest = line.slice(parsed.raw.length);

    if (parsed.isRange) {
        return `${formatQuantity(parsed.value[0] * factor)}-${formatQuantity(parsed.value[1] * factor)}${rest}`;
    }
    return `${formatQuantity(parsed.value * factor)}${rest}`;
}

// ==========================================
// HIGH-ALTITUDE BAKING ADJUSTMENT (estimate, based on standard
// 3,000-5,000 / 5,000-7,000 / 7,000+ ft guidance — every recipe reacts
// differently, so this is a starting point, not a guarantee)
// ==========================================
const ALTITUDE_LABELS = { '3000': '3,000-5,000 ft', '5000': '5,000-7,000 ft', '7000': '7,000+ ft' };
const ALTITUDE_FACTORS = {
    '3000': { leavening: 0.875, sugar: 0.9375, liquid: 1.094 },
    '5000': { leavening: 0.75, sugar: 0.906, liquid: 1.1875 },
    '7000': { leavening: 0.625, sugar: 0.844, liquid: 1.219 }
};
const LEAVENING_KEYWORDS = ['baking powder', 'baking soda', 'yeast'];
const SUGAR_KEYWORDS = ['sugar', 'honey', 'corn syrup', 'molasses'];
const LIQUID_KEYWORDS = ['water', 'milk', 'buttermilk', 'cream'];

function classifyIngredientForAltitude(line) {
    const lower = line.toLowerCase();
    if (LEAVENING_KEYWORDS.some(k => lower.includes(k))) return 'leavening';
    if (SUGAR_KEYWORDS.some(k => lower.includes(k))) return 'sugar';
    if (LIQUID_KEYWORDS.some(k => lower.includes(k))) return 'liquid';
    return null;
}

// ==========================================
// SUBSTITUTION HINTS (common swaps, shown when an ingredient matches)
// ==========================================
const SUBSTITUTIONS = {
    'buttermilk': '1 cup milk + 1 tbsp lemon juice or vinegar (let sit 5 min)',
    'sour cream': 'plain yogurt, or 1 cup milk + 1 tbsp vinegar',
    'heavy cream': '3/4 cup milk + 1/4 cup melted butter (won’t whip, but works for cooking/baking)',
    'self-rising flour': '1 cup flour + 1 1/2 tsp baking powder + 1/4 tsp salt',
    'cake flour': '1 cup flour minus 2 tbsp, plus 2 tbsp cornstarch',
    'cornstarch': 'double the amount of flour',
    'brown sugar': '1 cup white sugar + 1 tbsp molasses',
    'honey': 'equal amount of maple syrup or corn syrup',
    'molasses': 'honey or dark corn syrup',
    'shortening': 'equal amount of butter (texture will be slightly different)',
    'vegetable oil': 'equal amount of melted butter or applesauce (in baking)',
    'white wine': 'chicken broth + a splash of vinegar',
    'red wine': 'beef broth + a splash of vinegar',
    'garlic clove': '1/8 tsp garlic powder per clove',
    'yeast': '1 tsp baking powder + 1/4 tsp baking soda (won’t rise the same — best for quick breads)',
    'mayonnaise': 'plain yogurt or sour cream',
    'ketchup': 'tomato paste + a splash of vinegar and a pinch of sugar',
    'breadcrumbs': 'crushed crackers or crushed cereal',
    'parmesan': 'any hard, salty grating cheese (romano, asiago)',
    'cream cheese': 'mascarpone or full-fat Greek yogurt',
    'evaporated milk': 'whole milk, simmered until slightly reduced',
    'lemon juice': 'white vinegar (use half the amount)',
    'eggs': '1/4 cup unsweetened applesauce per egg, or 1 tbsp ground flaxseed + 3 tbsp water per egg',
    'egg': '1/4 cup unsweetened applesauce, or 1 tbsp ground flaxseed + 3 tbsp water (let sit 5 min)'
};
const SUBSTITUTION_KEYS = Object.keys(SUBSTITUTIONS).sort((a, b) => b.length - a.length);

function findSubstitution(line) {
    const lower = String(line || '').toLowerCase();
    for (const key of SUBSTITUTION_KEYS) {
        if (new RegExp(`\\b${escapeRegex(key)}\\b`).test(lower)) {
            return { key, sub: SUBSTITUTIONS[key] };
        }
    }
    return null;
}

function applyAltitudeAdjustment(line, elevationBand) {
    if (!elevationBand || typeof line !== 'string') return line;

    const category = classifyIngredientForAltitude(line);
    if (!category) return line;

    const factor = ALTITUDE_FACTORS[elevationBand][category];
    const adjusted = scaleIngredientLine(line, factor);
    return `${adjusted} <span class="altitude-badge" title="Estimated adjustment for ${ALTITUDE_LABELS[elevationBand]}">🏔️</span>`;
}

// ==========================================
// 1. LOAD RECIPE LOGIC
// ==========================================
async function loadRecipe() {
    const recipeContainer = document.getElementById("recipe");
    if (!recipeContainer) return;

    let localData = null;
    try {
        const stored = localStorage.getItem("currentRecipeData");
        if (stored) localData = JSON.parse(stored);
    } catch (e) {}

    if (!recipeId) {
        recipeContainer.innerHTML = "<h2>No recipe selected.</h2>";
        return;
    }

    console.log("🍳 [RECIPE] Loading recipe:", recipeId);

    // ⚠️ Offline, Firestore's getDoc() does NOT fail — it queues the request
    // and waits indefinitely for a network that isn't coming. Without this
    // short-circuit the await below never settles, so neither the `else`
    // branch nor the `catch` ever ran and the page sat blank forever with a
    // lone "Loading recipe" in the console. Skip the network entirely when
    // the browser already knows we're offline.
    if (!navigator.onLine && renderCachedRecipe(localData, recipeContainer)) {
        console.warn("📴 [RECIPE] Offline — rendered the saved copy instead.");
        return;
    }

    try {
        const docRef = doc(db, "recipes", recipeId);
        // Backstop for the "technically online but nothing is getting
        // through" case (hotel wifi, dead zone), where navigator.onLine is
        // still true but the request would hang just the same.
        const docSnap = await withRecipeTimeout(getDoc(docRef), 8000);

        if (docSnap.exists()) {
            const fullData = { id: recipeId, ...docSnap.data() };
            console.log("✅ [RECIPE] Loaded:", fullData.name || fullData.n);
            originalRecipeData = fullData;
            localStorage.setItem("currentRecipeData", JSON.stringify(fullData));
            renderRecipeHTML(fullData);
            loadCookStats();
            logViewToDatabase(fullData);
            applyPersonalizationIfAny(fullData);
            afterRecipeShown(fullData);
        } else if (!renderCachedRecipe(localData, recipeContainer)) {
            recipeContainer.innerHTML = "<h2>Recipe not found.</h2>";
        }
    } catch (error) {
        console.error("Recipe load failed:", error);

        // Recipes now require a signed-in read. The auth gate below waits
        // for Firebase to restore the session, but it gives up after a few
        // seconds so a stalled SDK can't hang the page forever — which means
        // on a very slow connection we can arrive here unauthenticated and
        // get permission-denied. Wait properly for auth, then try once more
        // before falling back to the cached copy.
        if (error.code === 'permission-denied' && !auth.currentUser && navigator.onLine && !loadRecipe.retried) {
            loadRecipe.retried = true;
            console.warn("🔐 [RECIPE] Read denied before sign-in finished — waiting for auth and retrying.");
            const signedIn = await new Promise((resolve) => {
                const unsub = onAuthStateChanged(auth, (u) => { if (u) { unsub(); resolve(true); } });
                setTimeout(() => { unsub(); resolve(false); }, 8000);
            });
            if (signedIn) return loadRecipe();
        }

        // Fall back to a locally cached copy if we have one (offline / rules trouble)
        if (renderCachedRecipe(localData, recipeContainer)) return;

        const reason = error.code || error.message || "unknown error";
        recipeContainer.innerHTML = `
            <div style="text-align:center; padding: 40px 20px;">
                <h2>Couldn't load this recipe.</h2>
                <p style="font-size:12px; color:#94a3b8;">(${reason})</p>
                <p style="font-size:12px; color:#94a3b8;">If you're offline, this recipe hasn't been saved to this device yet. Tap "⛺ Download All Recipes for Offline" on the homepage next time you have signal.</p>
                <button onclick="location.reload()" class="pill-btn btn-teal">🔄 Try Again</button>
            </div>`;
    }
}

// Firestore hangs rather than erroring when it can't reach the network, so
// every read on this page races a timeout to guarantee we always fall
// through to the cached copy instead of leaving the page blank.
function withRecipeTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(Object.assign(new Error("Recipe request timed out."), { code: 'timeout' })), ms))
    ]);
}

// Renders this recipe from whatever we already have on the device: the full
// offline store first, then the lighter "last opened recipe" snapshot.
// Returns true if it managed to render something real.
function renderCachedRecipe(localData, recipeContainer) {
    const offlineCopy = getOfflineRecipe(recipeId);
    if (offlineCopy) {
        originalRecipeData = offlineCopy;
        renderRecipeHTML(offlineCopy);
        markOfflineRecipeView();
        return true;
    }

    // The lightweight snapshot only has a name/id unless a full copy was
    // saved, so only use it if it actually carries the recipe content.
    if (localData && localData.id === recipeId && (localData.ingredients || localData.recipeIngredient)) {
        originalRecipeData = localData;
        renderRecipeHTML(localData);
        markOfflineRecipeView();
        return true;
    }

    return false;
}

// Runs once the recipe is on screen, however it got there. Warns first if
// the recipe is unverified, and only asks "viewing or cooking?" afterwards —
// stacking both modals at once would be a mess.
function afterRecipeShown(recipe) {
    if (maybeShowUnreviewedWarning(recipe)) return; // it chains into the cook prompt on dismiss
    maybeShowCookPrompt();
}

// Shared tail-end for every offline/cached render path. The cook counter
// reads from localStorage so it still works with no signal, but comments
// need Firestore — without this they both sat on "Loading..." forever.
function markOfflineRecipeView() {
    loadCookStats();
    afterRecipeShown(lastRenderedRecipe || originalRecipeData || {});

    const commentsList = document.getElementById('commentsList');
    if (commentsList && commentsList.innerText.includes('Loading')) {
        commentsList.innerHTML = `<p class="empty-feed">💬 Family Discussion needs a connection — reconnect to read or post comments.</p>`;
    }
}

// ==========================================
// PERSONAL RECIPE OVERRIDES ("make it yours")
// Anyone can tweak any recipe (add more sugar, skip an ingredient, etc.).
// The change is saved only under that person's own account and never
// touches the shared recipe everyone else sees.
// ==========================================
let originalRecipeData = null;

function applyPersonalizationIfAny(baseRecipe) {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
        unsubscribe();
        if (!user) return;

        try {
            const overrideSnap = await getDoc(doc(db, "users", user.uid, "recipe_overrides", recipeId));
            if (overrideSnap.exists()) {
                renderRecipeHTML({ ...baseRecipe, ...overrideSnap.data(), isPersonalized: true });
            }
        } catch (e) { console.log("No personalization to apply."); }
    });
}

// Edited in place on the page itself (swap the rendered ingredient/instruction
// lists for textareas right where they are), not a popup modal — the modal
// was cramped on phones.
let editModeActive = false;

const PERSONALIZE_BTN_HTML = `<button onclick="toggleEditMode()" class="pill-btn btn-slate js-personalize-btn">✏️ Personalize This Recipe</button>`;

function setPersonalizeSlotHtml(html) {
    const slot = document.getElementById('personalize-slot');
    if (slot) slot.innerHTML = html;
}

window.toggleEditMode = function() {
    if (!originalRecipeData) return alert("Recipe hasn't finished loading yet — try again in a moment.");
    if (!auth.currentUser) return alert("Please log in to personalize recipes.");

    console.log(`✏️ [PERSONALIZE] ${editModeActive ? 'Exiting' : 'Entering'} edit mode.`);
    if (editModeActive) {
        exitEditMode();
    } else {
        enterEditMode();
    }
};

// ==========================================
// EDIT MODE — a per-line, per-part editor that mirrors the published layout.
//
// This replaced a pair of raw textareas holding the whole recipe. Those were
// confusing (you edited a wall of text that looked nothing like the recipe)
// and made multi-part recipes effectively uneditable, since parts were just
// "## Crust" lines buried in the middle of the text.
//
// Now each ingredient and step is its own input, grouped under its part, so
// editing looks like the recipe you're reading. `editDraft` is the working
// copy; nothing is written until Save.
// ==========================================
let editDraft = null;

function enterEditMode() {
    editModeActive = true;
    const current = lastRenderedRecipe || originalRecipeData;

    // Deep-copy into a draft so Cancel is a genuine discard
    editDraft = {
        ingredientSections: getSections(current, 'ingredients').map(s => ({ title: s.title, items: [...(s.items || [])] })),
        instructionSections: getSections(current, 'instructions').map(s => ({ title: s.title, items: [...(s.items || [])] })),
        notes: current.notes || ''
    };
    if (editDraft.ingredientSections.length === 0) editDraft.ingredientSections = [{ title: '', items: [''] }];
    if (editDraft.instructionSections.length === 0) editDraft.instructionSections = [{ title: '', items: [''] }];

    renderEditor();
    showEditModeBar(current.isPersonalized);
    document.getElementById('ingredient-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Rebuilds both editors from editDraft. Called after every structural change
// (add/remove a line or a part) so the DOM always matches the draft.
function renderEditor() {
    const ingList = document.getElementById('ingredient-list');
    if (ingList) {
        ingList.className = ''; // drop the substitution-hiding class while editing
        ingList.innerHTML = editDraft.ingredientSections.map((section, si) => `
            <li class="edit-section-block">
                ${editDraft.ingredientSections.length > 1 || section.title ? `
                    <div class="edit-section-head">
                        <input class="edit-part-name" type="text" placeholder="Part name (e.g. Crust)"
                               value="${escapeAttrJs(section.title)}"
                               oninput="updateDraft('ingredients', ${si}, null, this.value)">
                        <button class="edit-mini-btn edit-mini-danger" title="Remove this part"
                                onclick="removePart('ingredients', ${si})">✕</button>
                    </div>` : ''}

                ${section.items.map((item, ii) => `
                    <div class="edit-row">
                        <input type="text" value="${escapeAttrJs(item)}" placeholder="e.g. 2 cups flour"
                               oninput="updateDraft('ingredients', ${si}, ${ii}, this.value)">
                        <button class="edit-mini-btn edit-mini-danger" title="Delete"
                                onclick="removeLine('ingredients', ${si}, ${ii})">✕</button>
                    </div>`).join('')}

                <div class="edit-row-actions">
                    <button class="edit-mini-btn" onclick="addLine('ingredients', ${si})">＋ Ingredient</button>
                </div>
            </li>`).join('') + `
            <li class="edit-section-block edit-add-part">
                <button class="edit-mini-btn" onclick="addPart('ingredients')">＋ Add a part (Crust, Filling…)</button>
            </li>`;
    }

    const instContainer = document.getElementById('instructions-container');
    if (instContainer) {
        instContainer.className = '';
        instContainer.innerHTML = editDraft.instructionSections.map((section, si) => `
            <div class="edit-section-block">
                ${editDraft.instructionSections.length > 1 || section.title ? `
                    <div class="edit-section-head">
                        <input class="edit-part-name" type="text" placeholder="Part name (e.g. Filling)"
                               value="${escapeAttrJs(section.title)}"
                               oninput="updateDraft('instructions', ${si}, null, this.value)">
                        <button class="edit-mini-btn edit-mini-danger" title="Remove this part"
                                onclick="removePart('instructions', ${si})">✕</button>
                    </div>` : ''}

                ${section.items.map((item, ii) => `
                    <div class="edit-row edit-row-step">
                        <span class="edit-step-num">${ii + 1}</span>
                        <textarea rows="2" placeholder="Describe this step…"
                                  oninput="updateDraft('instructions', ${si}, ${ii}, this.value)">${escapeAttrJs(item)}</textarea>
                        <button class="edit-mini-btn edit-mini-danger" title="Delete"
                                onclick="removeLine('instructions', ${si}, ${ii})">✕</button>
                    </div>`).join('')}

                <div class="edit-row-actions">
                    <button class="edit-mini-btn" onclick="addLine('instructions', ${si})">＋ Step</button>
                </div>
            </div>`).join('') + `
            <div class="edit-section-block edit-add-part">
                <button class="edit-mini-btn" onclick="addPart('instructions')">＋ Add a part</button>
            </div>

            <label style="display:block; font-weight:bold; margin-top:20px; margin-bottom:5px;">Notes</label>
            <textarea id="edit-notes-inline" class="form-input" rows="2"
                      oninput="updateDraftNotes(this.value)">${escapeAttrJs(editDraft.notes)}</textarea>`;
    }
}

// Escapes a value for use inside an HTML attribute or textarea body.
function escapeAttrJs(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const draftKey = (kind) => kind === 'instructions' ? 'instructionSections' : 'ingredientSections';

// itemIndex === null means we're editing the part's title.
// Note this deliberately does NOT re-render — that would blur the input and
// lose the caret on every keystroke.
window.updateDraft = function(kind, sectionIndex, itemIndex, value) {
    const section = editDraft[draftKey(kind)][sectionIndex];
    if (!section) return;
    if (itemIndex === null) section.title = value;
    else section.items[itemIndex] = value;
};

window.updateDraftNotes = function(value) { editDraft.notes = value; };

window.addLine = function(kind, sectionIndex) {
    editDraft[draftKey(kind)][sectionIndex].items.push('');
    renderEditor();
    // Focus the newly added field
    const blocks = document.querySelectorAll(`#${kind === 'instructions' ? 'instructions-container' : 'ingredient-list'} .edit-section-block`);
    const inputs = blocks[sectionIndex]?.querySelectorAll('input[type="text"], textarea');
    inputs?.[inputs.length - 1]?.focus();
};

window.removeLine = function(kind, sectionIndex, itemIndex) {
    const sections = editDraft[draftKey(kind)];
    sections[sectionIndex].items.splice(itemIndex, 1);
    // Never leave a part with nothing in it at all
    if (sections[sectionIndex].items.length === 0 && sections.length > 1) sections.splice(sectionIndex, 1);
    else if (sections[sectionIndex].items.length === 0) sections[sectionIndex].items.push('');
    renderEditor();
};

window.addPart = function(kind) {
    editDraft[draftKey(kind)].push({ title: '', items: [''] });
    renderEditor();
};

window.removePart = function(kind, sectionIndex) {
    const sections = editDraft[draftKey(kind)];
    if (sections.length <= 1) {
        // Last part: keep the lines, just drop the heading
        sections[0].title = '';
    } else {
        if (!confirm("Remove this whole part and everything in it?")) return;
        sections.splice(sectionIndex, 1);
    }
    renderEditor();
};

// Sticky bottom action bar. The Kitchen Tools buttons live far below the
// ingredient/instruction boxes, so on a phone "Save" was a scroll hunt once
// you'd typed anything — this keeps it pinned in view the whole time you're
// editing.
function showEditModeBar(isPersonalized) {
    if (document.getElementById('edit-mode-bar')) return;

    if (!document.getElementById('edit-mode-bar-style')) {
        const style = document.createElement('style');
        style.id = 'edit-mode-bar-style';
        style.innerHTML = `
            #edit-mode-bar {
                position: fixed; bottom: 0; left: 0; right: 0; z-index: 1500;
                background: var(--bg-card); border-top: 2px solid var(--accent-teal);
                box-shadow: 0 -4px 14px rgba(0,0,0,0.18);
                padding: 12px 14px calc(12px + env(safe-area-inset-bottom, 0px)) 14px;
                display: flex; gap: 10px; align-items: center; justify-content: center;
                flex-wrap: wrap;
            }
            #edit-mode-bar .edit-mode-hint {
                width: 100%; text-align: center; font-size: 11px;
                color: #94a3b8; margin: 0 0 2px 0;
            }
            #edit-mode-bar .pill-btn { flex: 1; justify-content: center; min-width: 120px; }
            /* The floating tools button would sit on top of this bar */
            body.edit-mode-active #mobile-tool-fab { display: none !important; }
            body.edit-mode-active { padding-bottom: 120px !important; }
        `;
        document.head.appendChild(style);
    }

    const bar = document.createElement('div');
    bar.id = 'edit-mode-bar';
    bar.className = 'no-print';
    bar.innerHTML = `
        <p class="edit-mode-hint">✏️ Editing your own copy — only you will see these changes.</p>
        <button onclick="saveInlinePersonalization()" class="pill-btn btn-teal">💾 Save</button>
        <button onclick="toggleEditMode()" class="pill-btn btn-slate">✖️ Cancel</button>
        ${isPersonalized ? `<button onclick="revertPersonalization()" class="pill-btn btn-slate">↩️ Revert</button>` : ''}
    `;
    document.body.appendChild(bar);
    document.body.classList.add('edit-mode-active');
}

function hideEditModeBar() {
    document.getElementById('edit-mode-bar')?.remove();
    document.body.classList.remove('edit-mode-active');
}

function exitEditMode() {
    editModeActive = false;
    hideEditModeBar();
    setPersonalizeSlotHtml(PERSONALIZE_BTN_HTML);
    renderRecipeHTML(lastRenderedRecipe || originalRecipeData);
}

// Turns the working draft into the fields Firestore stores, dropping blank
// lines and untitled empty parts left behind while editing.
function draftToRecipeFields() {
    const clean = (sections) => sections
        .map(s => ({ title: (s.title || '').trim(), items: s.items.map(i => i.trim()).filter(Boolean) }))
        .filter(s => s.items.length > 0);

    const ingSections = clean(editDraft.ingredientSections);
    const instSections = clean(editDraft.instructionSections);

    const flatten = (sections) => sections.reduce((all, s) => all.concat(s.items), []);
    // Only persist section structure when it's real — a single untitled
    // group is just an ordinary recipe.
    const structured = (sections) => (sections.length > 1 || sections[0]?.title) ? sections : [];

    return {
        ingredients: flatten(ingSections),
        recipeIngredient: flatten(ingSections),
        ingredientSections: structured(ingSections),
        instructions: flatten(instSections),
        recipeInstructions: flatten(instSections),
        instructionSections: structured(instSections),
        notes: (editDraft.notes || '').trim()
    };
}

// Asks what the edit is FOR: just for them, or a fix everyone should get.
window.saveInlinePersonalization = function() {
    if (!auth.currentUser) return alert("Please log in.");
    const modal = document.getElementById('save-choice-modal');
    if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
};

window.closeSaveChoiceModal = function() {
    const modal = document.getElementById('save-choice-modal');
    if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
};

// "Just for me" — the original private override behaviour.
window.saveAsPersonal = async function() {
    const user = auth.currentUser;
    if (!user) return alert("Please log in.");
    closeSaveChoiceModal();

    const fields = draftToRecipeFields();

    try {
        await setDoc(doc(db, "users", user.uid, "recipe_overrides", recipeId), {
            ...fields,
            updatedAt: serverTimestamp()
        });

        console.log("✅ [PERSONALIZE] Saved personal version for recipe:", recipeId);
        editModeActive = false;
        hideEditModeBar();
        setPersonalizeSlotHtml(PERSONALIZE_BTN_HTML);
        renderRecipeHTML({ ...originalRecipeData, ...fields, isPersonalized: true });
    } catch (e) {
        console.error("🔥 [PERSONALIZE] Save failed:", e);
        alert("Could not save your changes: " + e.message);
    }
};

// "Suggest for everyone" — files the proposed version for admin approval.
// It also saves privately, so the person immediately sees their own version
// while the suggestion is pending rather than watching their edit vanish.
window.saveAsSuggestion = async function() {
    const user = auth.currentUser;
    if (!user) return alert("Please log in.");

    const reason = document.getElementById('suggestion-reason')?.value.trim() || "";
    closeSaveChoiceModal();

    const fields = draftToRecipeFields();

    try {
        let suggesterName = user.email ? user.email.split('@')[0] : "Family Member";
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists() && userDoc.data().Name) suggesterName = userDoc.data().Name;
        } catch (e) { /* fall back to the email-derived name */ }

        await addDoc(collection(db, "recipe_suggestions"), {
            recipeId,
            recipeName: (originalRecipeData && (originalRecipeData.name || originalRecipeData.n)) || "Unknown",
            proposed: fields,
            reason,
            suggestedBy: suggesterName,
            uid: user.uid,
            status: "pending",
            createdAt: serverTimestamp()
        });

        // Keep it applied for them in the meantime
        await setDoc(doc(db, "users", user.uid, "recipe_overrides", recipeId), {
            ...fields, updatedAt: serverTimestamp()
        });

        console.log("📬 [SUGGESTION] Sent for admin review:", recipeId);
        editModeActive = false;
        hideEditModeBar();
        setPersonalizeSlotHtml(PERSONALIZE_BTN_HTML);
        renderRecipeHTML({ ...originalRecipeData, ...fields, isPersonalized: true });
        alert("Thanks! Your suggested fix was sent to the Chef.\n\nIn the meantime it's saved as your own version, so you'll keep seeing it.");
    } catch (e) {
        console.error("🔥 [SUGGESTION] Failed:", e);
        alert("Could not send that suggestion: " + e.message);
    }
};

window.revertPersonalization = async function() {
    const user = auth.currentUser;
    if (!user || !originalRecipeData) return;
    if (!confirm("Remove your personalized version and go back to the original recipe?")) return;

    try {
        await deleteDoc(doc(db, "users", user.uid, "recipe_overrides", recipeId));
        console.log("↩️ [PERSONALIZE] Reverted to the original recipe.");
        editModeActive = false;
        hideEditModeBar();
        setPersonalizeSlotHtml(PERSONALIZE_BTN_HTML);
        renderRecipeHTML(originalRecipeData);
    } catch (e) {
        console.error("🔥 [PERSONALIZE] Revert failed:", e);
        alert("Could not revert: " + e.message);
    }
};

async function logViewToDatabase(recipeData) {
    if (isTestModeOn()) {
        console.log("🧪 [TEST MODE] Skipped logging this view.");
        return;
    }

    const sessionKey = `viewed-${recipeData.id}`;
    if (sessionStorage.getItem(sessionKey)) return;

    try {
        const user = auth.currentUser;
        let viewerName = "Guest";

        if (user) {
            viewerName = user.email ? user.email.split('@')[0] : "Family Member";
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists() && userDoc.data().Name) {
                    viewerName = userDoc.data().Name; 
                }
            } catch (err) { console.log("Could not fetch profile name"); }
        }

        await addDoc(collection(db, "recipe_views"), {
            recipeId: recipeData.id,
            recipeTitle: recipeData.name || recipeData.n,
            timestamp: serverTimestamp(),
            viewer: viewerName,
            uid: user ? user.uid : null // lets the admin Activity roster group views per person reliably
        });

        console.log(`👀 [VIEW LOG] Logged view of "${recipeData.name || recipeData.n}" by ${viewerName}.`);
        sessionStorage.setItem(sessionKey, "true");
    } catch (e) { console.error("🔥 [VIEW LOG] Could not log view:", e); }
}

let currentScaleFactor = 1;
let currentElevationBand = localStorage.getItem('altitudeElevationBand') || null;
let lastRenderedRecipe = null;

window.setRecipeScale = function(factor) {
    if (editModeActive) return alert("Finish or cancel your edits first.");
    currentScaleFactor = factor;
    if (lastRenderedRecipe) renderRecipeHTML(lastRenderedRecipe);
};

window.setAltitudeBand = function(band) {
    if (editModeActive) return alert("Finish or cancel your edits first.");
    currentElevationBand = band;
    localStorage.setItem('altitudeElevationBand', band || '');
    if (lastRenderedRecipe) renderRecipeHTML(lastRenderedRecipe);
};

function renderRecipeHTML(recipe) {
    const recipeContainer = document.getElementById("recipe");
    if (!recipeContainer) return;

    lastRenderedRecipe = recipe;

    // 1. Automatically save this recipe's full content to localStorage so
    // it's readable offline the next time (only if it's the real, complete
    // recipe — not a partial/merge object built for a one-off render).
    const currentId = recipe.id || recipeId;
    if (currentId && (recipe.ingredients || recipe.recipeIngredient)) {
        saveRecipeOffline({ id: currentId, ...recipe });
    }

    // 2. Check recipe statuses
    const isReviewed = recipe.r === true || recipe.reviewed === true;
    const isHidden = recipe.h === true || recipe.isHidden === true;
    const recTags = Array.isArray(recipe.t || recipe.tags) ? (recipe.t || recipe.tags) : [String(recipe.t || recipe.tags || "")];
    
    // 3. Build Status Pills
    let statusBarHtml = `<div class="recipe-status-bar" style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin: 12px 0 16px 0;">`;

    statusBarHtml += `<span class="no-print" title="Cached on this device — this recipe will still open with no signal" style="background: #fef08a; border: 1px solid #eab308; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; color: #854d0e;">⛺ Available Offline</span>`;

    if (isReviewed) {
        statusBarHtml += `<span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #10b981;">✅ Verified & Reviewed Recipe</span>`;
    } else {
        statusBarHtml += `<span style="background: #fef2f2; color: #991b1b; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #f87171;">⚠️ Unreviewed (Needs Verification)</span>`;
    }

    if (isHidden) {
        statusBarHtml += `<span style="background: #e2e8f0; color: #475569; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #94a3b8;">👁️ Hidden</span>`;
    }

    if (recTags.includes("Egbert Favorite")) {
        statusBarHtml += `<span style="background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #38bdf8;">⭐ Egbert Family Favorite</span>`;
    }
    if (recTags.includes("Wheeler Favorite")) {
        statusBarHtml += `<span style="background: #dcfce7; color: #15803d; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #4ade80;">⭐ Wheeler Family Favorite</span>`;
    }

    const family = getRecipeFamily(recipe);
    if (family !== 'Both') {
        statusBarHtml += `<span style="background: #f5f3ff; color: #5b21b6; padding: 4px 12px; border-radius: 16px; font-size: 0.85rem; font-weight: bold; border: 1px solid #c4b5fd;">👨‍👩‍👧 ${family} Family Recipe</span>`;
    }

    getDietaryTags(recipe).forEach(tag => {
        statusBarHtml += `<span class="diet-pill" style="padding: 4px 12px; border-radius: 16px; font-size: 0.85rem;">${tag}</span>`;
    });

    statusBarHtml += `</div>`;

    const driveUrl = recipe.driveUrl || recipe.autoDriveUrl;
    const sourceUrl = recipe.sourceUrl;
    const driveLinkHtml = (driveUrl || sourceUrl)
        ? `<div style="text-align:center; margin-bottom:16px; display:flex; justify-content:center; gap:10px; flex-wrap:wrap;" class="no-print">
             ${driveUrl ? `<a href="${driveUrl}" target="_blank" rel="noopener" class="pill-btn btn-blue" style="text-decoration:none;">📄 View PDF / Google Drive Copy</a>` : ""}
             ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noopener" class="pill-btn btn-slate" style="text-decoration:none;">🔗 View Original Recipe</a>` : ""}
           </div>`
        : "";

    const rawIng = recipe.ingredients || recipe.recipeIngredient;
    const rawInst = recipe.instructions || recipe.recipeInstructions;
    const author = recipe.author || recipe.a || "Family";

    // Scale ingredient quantities (0.5x/1x/2x/3x), then apply high-altitude
    // adjustments on top — everything downstream (the list itself, and the
    // per-step ingredient chips) uses this scaled+adjusted version.
    const scaledIng = Array.isArray(rawIng)
        ? rawIng.map(line => applyAltitudeAdjustment(scaleIngredientLine(line, currentScaleFactor), currentElevationBand))
        : rawIng;

    // Applies scaling + altitude, keeping the untouched original alongside so
    // the conversion can be checked at a glance rather than taken on trust.
    // prettyFractions runs last so it catches both the typed-in fractions
    // and the ASCII ones the scaler produces ("1 1/2" → "1½").
    const adjustLine = (line) => ({
        text: prettyFractions(applyAltitudeAdjustment(scaleIngredientLine(line, currentScaleFactor), currentElevationBand)),
        original: prettyFractions(line)
    });

    const isAdjusted = currentScaleFactor !== 1 || Boolean(currentElevationBand);

    // Renders one ingredient line. `entry` is { text, original }.
    const ingredientLineHtml = (entry) => {
        const sub = findSubstitution(entry.text);
        const subHtml = sub ? `<div class="sub-hint no-print">🔄 No ${sub.key}? Try: ${sub.sub}</div>` : '';

        // Only show the "was" when the line actually changed — plenty of
        // lines ("Pinch of salt") have no number to scale.
        const changed = isAdjusted && entry.text !== entry.original;
        const originalHtml = changed
            ? `<span class="original-amount" title="Original, unscaled amount">was ${escapeAttrJs(entry.original)}</span>`
            : '';

        return `<li>${entry.text}${originalHtml}${subHtml}</li>`;
    };

    // Multi-part recipes (crust / filling / topping) render each group under
    // its own heading. Everything else falls back to a single flat list.
    const ingSections = getSections(recipe, 'ingredients').map(s => ({
        title: s.title,
        items: (s.items || []).map(adjustLine)
    }));
    const ingredientsAreSectioned = hasRealSections(ingSections);

    let ingHtml = "";
    if (ingredientsAreSectioned) {
        ingHtml = ingSections.map(s => `
            ${s.title ? `<li class="recipe-subsection">${s.title}</li>` : ''}
            ${s.items.map(ingredientLineHtml).join('')}
        `).join('');
    } else if (Array.isArray(rawIng)) {
        ingHtml = rawIng.map(adjustLine).map(ingredientLineHtml).join("");
    } else if (typeof scaledIng === 'string') {
        ingHtml = `<pre>${prettyFractions(scaledIng)}</pre>`;
    }

    const hasIngredients = Array.isArray(rawIng) && rawIng.length > 0;

    // Scale/altitude are page-level *tools*, not recipe content — they live
    // in the Kitchen Tools section (populated further down), not inline here.
    const scaleSlotHtml = hasIngredients ? `
        <span style="font-size:0.8rem; color:#94a3b8;">Scale recipe:</span>
        ${[0.5, 1, 2, 3].map(f => `
            <button class="pill-btn btn-slate scale-btn${currentScaleFactor === f ? ' scale-active' : ''}" onclick="setRecipeScale(${f})">${f}x</button>
        `).join('')}` : "";

    const altitudeSlotHtml = hasIngredients ? `
        <span style="font-size:0.8rem; color:#94a3b8;">High altitude:</span>
        <button class="pill-btn btn-slate scale-btn${!currentElevationBand ? ' scale-active' : ''}" onclick="setAltitudeBand(null)">Off</button>
        <button class="pill-btn btn-slate scale-btn${currentElevationBand === '3000' ? ' scale-active' : ''}" onclick="setAltitudeBand('3000')">3-5k ft</button>
        <button class="pill-btn btn-slate scale-btn${currentElevationBand === '5000' ? ' scale-active' : ''}" onclick="setAltitudeBand('5000')">5-7k ft</button>
        <button class="pill-btn btn-slate scale-btn${currentElevationBand === '7000' ? ' scale-active' : ''}" onclick="setAltitudeBand('7000')">7k+ ft</button>` : "";

    // Makes it obvious the amounts on screen aren't the ones as written,
    // and offers a one-tap way back to the original.
    const scaleBannerHtml = (hasIngredients && currentScaleFactor !== 1) ? `
        <div class="scale-active-banner no-print">
            ⚖️ Showing <strong>${currentScaleFactor}×</strong> the original recipe — the amount as written is in grey beside each line.
            <button onclick="setRecipeScale(1)" class="pill-btn btn-slate" style="padding:3px 10px; font-size:0.7rem; margin-left:8px;">Reset to 1×</button>
        </div>` : "";

    // The advisory banner stays with the ingredient list since it explains
    // the 🏔️ marks that show up right there.
    const altitudeBannerHtml = (hasIngredients && currentElevationBand) ? `
        <div class="no-print" style="background:#fff7ed; border:1px solid #fdba74; color:#9a3412; padding:10px 14px; border-radius:8px; margin: 10px 0; font-size:0.8rem; text-align:center;">
            🏔️ Estimated adjustments for ${ALTITUDE_LABELS[currentElevationBand]} (marked 🏔️ below). Also try: oven +15-25°F, and check doneness a few minutes early — every recipe reacts differently at altitude.
        </div>` : "";

    const ingredientsArr = Array.isArray(scaledIng) ? scaledIng : [];
    const showStepIngredients = localStorage.getItem('showStepIngredients') === 'true';
    const showSubstitutions = localStorage.getItem('showSubstitutions') === 'true';

    const stepHtml = (s) => {
        // Match against the raw step (keyword matching is unaffected by
        // fraction glyphs), but display the prettified version.
        const matched = matchIngredientsForStep(s, ingredientsArr);
        return `<li class="instruction-step">${prettyFractions(s)}${stepIngredientsHtml(matched)}</li>`;
    };

    const instSections = getSections(recipe, 'instructions');
    let instHtml = "";
    if (hasRealSections(instSections)) {
        // A separate <ol> per group so each part's steps number from 1 again
        instHtml = instSections.map(s => `
            ${s.title ? `<h4 class="recipe-subsection-header">${s.title}</h4>` : ''}
            <ol>${(s.items || []).map(stepHtml).join('')}</ol>
        `).join('');
    } else if (Array.isArray(rawInst)) {
        instHtml = `<ol id="normal-instructions">${rawInst.map(stepHtml).join("")}</ol>`;
    } else if (typeof rawInst === 'string') {
        instHtml = `<p style="white-space: pre-wrap;">${prettyFractions(rawInst)}</p>`;
    }

    let notesHtml = "";
    if (recipe.notes && String(recipe.notes).trim()) {
        notesHtml = `
        <h3 class="section-header">📝 Recipe Notes</h3>
        <p style="white-space: pre-wrap;">${prettyFractions(recipe.notes)}</p>`;
    }

    const personalizedBadgeHtml = recipe.isPersonalized
        ? `<div style="text-align:center; margin-bottom:16px;" class="no-print">
             <button onclick="revertPersonalization()" class="pill-btn" style="background:#ede9fe; color:#5b21b6; border:1px solid #c4b5fd;" title="Click to revert to the original recipe">
                📝 Personalized by you (tap to revert)
             </button>
           </div>`
        : "";

    // 4. Inject into DOM: Notice statusBarHtml is right under From: ${author}
    recipeContainer.innerHTML = `
        <h1 class="recipe-title-lg">${recipe.name || recipe.n}</h1>
        <h2 class="recipe-chef" style="margin-bottom: 4px;">From: ${author}</h2>

        ${statusBarHtml}
        ${driveLinkHtml}
        ${personalizedBadgeHtml}

        <hr class="recipe-divider">
        <h3 class="section-header">Ingredients</h3>
        <p class="no-print" style="font-size:12px; color:#94a3b8; font-style:italic;">(Tap to cross out)</p>
        ${scaleBannerHtml}
        ${altitudeBannerHtml}
        <ul id="ingredient-list" class="${showSubstitutions ? '' : 'hide-substitutions'}">${ingHtml}</ul>

        <h3 class="section-header">Instructions</h3>
        <div id="instructions-container" class="${showStepIngredients ? '' : 'hide-step-ingredients'}">${instHtml}</div>
        ${notesHtml}
    `;

    setTimeout(() => {
        document.querySelectorAll('#ingredient-list li, .instruction-step').forEach(li => {
            li.addEventListener('click', function() { this.classList.toggle('checked'); });
        });
    }, 100);

    localStorage.setItem('lastRecipeSingle', JSON.stringify({ name: (recipe.name || recipe.n), id: currentId }));

    // Populate the Kitchen Tools slots (scale/altitude controls + the ingredients-in-steps toggle state)
    const scaleSlot = document.getElementById('kt-scale-slot');
    if (scaleSlot) scaleSlot.innerHTML = scaleSlotHtml;
    const altitudeSlot = document.getElementById('kt-altitude-slot');
    if (altitudeSlot) altitudeSlot.innerHTML = altitudeSlotHtml;
    toggleInlineIngredients(showStepIngredients);
    toggleSubstitutions(showSubstitutions);

    // Trigger Mobile Tools layout setup
    setupMobileKitchenTools();

    // The mobile tools sheet is built from CLONES of the inline buttons,
    // taken at the moment it opens. So tapping "2x" in the sheet updated the
    // real (hidden) button but left the clone showing the old highlight —
    // you had to close the sheet and reopen it to see which option was
    // actually selected. Re-clone in place if it's open, keeping the scroll
    // position so the sheet doesn't jump under your finger.
    refreshMobileToolsIfOpen();
}

function refreshMobileToolsIfOpen() {
    const modal = document.getElementById('mobile-tools-modal');
    if (!modal || modal.style.display !== 'flex') return;

    const content = document.getElementById('mobile-tools-content');
    const scrollTop = content ? content.scrollTop : 0;

    openMobileToolsModal();

    const refreshed = document.getElementById('mobile-tools-content');
    if (refreshed) refreshed.scrollTop = scrollTop;
}

// ==========================================
// 2. KITCHEN TOOLS & MEAL PLANNER
// ==========================================

// --- STAY AWAKE (screen wake lock only, no fullscreen) ---
let wakeLock = null;
window.toggleStayAwake = async function() {
    const btns = document.querySelectorAll('.js-stay-awake-btn');
    if (!wakeLock) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            btns.forEach(b => { b.innerText = "🔆 Stay Awake: ON"; b.classList.add('cook-mode-active'); });
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
                document.querySelectorAll('.js-stay-awake-btn').forEach(b => { b.innerText = "🔆 Stay Awake"; b.classList.remove('cook-mode-active'); });
            });
        } catch (err) { alert("Screen Wake Lock isn't supported on this browser."); }
    } else {
        wakeLock.release();
        wakeLock = null;
        btns.forEach(b => { b.innerText = "🔆 Stay Awake"; b.classList.remove('cook-mode-active'); });
    }
}

// --- SHARED: Inline "show ingredients with steps" toggle (normal view + Cook Mode) ---
window.toggleInlineIngredients = function(forceState) {
    const state = typeof forceState === 'boolean' ? forceState : !(localStorage.getItem('showStepIngredients') === 'true');
    localStorage.setItem('showStepIngredients', state);

    document.querySelectorAll('.js-ing-toggle-btn').forEach(b => {
        b.innerText = `🧪 Ingredients in Steps: ${state ? 'ON' : 'OFF'} (Beta)`;
        b.classList.toggle('cook-mode-active', state);
    });

    const cookToggle = document.getElementById('cook-ing-toggle');
    if (cookToggle) cookToggle.checked = state;

    const instContainer = document.getElementById('instructions-container');
    if (instContainer) instContainer.classList.toggle('hide-step-ingredients', !state);

    const cookIngBox = document.getElementById('cook-mode-step-ing');
    if (cookIngBox) cookIngBox.style.display = state ? 'flex' : 'none';
};

// --- Ingredient substitution hints on/off toggle (off by default — some
// people find the "No buttermilk? Try:" lines under every other ingredient
// noisy when they're not looking for a swap) ---
window.toggleSubstitutions = function(forceState) {
    const state = typeof forceState === 'boolean' ? forceState : !(localStorage.getItem('showSubstitutions') === 'true');
    localStorage.setItem('showSubstitutions', state);

    document.querySelectorAll('.js-sub-toggle-btn').forEach(b => {
        b.innerText = `🔄 Substitution Hints: ${state ? 'ON' : 'OFF'}`;
        b.classList.toggle('cook-mode-active', state);
    });

    const ingList = document.getElementById('ingredient-list');
    if (ingList) ingList.classList.toggle('hide-substitutions', !state);
};

// ==========================================
// FULLSCREEN SWIPEABLE COOK MODE
// ==========================================
let cookModeSteps = [];
let cookModeStepSections = []; // which part ("Crust") each step belongs to, index-aligned
let cookModeIngredients = [];
let cookModeIndex = 0;
let cookModeWakeLock = null;

window.startCookMode = function() {
    const current = JSON.parse(localStorage.getItem("currentRecipeData")) || {};

    const rawInst = current.instructions || current.recipeInstructions;

    // Flatten a multi-part recipe into one continuous run of steps, but
    // remember which part each step came from so cook mode can show
    // "Crust · Step 2 of 4" rather than losing that context entirely.
    const instSections = getSections(current, 'instructions');
    if (hasRealSections(instSections)) {
        cookModeSteps = [];
        cookModeStepSections = [];
        instSections.forEach(section => {
            (section.items || []).forEach(step => {
                cookModeSteps.push(step);
                cookModeStepSections.push(section.title || '');
            });
        });
    } else {
        cookModeSteps = Array.isArray(rawInst) ? rawInst : (typeof rawInst === 'string' ? rawInst.split('\n').filter(Boolean) : []);
        cookModeStepSections = cookModeSteps.map(() => '');
    }

    cookModeIngredients = flattenSections(getSections(current, 'ingredients'))
        .map(line => prettyFractions(applyAltitudeAdjustment(scaleIngredientLine(line, currentScaleFactor), currentElevationBand)));

    if (cookModeSteps.length === 0) return alert("No instructions found for this recipe yet.");

    console.log(`👨‍🍳 [COOK MODE] Starting with ${cookModeSteps.length} step(s).`);
    cookModeIndex = 0;
    buildCookModeOverlay(current.name || current.n || "Recipe");
    renderCookModeStep();

    const overlay = document.getElementById('cook-mode-overlay');
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (navigator.wakeLock && !cookModeWakeLock) {
        navigator.wakeLock.request('screen').then(lock => { cookModeWakeLock = lock; }).catch(() => {});
    }
};

window.exitCookMode = function() {
    console.log("👨‍🍳 [COOK MODE] Exiting.");
    const overlay = document.getElementById('cook-mode-overlay');
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = '';

    if (cookModeWakeLock) {
        cookModeWakeLock.release();
        cookModeWakeLock = null;
    }

    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
};

window.toggleReadAloud = function() {
    const state = !(localStorage.getItem('cookModeReadAloud') === 'true');
    localStorage.setItem('cookModeReadAloud', state);

    const btn = document.getElementById('cook-read-toggle');
    if (btn) {
        btn.innerText = `🔊 Read Aloud: ${state ? 'ON' : 'OFF'}`;
        btn.classList.toggle('cook-mode-active', state);
    }

    if (state) {
        renderCookModeStep(); // speak the current step immediately
    } else if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
};

window.cookModeStep = function(direction) {
    const newIndex = cookModeIndex + direction;
    if (newIndex < 0 || newIndex >= cookModeSteps.length) return;
    cookModeIndex = newIndex;
    renderCookModeStep();
};

function buildCookModeOverlay(title) {
    if (document.getElementById('cook-mode-overlay')) return;

    const showIng = localStorage.getItem('showStepIngredients') === 'true';
    const readAloudOn = localStorage.getItem('cookModeReadAloud') === 'true';

    const overlay = document.createElement('div');
    overlay.id = 'cook-mode-overlay';
    overlay.innerHTML = `
        <div class="cook-mode-header">
            <button class="cook-mode-close" onclick="exitCookMode()">✕</button>
            <div class="cook-mode-title">${title}</div>
            <label class="toggle-wrapper cook-mode-ing-toggle">
                <div class="switch">
                    <input type="checkbox" id="cook-ing-toggle" ${showIng ? 'checked' : ''} onchange="toggleInlineIngredients(this.checked)">
                    <span class="slider"></span>
                </div>
                <span class="toggle-label-text">Ingredients</span>
            </label>
        </div>
        <div class="cook-mode-progress"><div class="cook-mode-progress-bar" id="cook-mode-progress-bar"></div></div>
        <div style="text-align:center; padding:8px 0 0 0;" class="no-print">
            <button id="cook-read-toggle" class="pill-btn btn-slate${readAloudOn ? ' cook-mode-active' : ''}" onclick="toggleReadAloud()" style="padding:5px 14px; font-size:0.75rem;">🔊 Read Aloud: ${readAloudOn ? 'ON' : 'OFF'}</button>
        </div>
        <div class="cook-mode-body" id="cook-mode-body">
            <div class="cook-mode-step-count" id="cook-mode-step-count"></div>
            <div class="cook-mode-step-text" id="cook-mode-step-text"></div>
            <div class="cook-mode-step-ing" id="cook-mode-step-ing" style="display:${showIng ? 'flex' : 'none'};"></div>
        </div>
        <div class="cook-mode-nav">
            <button class="cook-mode-nav-btn" id="cook-mode-prev" onclick="cookModeStep(-1)">◀ Prev</button>
            <button class="cook-mode-nav-btn" id="cook-mode-next" onclick="cookModeStep(1)">Next ▶</button>
        </div>
    `;
    document.body.appendChild(overlay);

    // Swipe gestures (left/right) to move between steps
    let touchStartX = 0;
    overlay.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    overlay.addEventListener('touchend', (e) => {
        const delta = e.changedTouches[0].screenX - touchStartX;
        if (Math.abs(delta) > 50) cookModeStep(delta < 0 ? 1 : -1);
    }, { passive: true });
}

function renderCookModeStep() {
    const stepText = cookModeSteps[cookModeIndex];

    // Prefix the part name on multi-part recipes ("Crust · Step 2 of 7")
    const sectionTitle = cookModeStepSections[cookModeIndex];
    document.getElementById('cook-mode-step-count').innerText =
        `${sectionTitle ? sectionTitle + ' · ' : ''}Step ${cookModeIndex + 1} of ${cookModeSteps.length}`;
    document.getElementById('cook-mode-step-text').innerText = prettyFractions(stepText);
    document.getElementById('cook-mode-progress-bar').style.width = `${((cookModeIndex + 1) / cookModeSteps.length) * 100}%`;

    const matched = matchIngredientsForStep(stepText, cookModeIngredients);
    const ingBox = document.getElementById('cook-mode-step-ing');
    ingBox.innerHTML = matched.length > 0
        ? matched.map(i => `<span class="ing-chip">🧂 ${i}</span>`).join('')
        : `<span class="ing-chip-empty">No specific ingredients tagged for this step</span>`;

    document.getElementById('cook-mode-prev').disabled = cookModeIndex === 0;
    document.getElementById('cook-mode-next').disabled = cookModeIndex === cookModeSteps.length - 1;

    if (localStorage.getItem('cookModeReadAloud') === 'true' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(stepText));
    }
}

// Text +/- controls the same persisted, site-wide font size as the Settings
// page slider (saved per-device via localStorage and per-account via
// Firebase), rather than a one-off local override just for this page.
const FONT_MIN_PX = 12;
const FONT_MAX_PX = 28;

window.resizeText = async function(change) {
    const settings = JSON.parse(localStorage.getItem('userSettings')) || {};
    let px = resolveFontSizePx(settings.fontSize);
    px = Math.min(FONT_MAX_PX, Math.max(FONT_MIN_PX, px + change));

    settings.fontSize = px;
    document.documentElement.style.setProperty('--base-size', px + 'px');
    localStorage.setItem('userSettings', JSON.stringify(settings));

    if (auth.currentUser) {
        try { await saveUserSettings(settings); } catch (e) { console.error("Could not save text size:", e); }
    }
}

// --- MEAL PLANNER LOGIC ---
window.addToMealPlan = function() {
    if (!auth.currentUser) return alert("Please sign in to save menus!");
    const modal = document.getElementById('plannerModal');
    if(modal) {
        modal.classList.remove('hidden'); 
        modal.style.display = 'flex';
    } else {
        alert("Error: Planner Modal not found in HTML");
    }
}

window.closePlannerModal = function() {
    const modal = document.getElementById('plannerModal');
    if(modal) modal.style.display = 'none';
}

window.confirmAddToPlan = async function() {
    const day = document.getElementById('daySelect').value;
    const typeSelect = document.getElementById('mealTypeSelect'); 
    const mealType = typeSelect ? typeSelect.value : "Dinner";

    const current = JSON.parse(localStorage.getItem("currentRecipeData"));
    if(!current) return alert("Error loading recipe data.");

    const user = auth.currentUser;
    if (!user) return alert("You must be logged in.");

    const btn = document.querySelector('#plannerModal button[onclick="confirmAddToPlan()"]');
    if(btn) btn.innerText = "Saving...";

    try {
        const mealData = {
            id: current.id,
            name: current.name || current.n,
            ingredients: current.ingredients || current.recipeIngredient || [],
            type: mealType,
            addedAt: Date.now() 
        };

        // Goes to the shared household plan when you're in one, otherwise
        // your own — getPlanPath() is the single place that decides.
        const { segments, householdId } = await getPlanPath(user.uid);
        const docRef = doc(db, ...segments, "weekly_plan", day);
        await setDoc(docRef, { meals: arrayUnion(mealData) }, { merge: true });

        console.log(`✅ [MENU] Added "${mealData.name}" to ${day} (${mealType})${householdId ? ' — shared with your household' : ''}.`);
        alert(`Success! Added to ${day} for ${mealType}.${householdId ? "\nEveryone in your household will see it." : ""}`);
        closePlannerModal();

    } catch (e) {
        console.error("🔥 [MENU] Menu Error:", e);
        alert("Could not save to menu.");
    } finally {
        if(btn) btn.innerText = "Save";
    }
}

// --- UNREVIEWED RECIPE WARNING ---
// Shown once per recipe per session, before the cooking prompt, so nobody
// starts following an unverified recipe without knowing. Also the easiest
// place to let someone flag that it's worth reviewing.
let unreviewedWarningShown = false;

function maybeShowUnreviewedWarning(recipe) {
    const isReviewed = recipe.r === true || recipe.reviewed === true;
    if (isReviewed || unreviewedWarningShown) return false;

    const dismissKey = `unreviewed-ack-${recipeId}`;
    if (sessionStorage.getItem(dismissKey)) return false;

    const modal = document.getElementById('unreviewed-modal');
    if (!modal) return false;

    unreviewedWarningShown = true;
    console.log("⚠️ [UNREVIEWED] Warning shown for an unverified recipe.");
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    return true;
}

window.dismissUnreviewedWarning = function() {
    const modal = document.getElementById('unreviewed-modal');
    if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
    sessionStorage.setItem(`unreviewed-ack-${recipeId}`, 'true');
    // Chain into the usual "viewing or cooking?" question
    maybeShowCookPrompt();
};

// Files the same kind of record the Report Issue button does, so it lands in
// the admin dashboard's Reported Issues list alongside everything else.
window.requestRecipeReview = async function() {
    const btn = document.querySelector('.js-request-review-btn');
    if (btn) { btn.disabled = true; btn.innerText = "Sending..."; }

    const current = lastRenderedRecipe || originalRecipeData || {};

    try {
        const user = auth.currentUser;
        let requesterName = "Guest";
        let requesterEmail = "No Email";

        if (user) {
            requesterEmail = user.email || "No Email";
            requesterName = requesterEmail.split('@')[0];
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists() && userDoc.data().Name) requesterName = userDoc.data().Name;
            } catch (e) { /* fall back to the email-derived name */ }
        }

        await addDoc(collection(db, "recipe_reports"), {
            recipeId: recipeId,
            recipeName: current.name || current.n || "Unknown",
            issue: "🙋 Review requested — someone wants this recipe verified.",
            type: "review_request",
            userName: requesterName,
            userEmail: requesterEmail,
            uid: user ? user.uid : "anonymous",
            createdAt: serverTimestamp()
        });

        console.log("🙋 [REVIEW REQUEST] Sent for recipe:", recipeId);
        alert("Thanks! The Chef has been asked to review this recipe.");
    } catch (e) {
        console.error("🔥 [REVIEW REQUEST] Failed:", e);
        alert("Couldn't send that request — check your connection.");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "🙋 Ask the Chef to review this"; }
        dismissUnreviewedWarning();
    }
};

// --- VIEWING OR COOKING? PROMPT ---
// Asked once per page load — if the answer is "cooking it now", automatically
// records it the same way the "🎉 I Made This!" button does, instead of
// making them remember to click it again after they're done.
let cookPromptShown = false;

function maybeShowCookPrompt() {
    if (cookPromptShown) return;
    cookPromptShown = true;

    const modal = document.getElementById('cook-prompt-modal');
    if (!modal) return;

    console.log("🍽️ [COOK PROMPT] Asking: viewing or cooking?");
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

window.answerCookPrompt = function(isCooking) {
    const modal = document.getElementById('cook-prompt-modal');
    if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }

    if (isCooking) {
        console.log("👨‍🍳 [COOK PROMPT] Cooking now — recording it automatically.");
        window.recordCook();
    } else {
        console.log("👀 [COOK PROMPT] Just looking.");
    }
};

// --- COOK COUNTER ---
function loadCookStats() {
    const count = parseInt(localStorage.getItem(`cook-${recipeId}`) || 0);
    const el = document.getElementById('cook-counter');
    if (!el) return;

    el.innerHTML = count > 0
        ? `You've cooked this <b>${count}</b> time${count === 1 ? '' : 's'}!
           <button onclick="undoCook()" class="no-print" style="background:none; border:none; color:#94a3b8; text-decoration:underline; cursor:pointer; font-size:0.8rem; margin-left:6px;">Undo</button>`
        : "You haven't cooked this yet.";
}

window.recordCook = async function() {
    if (isTestModeOn()) {
        console.log("🧪 [TEST MODE] Skipped recording this cook.");
        alert("Test Mode is on — this cook wasn't counted.");
        return;
    }

    let count = parseInt(localStorage.getItem(`cook-${recipeId}`) || 0);
    count++;
    localStorage.setItem(`cook-${recipeId}`, count);
    console.log(`🎉 [COOK] Recording cook #${count} for recipe:`, recipeId);
    loadCookStats();

    const btn = document.querySelector('.celebration-area button');
    if(btn) btn.innerText = "🎉 Yay!";

    try {
        const user = auth.currentUser;
        let chefName = "Guest";
        let uid = null;

        if (user) {
            uid = user.uid;
            chefName = user.displayName || (user.email ? user.email.split('@')[0] : "Family Member");
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists() && userDoc.data().Name) {
                    chefName = userDoc.data().Name;
                }
            } catch (err) { console.log("Could not fetch profile name for cook record"); }
        }

        const cookRef = await addDoc(collection(db, "global_cooks"), {
            recipeId: recipeId,
            timestamp: serverTimestamp(),
            uid: uid,
            chef: chefName
        });
        // Remember the last one so "Undo" can remove it from the leaderboard
        // too, not just the local counter.
        localStorage.setItem(`lastCookDoc-${recipeId}`, cookRef.id);
    } catch (e) { console.error("Could not record cook to DB:", e); }
}

// Mis-taps happen — this rolls back the most recent "I Made This" for this
// recipe, both the local counter and the leaderboard record behind it.
window.undoCook = async function() {
    let count = parseInt(localStorage.getItem(`cook-${recipeId}`) || 0);
    if (count <= 0) return;
    if (!confirm("Undo your most recent \"I Made This\" for this recipe?")) return;

    count--;
    if (count > 0) localStorage.setItem(`cook-${recipeId}`, count);
    else localStorage.removeItem(`cook-${recipeId}`);

    const lastDocId = localStorage.getItem(`lastCookDoc-${recipeId}`);
    if (lastDocId) {
        try {
            await deleteDoc(doc(db, "global_cooks", lastDocId));
            localStorage.removeItem(`lastCookDoc-${recipeId}`);
            console.log("↩️ [COOK] Removed the last cook record.");
        } catch (e) {
            console.warn("⚠️ [COOK] Local count undone, but the leaderboard record couldn't be removed:", e.message);
        }
    } else {
        console.log("↩️ [COOK] Local count undone (no leaderboard record saved for this one).");
    }

    loadCookStats();
    const btn = document.querySelector('.celebration-area button');
    if (btn) btn.innerText = "🎉 I Made This!";
};

// ==========================================
// 3. REPORTING LOGIC
// ==========================================
window.submitReport = async function(event) {
    if (event) {
        event.preventDefault(); 
    }

    const reason = document.getElementById('report-reason').value.trim();
    if(!reason) return alert("Please describe the issue.");
    
    const current = JSON.parse(localStorage.getItem("currentRecipeData"));
    
    const btn = document.querySelector('#report-modal button.btn-teal') || document.activeElement;
    const originalText = btn.innerText;
    btn.innerText = "Sending...";
    
    try {
        const user = auth.currentUser;
        let reporterName = "Guest";
        let reporterEmail = "No Email";

        if (user) {
            reporterEmail = user.email || "No Email";
            reporterName = reporterEmail.split('@')[0]; 
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists() && userDoc.data().Name) {
                    reporterName = userDoc.data().Name; 
                } else if (user.displayName) {
                    reporterName = user.displayName;
                }
            } catch (err) { console.log("Could not fetch profile name for report."); }
        }

        await addDoc(collection(db, "recipe_reports"), {
            recipeId: current.id,
            recipeName: current.name || current.n,
            issue: reason,
            userName: reporterName,      
            userEmail: reporterEmail,    
            uid: user ? user.uid : "anonymous",
            createdAt: serverTimestamp()
        });

        console.log("🚩 [REPORT] Report sent for recipe:", current.id);
        alert("Report sent to the Chef!");
        document.getElementById('report-reason').value = "";

        const reportModal = document.getElementById('report-modal');
        if (reportModal) reportModal.classList.add('hidden');
        if (window.closeReportModal) window.closeReportModal();

    } catch(e) {
        console.error("🔥 [REPORT] Error sending report:", e);
        alert("Error sending report. Check your connection.");
    } finally {
        if(btn) btn.innerText = originalText;
    }
}

// ==========================================
// 4. Sharing
// ==========================================
window.openShareModal = function() {
    // Point the print link at this specific recipe so print.html opens with
    // it already ticked (they can add more there before printing).
    const printLink = document.getElementById('share-print-link');
    if (printLink && recipeId) printLink.href = `print.html?id=${recipeId}`;

    document.getElementById('share-modal').classList.remove('hidden');
};

window.closeShareModal = function() {
    document.getElementById('share-modal').classList.add('hidden');
};

window.copyRecipeLink = function() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        alert("Link copied! They will need an account to view it.");
    });
};
window.triggerPrint = function() {
    // Close BOTH overlays first. On a phone this is usually reached from
    // inside the mobile Kitchen Tools sheet, and leaving that open used to
    // print the tool menu on top of the recipe. @media print now hides it
    // too, but closing it here keeps the on-screen state sane as well.
    closeShareModal();
    if (window.closeMobileToolsModal) window.closeMobileToolsModal();
    console.log("🖨️ [PRINT] Opening the print dialog for this recipe...");
    setTimeout(() => {
        window.print();
    }, 300);
};

// ==========================================
// MOBILE FLOATING KITCHEN TOOLS MODAL
// ==========================================
function setupMobileKitchenTools() {
    // 1. Inject responsive CSS rules if not already present
    if (!document.getElementById('mobile-tools-style')) {
        const style = document.createElement('style');
        style.id = 'mobile-tools-style';
        style.innerHTML = `
            /* Floating Action Button (Hidden on Desktop) */
            #mobile-tool-fab {
                display: none;
                position: fixed;
                bottom: 24px;
                right: 24px;
                width: 60px;
                height: 60px;
                background-color: #0d9488;
                color: white;
                border-radius: 50%;
                border: none;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                font-size: 26px;
                cursor: pointer;
                z-index: 999;
                align-items: center;
                justify-content: center;
                transition: transform 0.2s, background-color 0.2s;
            }
            #mobile-tool-fab:active {
                transform: scale(0.92);
            }
            
            /* Modal Backdrop & Container */
            #mobile-tools-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                z-index: 1000;
                align-items: flex-end;
                justify-content: center;
            }
            #mobile-tools-content {
                background: #1e293b;
                width: 100%;
                max-width: 500px;
                max-height: 85vh;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                border-top-left-radius: 20px;
                border-top-right-radius: 20px;
                padding: 24px;
                box-shadow: 0 -4px 20px rgba(0,0,0,0.4);
                animation: slideUp 0.3s ease-out;
            }
            @keyframes slideUp {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
            }

            /* 🚀 THE GRID UPGRADE: 2 clean equal columns with uniform height! */
            #mobile-tools-body {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 12px;
            }

            /* 🚀 UNIFORM PILL STYLING.
               Uses min-height + wrapping rather than a fixed height with
               nowrap/ellipsis: the long labels ("Ingredients in Steps",
               "Substitution Hints", "Personalize This Recipe") were being
               chopped mid-word and became unreadable. Now they wrap to a
               second line and the pill grows to fit. */
            .mobile-tool-pill {
                display: flex !important;
                align-items: center;
                justify-content: center;
                width: 100% !important;
                min-height: 52px !important;
                height: auto !important;
                margin: 0 !important;
                padding: 8px 14px !important;
                border-radius: 26px !important;
                font-size: 0.85rem !important;
                font-weight: 600 !important;
                line-height: 1.25 !important;
                text-align: center;
                box-sizing: border-box;
                white-space: normal;
                overflow-wrap: anywhere;
            }

            /* Make wide buttons (like Report Issue or Cook Mode) span across both columns! */
            .mobile-tool-pill-wide {
                grid-column: span 2;
            }

            /* Section labels so scale (0.5x/1x/2x/3x) and altitude (3-5k ft/etc)
               buttons don't look like one confusing pile of pills */
            .mobile-tool-section-header {
                grid-column: span 2;
                color: #94a3b8;
                font-size: 0.72rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                margin: 10px 0 -2px 0;
            }
            .mobile-tool-section-header:first-child {
                margin-top: 0;
            }

            /* Mobile Media Query Switch */
            @media (max-width: 768px) {
                .kitchen-tools-inline {
                    display: none !important;
                }
                #mobile-tool-fab {
                    display: flex;
                }
                /* Extra breathing room at the bottom so the comment Post button clears the FAB */
                body {
                    padding-bottom: 90px !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // 2. Find the real Kitchen Tools section (it already carries this class in recipe.html)
    const toolsSection = document.querySelector('.kitchen-tools-section');
    if (toolsSection && !toolsSection.classList.contains('kitchen-tools-inline')) {
        toolsSection.classList.add('kitchen-tools-inline');
    }

    // 3. Create Floating Button
    if (!document.getElementById('mobile-tool-fab')) {
        const fab = document.createElement('button');
        fab.id = 'mobile-tool-fab';
        fab.innerHTML = '🛠️';
        fab.title = 'Kitchen Tools';
        fab.onclick = openMobileToolsModal;
        document.body.appendChild(fab);
    }

    // 4. Create Modal Structure
    if (!document.getElementById('mobile-tools-modal')) {
        const modal = document.createElement('div');
        modal.id = 'mobile-tools-modal';
        modal.onclick = (e) => { if (e.target === modal) closeMobileToolsModal(); };
        modal.innerHTML = `
            <div id="mobile-tools-content">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="color: white; margin: 0; font-size: 1.2rem;">🛠️ Kitchen Tools</h3>
                    <button onclick="closeMobileToolsModal()" style="background: none; border: none; color: #94a3b8; font-size: 24px; cursor: pointer;">&times;</button>
                </div>
                <div id="mobile-tools-body"></div>
            </div>
        `;
        document.body.appendChild(modal);
    }
}

// Groups + labels so the mobile modal doesn't read as one flat pile of
// pills (this is what the scale 0.5x/1x/2x/3x buttons sitting right next
// to the altitude Off/3-5k ft/etc buttons with no labels was confusing).
// Checked in order; first match wins.
const MOBILE_TOOL_GROUPS = [
    { label: '⚖️ Scale Recipe', match: text => /^\d+(\.\d+)?x$/.test(text.trim()) },
    { label: '🏔️ High Altitude', match: text => text.trim() === 'Off' || /ft$/.test(text.trim()) },
    { label: '🚩 Report an Issue', match: text => text.includes('Report') },
    { label: '🛠️ Admin', match: text => text.includes('Test Mode') },
    { label: '🖥️ Display', match: text => /Text \+|Text -|Day Mode|Night Mode|Ingredients in Steps|Substitution Hints/.test(text) },
    { label: '🎬 Actions', match: () => true } // fallback: Share/Print, Stay Awake, Cook Mode, Menu, Personalize
];

function classifyMobileToolButton(text) {
    const idx = MOBILE_TOOL_GROUPS.findIndex(g => g.match(text));
    return idx === -1 ? MOBILE_TOOL_GROUPS.length - 1 : idx;
}

window.openMobileToolsModal = function() {
    const modal = document.getElementById('mobile-tools-modal');
    const modalBody = document.getElementById('mobile-tools-body');
    const inlineTools = document.querySelector('.kitchen-tools-section');

    if (modal && inlineTools) {
        const allToolButtons = Array.from(inlineTools.querySelectorAll('button'))
            .filter(btn => btn.id !== 'mobile-tool-fab')
            // Skip buttons inside a hidden container — otherwise the
            // admin-only Test Mode button would get cloned into the sheet
            // for everyone, since querySelectorAll still finds hidden nodes.
            .filter(btn => !btn.closest('.hidden'));
        modalBody.innerHTML = '';

        // Group first (Actions, Display, Scale, Altitude, Report), preserving
        // each button's original order within its group.
        const grouped = allToolButtons
            .map((btn, i) => ({ btn, group: classifyMobileToolButton(btn.innerText), i }))
            .sort((a, b) => (a.group - b.group) || (a.i - b.i));

        let lastGroup = null;
        grouped.forEach(({ btn, group }) => {
            if (group !== lastGroup) {
                lastGroup = group;
                const header = document.createElement('div');
                header.className = 'mobile-tool-section-header';
                header.innerText = MOBILE_TOOL_GROUPS[group].label;
                modalBody.appendChild(header);
            }

            const clone = btn.cloneNode(true);
            // Buttons are looked up by class, not id — strip the id so we don't
            // end up with duplicate DOM ids (that was breaking state updates
            // on the cloned button previously).
            clone.removeAttribute('id');
            clone.classList.add('mobile-tool-pill');

            // Long-labelled buttons get the full width so their text stays
            // readable instead of wrapping awkwardly in a half-width pill.
            if (/Report|Ingredients in Steps|Substitution Hints|Personalize/.test(clone.innerText)) {
                clone.classList.add('mobile-tool-pill-wide');
            }

            modalBody.appendChild(clone);
        });

        modal.style.display = 'flex';
    } else {
        alert("Could not load kitchen tools. Please check console for errors.");
    }
};

window.closeMobileToolsModal = function() {
    const modal = document.getElementById('mobile-tools-modal');
    if (modal) modal.style.display = 'none';
};

// Start — but wait for Firebase Auth to finish restoring the session first.
// The very first Firestore read used to fire before the auth token was
// attached, so under login-required security rules it got denied even for
// a signed-in user (the "works on the second refresh" symptom). Waiting on
// the first onAuthStateChanged tick closes that race for good.
// Test Mode is restricted to Adam alone (see canUseTestMode in main.js) —
// it silently suppresses activity tracking, so it shouldn't be reachable by
// every admin. The homepage carries the main toggle; this is the
// convenience copy while you're actually looking at a recipe.
onAuthStateChanged(auth, (user) => {
    if (!canUseTestMode(user)) return;
    document.getElementById('admin-tools-slot')?.classList.remove('hidden');
    updateTestModeUi();
});

const authReady = new Promise((resolve) => {
    // Offline there's nothing to wait for — Auth can't reach
    // apis.google.com, so onAuthStateChanged never fires at all. Don't make
    // people stare at a blank page for 3 seconds first.
    if (!navigator.onLine) {
        console.warn("📴 [RECIPE] Offline — skipping the sign-in wait.");
        resolve();
        return;
    }
    const unsubscribe = onAuthStateChanged(auth, () => { unsubscribe(); resolve(); });
    // Never hang the page if auth itself stalls
    setTimeout(resolve, 3000);
});
authReady.then(loadRecipe);