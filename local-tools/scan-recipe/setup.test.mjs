import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function wizard({ host = 'localhost', fail = false, downloadFail = false } = {}) {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { disabled: false, textContent: '', innerHTML: '', focus() {},
            addEventListener(event, handler) { this[event] = handler; },
            querySelector(selector) { return element(selector); } });
        return elements.get(id);
    };
    const stored = new Map();
    const source = (await readFile(new URL('../../scripts/scanner-setup.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/, '');
    let checks = 0;
    runInNewContext(source, { document: { getElementById: element },
        location: { hostname: host, hash: '#check' }, navigator: {}, window: { addEventListener() {} },
        localStorage: { getItem: k => stored.get(k), setItem: (k,v) => stored.set(k,v) },
        fetch: async () => new Response(downloadFail ? '{"error":"No disk space"}\n' : '{"status":"pulling","total":100,"completed":50}\n{"status":"success"}\n'), TextDecoder, AbortSignal,
        DEFAULT_SCAN_MODEL: 'gemma3:4b', checkScanModel: async (base, model) => {
            checks++; assert.equal(base, '/api/ollama'); assert.equal(model, 'gemma3:4b');
            if (fail) throw Error('Model not found');
        } });
    return { element, stored, checks: () => checks };
}
test('local setup requires a successful model check and selects the scanner model', async () => {
    const w = await wizard();
    assert.equal(w.element('setup-next').disabled, true);
    await w.element('#setup-check').click({ target: w.element('#setup-check') });
    assert.equal(w.checks(), 1);
    assert.equal(w.element('setup-next').disabled, false);
    assert.equal(w.stored.get('ollamaModelName'), 'gemma3:4b');
    w.element('setup-next').onclick();
    assert.match(w.element('setup-title').textContent, /Sign in/);
});
test('failed setup check stays blocked with a recoverable explanation', async () => {
    const w = await wizard({ fail: true });
    await w.element('#setup-check').click({ target: w.element('#setup-check') });
    assert.equal(w.element('setup-next').disabled, true);
    assert.equal(w.element('#setup-check').disabled, false);
    assert.match(w.element('setup-feedback').textContent, /Model not found/);
});
test('hosted guide directs users to localhost before checking Ollama', async () => {
    const w = await wizard({ host: 'www.yum4you.com' });
    assert.equal(w.element('setup-next').disabled, true);
    assert.match(w.element('setup-body').innerHTML, /localhost:8080\/scanner-setup.html#check/);
    assert.equal(w.checks(), 0);
});
test('scanner update notice is scoped to Adam and respects dismissal', async () => {
    const source = (await readFile(new URL('../../scripts/scanner-update-notice.js', import.meta.url), 'utf8')).replace('export function', 'function');
    let added = 0;
    const stored = new Map();
    const storage = { getItem: k => stored.get(k), setItem: (k,v) => stored.set(k,v) };
    const buttons = {};
    const context = { localStorage: storage, sessionStorage: storage, document: {
        getElementById() { return null; }, body: { prepend() { added++; } },
        createElement() { return { setAttribute() {}, remove() {}, querySelector(s) { return buttons[s] ||= {}; } }; }
    } };
    runInNewContext(source + '\nthis.show = showScannerUpdate;', context);
    context.show(null); context.show({ uid: 'someone-else' }); assert.equal(added, 0);
    context.show({ uid: 'n5aAU1g1tBY04Ut0HnhqegSgZe92' }); assert.equal(added, 1);
    buttons['[data-dismiss]'].onclick();
    context.show({ uid: 'n5aAU1g1tBY04Ut0HnhqegSgZe92' }); assert.equal(added, 1);
});

test('model download button verifies the model before allowing Next', async () => {
    const w = await wizard();
    await w.element('#setup-download').click({ target: w.element('#setup-download') });
    assert.equal(w.checks(), 1); assert.equal(w.element('setup-next').disabled, false);
    assert.match(w.element('setup-feedback').textContent, /installed and ready/);
});
test('model download errors keep Next blocked and permit retry', async () => {
    const w = await wizard({ downloadFail: true });
    await w.element('#setup-download').click({ target: w.element('#setup-download') });
    assert.equal(w.checks(), 0); assert.equal(w.element('setup-next').disabled, true);
    assert.equal(w.element('#setup-download').disabled, false);
    assert.match(w.element('setup-feedback').textContent, /No disk space/);
});
