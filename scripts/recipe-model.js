// ==========================================
// SHARED RECIPE MODEL HELPERS
//
// MULTI-PART RECIPES (a pie with a crust, a filling, and a topping)
// -----------------------------------------------------------------
// Sections are stored ADDITIVELY so nothing that already exists breaks:
//
//   ingredients          flat array — ALWAYS written, every section merged
//   instructions         flat array — ALWAYS written, every section merged
//   ingredientSections   optional [{ title, items[] }]
//   instructionSections  optional [{ title, items[] }]
//
// Keeping the flat arrays populated means the shopping list, the homepage
// search index, offline copies, and any older code path keep working
// untouched — they simply see one long list, exactly as before. Anything
// that wants the nicer grouped view reads the *Sections fields.
//
// In the editors, sections are typed inline with a "## " heading, which
// avoids inventing a fiddly add/remove/reorder UI in three separate editors:
//
//   ## Crust
//   2 cups flour
//   1/2 cup butter
//   ## Filling
//   4 apples, sliced
//
// Ingredients and instructions are sectioned independently, because a
// recipe often has (say) three ingredient groups but two sets of steps.
// ==========================================

export const SECTION_MARKER = '##';

// ==========================================
// PRETTY FRACTIONS
// Recipes are typed by hand, so the same cookbook ends up with "½ cup" on
// one line and "1/2 cup" on the next — and the scaling code emits ASCII
// fractions too ("1 1/2"), so even a tidy recipe goes ragged at 2×.
//
// This is applied at DISPLAY time rather than rewritten into the database:
// every existing recipe is fixed instantly with no migration, and the
// editors keep showing plain "1/2", which is far easier to type than
// hunting for a ½ on a phone keyboard.
// ==========================================
const UNICODE_FRACTIONS_OUT = {
    '1/2': '½',
    '1/3': '⅓', '2/3': '⅔',
    '1/4': '¼', '3/4': '¾',
    '1/5': '⅕', '2/5': '⅖', '3/5': '⅗', '4/5': '⅘',
    '1/6': '⅙', '5/6': '⅚',
    '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞'
};

// Turns "1/2 cup" into "½ cup" and "1 1/2 cups" into "1½ cups".
// Anything that isn't a recognised cooking fraction is left exactly as it
// was, so pan sizes and odd ratios ("13/9") never get mangled.
export function prettyFractions(text) {
    if (typeof text !== 'string') return text;

    // The whole number and its trailing space are one optional unit — if
    // `\s*` sat outside the group it would swallow the space in "and 2/3",
    // gluing the fraction onto the previous word.
    return text.replace(/(?:(\d+)\s+)?\b(\d+)\/(\d+)\b/g, (match, whole, numerator, denominator) => {
        const glyph = UNICODE_FRACTIONS_OUT[`${numerator}/${denominator}`];
        if (!glyph) return match;
        return whole ? `${whole}${glyph}` : glyph;
    });
}

// ==========================================
// FAMILY OWNERSHIP
// Which side of the family a recipe belongs to. Everything defaults to
// "Both" — including every recipe that predates this field — so turning the
// Settings filter on can never make the cookbook look empty. Note this is
// separate from the "Egbert Favorite" / "Wheeler Favorite" hall-of-fame
// tags, which mark standout recipes rather than ownership.
// ==========================================
export const FAMILIES = ['Both', 'Egbert', 'Wheeler'];

export function getRecipeFamily(recipe) {
    const value = recipe && (recipe.family || recipe.fam);
    return FAMILIES.includes(value) ? value : 'Both';
}

// True if a recipe should be visible under the given filter
// ('all' | 'Egbert' | 'Wheeler').
export function matchesFamilyFilter(recipe, filter) {
    if (!filter || filter === 'all') return true;
    const family = getRecipeFamily(recipe);
    return family === 'Both' || family === filter;
}

