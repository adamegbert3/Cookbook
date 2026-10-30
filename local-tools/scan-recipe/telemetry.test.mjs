import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { sanitizeEvent, errorCode, summarizeEvents, pageKey } from '../../scripts/telemetry-core.js';

test('diagnostics strip personal data and bound all numerical fields', () => {
    const event = sanitizeEvent('scan_failure', { code: 'timeout', durationMs: Infinity, count: -4,
        email: 'private@example.com', response: 'family recipe', filename: 'private.jpg', message: 'private error' },
    { path: '/recipe.html?id=secret', userAgent: 'Macintosh Safari/123', sessionId: 'private@example.com' });
    assert.equal(event.page, 'recipe'); assert.equal(event.durationMs, 600000); assert.equal(event.count, 0);
    assert.equal(event.os, 'macOS'); assert.equal(event.browser, 'Safari');
    assert.ok(!JSON.stringify(event).includes('private'));
    assert.equal(sanitizeEvent('private recipe'), null);
    assert.equal(pageKey('/unknown/private?token=123'), 'other');
});
test('categorizes failures without retaining messages', () => {
    assert.equal(errorCode(new Error('model abc not found')), 'model_missing');
    assert.equal(errorCode(new Error('unknown model architecture')), 'model_incompatible');
    assert.equal(errorCode(new Error('Cannot decode HEIC')), 'image_decode');
    assert.equal(errorCode({ code: 'permission-denied' }), 'permission');
});
test('aggregates observations without mistaking missing scans for 100% success', () => {
    const base = { sessionId: 'one', page: 'recipe', code: 'none', os: 'macOS', browser: 'Safari' };
    const summary = summarizeEvents([{ ...base, event: 'page_view' }, { ...base, event: 'page_load', durationMs: 500 },
        { ...base, event: 'scan_success' }, { ...base, event: 'scan_failure', code: 'timeout' }]);
    assert.equal(summary.views, 1); assert.equal(summary.sessions, 1); assert.equal(summary.success, 1); assert.equal(summary.failed, 1);
    assert.equal(summary.p75, 500); assert.equal(Object.keys(summary.errors).length, 1);
    assert.equal(summarizeEvents([]).p75, null);
});
async function collector({ optOut = false, dnt = false, online = true, randomUUID = true } = {}) {
    const code = (await readFile(new URL('../../scripts/telemetry.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\n/, '').replaceAll('export ', '');
    const stored = new Map(optOut ? [['cookbook-diagnostics', 'off']] : []);
    const storage = { getItem: k => stored.get(k) || null, setItem: (k, v) => stored.set(k, v) };
    const context = { sanitizeEvent, errorCode, crypto: randomUUID ? webcrypto : { getRandomValues: a => webcrypto.getRandomValues(a) },
        sessionStorage: storage, localStorage: storage, navigator: { onLine: online, doNotTrack: dnt ? '1' : '0', userAgent: 'Safari' },
        window: { addEventListener() {} }, document: { readyState: 'complete', getElementById() {} },
        location: { pathname: '/recipe.html?id=secret', hostname: 'www.yum4you.com' }, performance: { getEntriesByType: () => [] }, setTimeout };
    runInNewContext(code + '\nthis.api = { trackEvent, startTelemetry };', context);
    return context.api;
}
test('collection respects opt-out, Do Not Track, offline and signed-out states', async () => {
    for (const options of [{ optOut: true }, { dnt: true }, { online: false }]) {
        const api = await collector(options); const events = [];
        api.startTelemetry(e => events.push(e), { isAnonymous: false }); api.trackEvent('scan_success');
        assert.equal(events.length, 0);
    }
    const api = await collector(); const events = [];
    api.startTelemetry(e => events.push(e), null); api.trackEvent('scan_success');
    api.startTelemetry(e => events.push(e), { isAnonymous: true });
    assert.equal(events.length, 0);
});
test('LAN fallback works, duplicate events are suppressed, failed writes stop collection', async () => {
    const api = await collector({ randomUUID: false }); const events = [];
    api.startTelemetry(e => { events.push(e); return Promise.reject(new Error('denied')); }, { isAnonymous: false });
    await new Promise(resolve => setImmediate(resolve));
    api.trackEvent('scan_success'); assert.equal(events.length, 1);
    const live = await collector(); const success = [];
    live.startTelemetry(e => success.push(e), { isAnonymous: false });
    live.trackEvent('page_view'); live.trackEvent('scan_success'); live.trackEvent('scan_success');
    assert.equal(success.length, 3);
});
