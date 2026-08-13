// Shared recipe-from-URL parser — used both by the browser (admin.html,
// which tries a direct fetch first) and by the local import server in
// local-tools/scan-recipe/serve-locally.mjs (which fetches server-side,
// the reliable path for the vast majority of recipe sites that block
// cross-origin reads).
//
// Recipe sites almost universally embed a schema.org Recipe as JSON-LD
// (https://schema.org/Recipe) inside a <script type="application/ld+json">
// tag, specifically so Google can show rich recipe results in search. We
// read that same structured data instead of scraping the visible page,
// which would mean guessing at HTML/CSS that differs on every site and
// changes without notice.

export function parseRecipeFromHtml(html, sourceUrl) {
    const blocks = extractJsonLdBlocks(html);
    const recipeNode = blocks.map(findRecipeNode).find(Boolean);

    if (!recipeNode) {
        throw new Error("Couldn't find recipe data on that page. Some sites don't publish it in a way we can read automatically — this one will need to be entered by hand.");
    }

    const ingredients = toStringArray(recipeNode.recipeIngredient || recipeNode.ingredients);
    const { instructions, instructionSections } = parseInstructions(recipeNode.recipeInstructions);

    if (ingredients.length === 0 && instructions.length === 0) {
        throw new Error("Found a recipe on that page, but couldn't read its ingredients or instructions — this one will need to be entered by hand.");
    }

    return {
        name: cleanText(pickString(recipeNode.name)) || "Untitled",
        author: cleanText(pickAuthor(recipeNode.author)) || "",
        category: "Miscellaneous",
        tags: ["Miscellaneous"],
        ingredients,
        recipeIngredient: ingredients,
        ingredientSections: [],
        instructions,
        recipeInstructions: instructions,
        instructionSections,
        notes: "",
        sourceUrl: sourceUrl || pickString(recipeNode.url) || ""
    };
}

function extractJsonLdBlocks(html) {
    const blocks = [];
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
        try { blocks.push(JSON.parse(m[1].trim())); } catch (e) { /* malformed block on the page — skip it */ }
    }
    return blocks;
}

// A JSON-LD block might BE the Recipe, might be an array of nodes, or might
// wrap everything in an @graph array (common on WordPress recipe plugins).
function findRecipeNode(node) {
    if (!node) return null;
    if (Array.isArray(node)) {
        for (const item of node) { const found = findRecipeNode(item); if (found) return found; }
        return null;
    }
    if (isRecipeType(node['@type'])) return node;
    if (Array.isArray(node['@graph'])) return findRecipeNode(node['@graph']);
    return null;
}

function isRecipeType(type) {
    if (!type) return false;
    if (Array.isArray(type)) return type.some(isRecipeType);
    return String(type).toLowerCase() === 'recipe';
}

function pickString(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return pickString(value[0]);
    return '';
}

function pickAuthor(author) {
    if (!author) return '';
    if (typeof author === 'string') return author;
    if (Array.isArray(author)) return pickAuthor(author[0]);
    if (typeof author === 'object') return author.name || '';
    return '';
}

function toStringArray(value) {
    if (!value) return [];
    const arr = Array.isArray(value) ? value : [value];
    return arr.map(v => cleanText(typeof v === 'string' ? v : (v && v.text) || '')).filter(Boolean);
}

// recipeInstructions is the messiest field in the wild: a plain string, an
// array of strings, an array of HowToStep objects, or an array of
// HowToSection objects (each with its own name + nested HowToStep list —
// which maps neatly onto this app's own multi-part recipe sections).
function parseInstructions(value) {
    if (!value) return { instructions: [], instructionSections: [] };

    if (typeof value === 'string') {
        const steps = value.split(/\n+/).map(cleanText).filter(Boolean);
        return { instructions: steps, instructionSections: [] };
    }

    const arr = Array.isArray(value) ? value : [value];
    const hasSections = arr.some(v => v && v['@type'] === 'HowToSection');

    if (!hasSections) {
        const steps = arr.map(v => cleanText(typeof v === 'string' ? v : (v && v.text) || '')).filter(Boolean);
        return { instructions: steps, instructionSections: [] };
    }

    const sections = arr
        .map(section => ({
            title: cleanText(section.name || ''),
            items: (section.itemListElement || [])
                .map(step => cleanText(typeof step === 'string' ? step : (step && step.text) || ''))
                .filter(Boolean)
        }))
        .filter(s => s.items.length > 0);

    const instructions = sections.reduce((all, s) => all.concat(s.items), []);
    return { instructions, instructionSections: sections };
}

// Strips HTML tags/entities that sometimes leak into JSON-LD text fields.
function cleanText(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
        .replace(/\s+/g, ' ')
        .trim();
}
