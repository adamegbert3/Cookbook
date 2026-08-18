// Serves this whole project over plain HTTP on your computer. Originally
// just so the admin dashboard's AI scanner could talk to Ollama; now also
// hosts two more local-only admin helpers that need real server-side
// access (fetching arbitrary external sites, and running the Drive sync
// script) that a browser page can never be allowed to do on its own.
//
// Why this exists: admin.html normally loads over HTTPS (the live site),
// and browsers permanently block a secure (HTTPS) page from calling a
// plain HTTP address like Ollama's localhost:11434 — there is no
// workaround or setting for this, it's a hard browser security rule, and
// it applies to "localhost" too, not just external addresses. Loading
// admin.html over plain HTTP instead (this script) sidesteps the problem
// entirely, since HTTP-to-HTTP requests aren't blocked.
//
// Usage:
//   node serve-locally.mjs
// Then open the printed URL (defaults to http://localhost:8080/admin.html)
// — do NOT use the https://... link while scanning, importing, or syncing.

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { parseRecipeFromHtml } from '../../scripts/recipe-import.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..'); // local-tools/scan-recipe -> repo root
const PORT = process.env.PORT || 8080;

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/import-recipe') return handleImportRecipe(req, res);
    if (req.method === 'POST' && req.url === '/api/sync-to-drive') return handleTriggerSync(req, res);

    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/admin.html';

    const filePath = join(PROJECT_ROOT, urlPath);

    // Basic guard against escaping the project root
    if (!filePath.startsWith(PROJECT_ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    try {
        const data = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
        res.end(data);
    } catch (e) {
        res.writeHead(404);
        res.end(`Not found: ${urlPath}`);
    }
}).listen(PORT, () => {
    console.log(`\nServing the Cookbook locally at:\n`);
    console.log(`  http://localhost:${PORT}/index.html   <-- 1. log in here first (this is a separate login session from the live site)`);
    console.log(`  http://localhost:${PORT}/admin.html   <-- 2. then open this — the Scan Photos, Import from Link, and`);
    console.log(`                                                   Drive Sync icons all need this local server running`);
    console.log(`\nLeave this running while you work. Press Ctrl+C to stop.\n`);
});

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(new Error('Invalid request body.')); }
        });
        req.on('error', reject);
    });
}

function sendJson(res, obj) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

// --- Import a recipe from an external URL, server-side (no CORS restriction here) ---
async function handleImportRecipe(req, res) {
    try {
        const { url } = await readJsonBody(req);
        if (!url || !/^https?:\/\//i.test(url)) throw new Error("That doesn't look like a valid recipe URL.");

        console.log(`🔗 [IMPORT] Fetching ${url} ...`);
        const pageRes = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
            signal: AbortSignal.timeout(15000)
        });
        if (!pageRes.ok) throw new Error(`That site returned an error (${pageRes.status}).`);

        const html = await pageRes.text();
        const recipe = parseRecipeFromHtml(html, url);

        console.log(`✅ [IMPORT] Parsed "${recipe.name}" (${recipe.ingredients.length} ingredients, ${recipe.instructions.length} steps).`);
        sendJson(res, { ok: true, recipe });
    } catch (e) {
        console.error('❌ [IMPORT] Failed:', e.message);
        sendJson(res, { ok: false, error: e.message });
    }
}

// --- Trigger the Drive sync script on demand, e.g. right after an admin save ---
// Debounced: if a sync is already running when another trigger comes in, it
// doesn't start a second one — it just marks that one more run is needed
// once the current one finishes, so a burst of saves collapses into at most
// one extra run instead of piling up.
const syncState = { running: false, pendingRerun: false };

function runDriveSyncOnce() {
    return new Promise((resolve) => {
        const dir = join(PROJECT_ROOT, 'local-tools', 'sync-to-drive');
        const child = spawn(process.execPath, [join(dir, 'sync-to-drive.mjs')], { cwd: dir });
        let output = '';
        child.stdout.on('data', d => { output += d; });
        child.stderr.on('data', d => { output += d; });
        child.on('close', code => resolve({ ok: code === 0, output }));
        child.on('error', err => resolve({ ok: false, output: err.message }));
    });
}

async function runDriveSyncLoop() {
    syncState.running = true;
    do {
        syncState.pendingRerun = false;
        console.log('🔄 [DRIVE SYNC] Starting...');
        const result = await runDriveSyncOnce();
        if (result.ok) console.log('✅ [DRIVE SYNC] Done.\n' + result.output);
        else console.error('❌ [DRIVE SYNC] Failed:\n' + result.output);
    } while (syncState.pendingRerun);
    syncState.running = false;
}

async function handleTriggerSync(req, res) {
    if (syncState.running) {
        syncState.pendingRerun = true;
        sendJson(res, { ok: true, status: 'queued' });
        return;
    }
    sendJson(res, { ok: true, status: 'started' });
    runDriveSyncLoop();
}
