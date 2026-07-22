// Serves this whole project over plain HTTP on your computer, specifically
// so the admin dashboard's AI scanner can talk to Ollama.
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
// — do NOT use the https://... link while scanning.

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..'); // local-tools/scan-recipe -> repo root
const PORT = process.env.PORT || 8080;

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

createServer(async (req, res) => {
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
    console.log(`  http://localhost:${PORT}/admin.html   <-- 2. then open this to scan recipes`);
    console.log(`\nLeave this running while you scan. Press Ctrl+C to stop.\n`);
});