// ==========================================
// DIETARY / ALLERGY TAGS
// Free-standing from the category tags so filtering on "Gluten-Free" can
// never disturb the Appetizers/Desserts/etc structure.
// ==========================================
export const DIETARY_TAGS = [
    'Vegetarian',
    'Vegan',
    'Gluten-Free',
    'Dairy-Free',
    'Nut-Free',
    'Kid-Friendly',
    'Freezer-Friendly'
];

export function getDietaryTags(recipe) {
    const raw = recipe && (recipe.dietary || recipe.d);
    if (!Array.isArray(raw)) return [];
    return raw.filter(tag => DIETARY_TAGS.includes(tag));
}

// Splits "## Crust\n2 cups flour\n## Filling\n4 apples" into
// [{ title: 'Crust', items: [...] }, { title: 'Filling', items: [...] }].
// Lines before any heading become an untitled leading section, so a plain
// unsectioned recipe round-trips as a single { title: '', items: [...] }.
export function parseSectionedText(text) {
    const sections = [];
    let current = { title: '', items: [] };

    String(text || '').split('\n').forEach(rawLine => {
        const line = rawLine.trim();
        if (!line) return;

        if (line.startsWith(SECTION_MARKER)) {
            // Close the previous section (skip a totally empty leading one)
            if (current.title || current.items.length) sections.push(current);
            current = { title: line.replace(/^#+\s*/, '').trim(), items: [] };
        } else {
            current.items.push(line);
        }
    });

    if (current.title || current.items.length) sections.push(current);
    return sections;
}

// Turns structured sections back into the "## " text the editors show.
export function sectionsToText(sections) {
    if (!Array.isArray(sections)) return '';
    return sections
        .map(s => (s.title ? `${SECTION_MARKER} ${s.title}\n` : '') + (s.items || []).join('\n'))
        .join('\n');
}

// Every section's items merged into one flat list, for the flat fields.
export function flattenSections(sections) {
    if (!Array.isArray(sections)) return [];
    return sections.reduce((all, s) => all.concat(s.items || []), []);
}

// True only when the sections carry real structure worth rendering as
// headings — a single untitled section is just a normal recipe.
export function hasRealSections(sections) {
    if (!Array.isArray(sections) || sections.length === 0) return false;
    return sections.length > 1 || Boolean(sections[0].title);
}

// Reads a recipe from Firestore into the sections shape, whichever way it
// was stored. Falls back to wrapping the legacy flat array in one untitled
// section, so callers only ever deal with one shape.
// kind: 'ingredients' | 'instructions'
export function getSections(recipe, kind) {
    if (!recipe) return [];

    const sectionField = kind === 'instructions' ? 'instructionSections' : 'ingredientSections';
    const stored = recipe[sectionField];
    if (Array.isArray(stored) && stored.length > 0) {
        return stored.map(s => ({ title: s.title || '', items: Array.isArray(s.items) ? s.items : [] }));
    }

    const flat = kind === 'instructions'
        ? (recipe.instructions || recipe.recipeInstructions)
        : (recipe.ingredients || recipe.recipeIngredient);

    if (Array.isArray(flat)) return [{ title: '', items: flat }];
    if (typeof flat === 'string' && flat.trim()) return [{ title: '', items: flat.split('\n').filter(Boolean) }];
    return [];
}

// The editor-facing text for a recipe ("## " headings included when the
// recipe actually has sections).
export function getEditableText(recipe, kind) {
    const sections = getSections(recipe, kind);
    return hasRealSections(sections) ? sectionsToText(sections) : flattenSections(sections).join('\n');
}

// Builds the Firestore fields for one half of a recipe from editor text.
// Always returns BOTH the flat array and the sections, so writers can just
// spread the result into their update payload.
// Returns e.g. { ingredients, recipeIngredient, ingredientSections }
export function buildRecipeFields(text, kind) {
    const sections = parseSectionedText(text);
    const flat = flattenSections(sections);
    const structured = hasRealSections(sections) ? sections : [];

    if (kind === 'instructions') {
        return {
            instructions: flat,
            recipeInstructions: flat,
            instructionSections: structured
        };
    }
    return {
        ingredients: flat,
        recipeIngredient: flat,
        ingredientSections: structured
    };
}
