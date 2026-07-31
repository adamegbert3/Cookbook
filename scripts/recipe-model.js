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
