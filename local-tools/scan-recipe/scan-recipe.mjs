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

import { DEFAULT_SCAN_MODEL, checkScanModel, scanImages } from '../../scripts/recipe-scan.js';
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api').replace(/\/generate\/?$/, '').replace(/\/$/, '');
const MODEL = process.env.OLLAMA_MODEL || DEFAULT_SCAN_MODEL;
const OUTPUT_FILE = 'scanned-recipes.json';
async function scanImage(filePath) {
    return scanImages(OLLAMA_URL, MODEL, [readFileSync(filePath).toString('base64')]);
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

    await checkScanModel(OLLAMA_URL, MODEL);
    const results = [];

    for (const file of files) {
        const label = basename(file);
        process.stdout.write(`  ${label} ... `);

        try {
            const found = await scanImage(file);
            const valid = found.filter(r => r && !r.error && (r.name || (r.ingredients && r.ingredients.length)));

            if (valid.length === 0) {
                console.log('skipped (no recipe found)');
                continue;
            }

            results.push(...valid);

            console.log(valid.length > 1
                ? `done (${valid.length} recipes: ${valid.map(r => `"${r.name}"`).join(', ')})`
                : `done ("${valid[0].name}")`);
        } catch (err) {
            console.log(`failed (${err.message})`);
            process.exitCode = 1;
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

main().catch(error => { console.error(error.message); process.exitCode = 1; });
