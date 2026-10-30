import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, dirname, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { parseRecipeFromHtml } from '../../scripts/recipe-import.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..'); // local-tools/scan-recipe -> repo root
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

createServer(async (req, res) => {
    // Browsers must use this helper's origin for privileged local actions.
    if (req.method === 'POST' && (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host || req.headers['sec-fetch-site'] === 'cross-site')) {
        res.writeHead(403); res.end('Forbidden origin'); return;
    }
    if (req.method === 'POST' && ['/api/ollama/show', '/api/ollama/generate'].includes(req.url)) {
        try {
            const body = await readJsonBody(req);
            const upstream = await fetch(OLLAMA_BASE.replace(/\/$/, '') + req.url.replace('/api/ollama/', '/api/'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...body, stream: false }), signal: AbortSignal.timeout(300000)
            });
            res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
            res.end(await upstream.text());
        } catch (error) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.name === 'TimeoutError' ? 'Ollama timed out. Try a smaller document.' : 'Cannot reach Ollama: ' + error.message + '. Start Ollama and retry.' }));
        }
        return;
    }
    if (req.method === 'POST' && req.url === '/api/import-recipe') return handleImportRecipe(req, res);
    if (req.method === 'POST' && req.url === '/api/sync-to-drive') return handleTriggerSync(req, res);

    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
    catch { res.writeHead(400); res.end('Invalid URL'); return; }
    if (urlPath === '/') urlPath = '/admin.html';

    const filePath = join(PROJECT_ROOT, urlPath);

    // Basic guard against escaping the project root
    const rel = relative(PROJECT_ROOT, filePath);
    const parts = rel.split(/[\\/]/);
    const publicRootFiles = new Set(['sw.js', 'CNAME']);
    const allowed = parts.length === 1 ? (extname(rel) === '.html' || publicRootFiles.has(rel))
        : ['admin', 'scripts', 'styles', 'images', 'offline_features'].includes(parts[0]);
    if (rel.startsWith('..') || isAbsolute(rel) || parts.some(p => p.startsWith('.')) || !allowed) {
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
}).listen(PORT, HOST, () => {
    console.log(`\nServing the Cookbook locally at:\n`);
    console.log(`  http://localhost:${PORT}/index.html   <-- 1. log in here first (this is a separate login session from the live site)`);
    console.log(`  http://localhost:${PORT}/admin.html   <-- 2. then open this — the Scan Photos, Import from Link, and`);
    console.log(`                                                   Drive Sync icons all need this local server running`);
    console.log(`\nLeave this running while you work. Press Ctrl+C to stop.\n`);
});

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let bytes = 0;
        req.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > 40 * 1024 * 1024) { reject(new Error('Request exceeds 40 MB; use fewer or smaller images.')); return; }
            body += chunk;
        });
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
