import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function launch({ action = 'start', live = null, saved = null, occupied = false } = {}) {
    const calls = { opens: [], spawned: [], kills: [], errors: [] };
    let state = saved;
    const source = (await readFile(new URL('./mac-launcher.mjs', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?\n/gm, '').replace('import.meta.url', JSON.stringify(new URL('./mac-launcher.mjs', import.meta.url).href));
    const context = { dirname, join, fileURLToPath, homedir: () => '/home/test', randomUUID: () => 'new-instance',
        readFileSync: p => p.endsWith('project.path') ? '/Documents/Cookbook with spaces' : JSON.stringify(state),
        writeFileSync: (p, data) => { state = JSON.parse(data); }, mkdirSync() {}, openSync: () => 42, closeSync() {}, existsSync: () => true,
        execFileSync: (cmd, args) => calls.opens.push([cmd, args]),
        fetch: async url => url.endsWith('/show') ? { ok: true, json: async () => ({ capabilities: ['vision'] }) } : ({ ok: !!live, json: async () => live }), AbortSignal,
        spawn: (cmd, args, options) => {
            calls.spawned.push({ cmd, args, options });
            const child = new EventEmitter(); child.pid = 123; child.unref = () => {}; child.kill = () => calls.kills.push('child');
            queueMicrotask(() => { child.emit('spawn'); if (!occupied) live = { service: 'cookbook-scanner', instance: 'new-instance' }; });
            return child;
        },
        process: { platform: 'darwin', versions: { node: '22.0.0' }, argv: ['node','launcher',action], execPath: '/node', env: {}, kill: pid => calls.kills.push(pid) },
        console: { error: msg => calls.errors.push(msg) }, setTimeout: resolve => { queueMicrotask(resolve); } };
    await runInNewContext(`(async () => {${source}\n})()`, context);
    return calls;
}
test('Dock launch starts Ollama and a detached loopback helper without Terminal', async () => {
    const c = await launch();
    assert.equal(c.errors.length, 0); assert.equal(c.spawned.length, 1);
    assert.equal(c.spawned[0].options.detached, true);
    assert.equal(c.spawned[0].options.env.HOST, '127.0.0.1');
    assert.equal(c.spawned[0].options.stdio[0], 'ignore');
    assert.ok(c.opens.some(([, args]) => args.includes('Ollama')));
    assert.ok(c.opens.some(([, args]) => args.includes('http://localhost:8080/admin/scan.html')));
});
test('reopening reuses the owned helper rather than starting a duplicate', async () => {
    const c = await launch({ live: { service: 'cookbook-scanner', instance: 'ours' }, saved: { instance: 'ours', pid: 123 } });
    assert.equal(c.spawned.length, 0); assert.equal(c.errors.length, 0);
});
test('quit stops only the helper matching the saved instance, not a stale PID', async () => {
    const saved = { instance: 'ours', pid: 123 };
    const ours = await launch({ action: 'stop', saved, live: { service: 'cookbook-scanner', instance: 'ours' } });
    assert.deepEqual(ours.kills, [123]);
    const other = await launch({ action: 'stop', saved, live: { service: 'cookbook-scanner', instance: 'someone-else' } });
    assert.deepEqual(other.kills, []);
});
test('occupied port reports failure and does not open an unrelated service', async () => {
    const c = await launch({ occupied: true });
    assert.match(c.errors[0], /Port 8080/);
    assert.ok(!c.opens.some(([, args]) => args.includes('http://localhost:8080/admin/scan.html')));
});
