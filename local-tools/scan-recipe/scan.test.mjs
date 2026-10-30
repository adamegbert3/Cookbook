import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { parseScanResponse, scanImages, checkScanModel } from '../../scripts/recipe-scan.js';

const recipe = { name: 'Bread', author: '', category: 'Breads & Rolls', ingredients: ['1/2 cup milk'], instructions: ['Bake at 350 F.'], notes: '' };
test('browser preflight reports failure and re-enables scanning without affecting URL imports', async () => {
    const source = await readFile(new URL('../../scripts/dashboard.js', import.meta.url), 'utf8');
    const scan = source.slice(source.indexOf('window.scanRecipePhoto ='), source.indexOf('window.sendScanToUploadStation ='));
    const elements = {
        'scan-photo-input': { files: [{ name: 'photo.png' }] },
        'scan-photo-status': {}, 'scan-photo-result': { style: {} }, 'scan-photo-btn': {}
    };
    const window = {};
    runInNewContext(scan, { window, document: { getElementById: id => elements[id] },
        getOllamaBaseUrl: () => '/api/ollama', getOllamaModel: () => 'missing',
        checkScanModel: async () => { throw new Error('model missing not found'); }
    });
    await window.scanRecipePhoto();
    assert.equal(elements['scan-photo-status'].innerText, 'model missing not found');
    assert.equal(elements['scan-photo-btn'].disabled, false);
    const urlImport = source.slice(source.indexOf('window.importRecipeFromUrl ='), source.indexOf('window.importRecipeFromUrl =') + 1500);
    assert.ok(!urlImport.includes('checkScanModel'));
});
test('parses wrapped, legacy array and single recipe responses without losing quantities', () => {
    for (const value of [{ recipes: [recipe] }, [recipe], recipe]) {
        assert.equal(parseScanResponse({ response: JSON.stringify(value) })[0].ingredients[0], '1/2 cup milk');
    }
    assert.deepEqual(parseScanResponse({ response: '{"recipes":[]}' }), []);
});
test('rejects malformed and truncated output instead of uploading invalid data', () => {
    for (const value of [null, {}, { recipes: [{ ...recipe, ingredients: 'milk' }] }]) {
        assert.throws(() => parseScanResponse({ response: JSON.stringify(value) }));
    }
    assert.throws(() => parseScanResponse({ response: '{', done_reason: 'length' }), /cut short/);
});
test('helper proxies scans, reports model failures, and blocks private files and foreign origins', async t => {
    const mock = createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        res.setHeader('Content-Type', 'application/json');
        if (body.model === 'missing') { res.writeHead(404); res.end('{"error":"model missing not found"}'); return; }
        if (req.url === '/api/show') { res.end(JSON.stringify({ capabilities: body.model === 'embed' ? ['embedding'] : ['vision'] })); return; }
        assert.equal(body.format.properties.recipes.type, 'array');
        assert.equal(body.options.temperature, 0);
        assert.equal(body.stream, false);
        assert.deepEqual(body.images, ['test-image']);
        res.end(JSON.stringify({ response: JSON.stringify({ recipes: [recipe] }) }));
    }).listen(0, '127.0.0.1');
    await once(mock, 'listening'); t.after(() => mock.close());
    const child = spawn(process.execPath, [new URL('./serve-locally.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], {
        env: { ...process.env, PORT: '18089', HOST: '127.0.0.1', OLLAMA_BASE_URL: `http://127.0.0.1:${mock.address().port}` }, stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(() => child.kill());
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Helper failed to start'); })]);
    const base = 'http://127.0.0.1:18089';
    await checkScanModel(base + '/api/ollama', 'vision');
    await assert.rejects(checkScanModel(base + '/api/ollama', 'embed'), /cannot read photos/);
    await assert.rejects(checkScanModel(base + '/api/ollama', 'missing'), /not found/);
    assert.equal((await scanImages(base + '/api/ollama', 'vision', ['test-image']))[0].name, 'Bread');
    for (const path of ['/.git/config', '/.env', '/local-tools/sync-to-drive/serviceAccountKey.json', '/%2e%2e%5cCookbook-other/secret']) {
        assert.equal((await fetch(base + path)).status, 403, path);
    }
    assert.equal((await fetch(base + '/%ZZ')).status, 400);
    assert.equal((await fetch(base + '/admin/scan.html')).status, 200);
    assert.equal((await fetch(base + '/api/ollama/show', { method: 'POST', headers: { Origin: 'https://untrusted.example' } })).status, 403);
});
