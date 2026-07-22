// Small shared helpers for working with free-text ingredient lines
// ("2 cups flour", "1/2 tsp salt", ...) — used by the shopping list to
// group the same ingredient together when it shows up in multiple recipes,
// and by the recipe page for substitution hints.

const UNIT_WORDS = 'cups?|tbsps?|tablespoons?|tsps?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g|kg|ml|liters?|l|cloves?|pinch(?:es)?|dash(?:es)?|slices?|cans?|packages?|boxes?|bags?|jars?|sticks?|large|small|medium';

// Strips leading quantity + unit + punctuation so "2 cups flour, sifted"
// and "1/2 cup flour" both normalize to roughly "flour sifted" / "flour".
export function normalizeIngredientName(line) {
    if (!line) return '';
    let text = String(line).toLowerCase();

    text = text.replace(/^[\d\s./\-¼½¾⅓⅔⅛⅜⅝⅞]+/, ''); // leading numbers/fractions/ranges
    text = text.replace(new RegExp(`\\b(${UNIT_WORDS})\\b`, 'g'), '');
    text = text.replace(/[(),]/g, '');

    return text.trim().replace(/\s+/g, ' ');
}

// Groups a flat list of { text, source } ingredient entries by normalized
// name, so the same ingredient across multiple recipes shows up once with
// each recipe's amount listed underneath, instead of as separate lines.
export function groupIngredients(entries) {
    const groups = {};
    const order = [];

    entries.forEach(({ text, source }) => {
        if (!text) return;
        const key = normalizeIngredientName(text) || text.toLowerCase();
        if (!groups[key]) {
            groups[key] = { key, label: normalizeIngredientName(text) || text, items: [] };
            order.push(key);
        }
        groups[key].items.push({ text, source });
    });

    return order.map(key => groups[key]);
}
