// Scan photos of recipe cards/cookbook pages using a free, fully local
// Ollama vision model, and output JSON ready to paste into the Cookbook
// admin dashboard's "Speed Upload Station" box.
//
// Usage:
//   node scan-recipe.mjs photo1.jpg photo2.png ...
//
// (see README.md in this folder for one-time Ollama setup)

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { basename } from 'path';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2-vision';
const OUTPUT_FILE = 'scanned-recipes.json';

const CATEGORIES = [
    'Appetizers & Snacks', 'Breads & Rolls', 'Breakfast', 'Desserts', 'Dutch Oven',
    'Main Dishes', 'Miscellaneous', 'Sauces, Dressings & Marinades', 'Soups & Salads'
];

const PROMPT = `You are reading a photo of a handwritten or printed recipe card/cookbook page.
Extract the recipe and respond with ONLY raw JSON (no markdown fences, no commentary) in exactly this shape:

{
  "name": "Recipe title",
  "author": "Person's name if credited on the card, otherwise an empty string",
  "category": "One of: ${CATEGORIES.join(' | ')}",
  "ingredients": ["one ingredient per array item, as written"],
  "instructions": ["one step per array item, in order"],
  "notes": "Any extra notes/tips on the card, or an empty string"
}

If the image is unreadable or not a recipe, respond with {"error": "reason here"}.`;

function toBase64(filePath) {
    return readFileSync(filePath).toString('base64');
}

async function scanImage(filePath) {
    const imageB64 = toBase64(filePath);

    const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: MODEL,
            prompt: PROMPT,
            images: [imageB64],
            stream: false,
            format: 'json'
        })
    });

    if (!res.ok) {
        throw new Error(`Ollama request failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    const raw = (data.response || '').trim();

    // Strip markdown code fences if the model added them anyway
    const cleaned = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();

    return JSON.parse(cleaned);
}

async function main() {
    const files = process.argv.slice(2);

    if (files.length === 0) {
        console.error('\nUsage: node scan-recipe.mjs <image1.jpg> [image2.jpg ...]\n');
        process.exit(1);
    }

    const missing = files.filter(f => !existsSync(f));
    if (missing.length > 0) {
        console.error(`\nFile(s) not found: ${missing.join(', ')}\n`);
        process.exit(1);
    }

    console.log(`\nScanning ${files.length} image(s) with local model "${MODEL}"...\n`);

    const results = [];

    for (const file of files) {
        const label = basename(file);
        process.stdout.write(`  ${label} ... `);

        try {
            const recipe = await scanImage(file);

            if (recipe.error) {
                console.log(`skipped (${recipe.error})`);
                continue;
            }

            if (!CATEGORIES.includes(recipe.category)) {
                recipe.category = 'Miscellaneous';
            }

            results.push({
                name: recipe.name || 'Untitled',
                author: recipe.author || '',
                tags: [recipe.category],
                ingredients: recipe.ingredients || [],
                instructions: recipe.instructions || [],
                notes: recipe.notes || ''
            });

            console.log(`done ("${recipe.name}")`);
        } catch (err) {
            console.log(`failed (${err.message})`);
        }
    }

    if (results.length === 0) {
        console.log('\nNo recipes extracted.\n');
        return;
    }

    writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

    console.log(`\nWrote ${results.length} recipe(s) to ${OUTPUT_FILE}`);
    console.log('Paste that file\'s contents into the admin dashboard\'s "Speed Upload Station" box, then click "Launch Recipes".\n');
}

main();
