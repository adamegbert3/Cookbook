import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const resources = dirname(fileURLToPath(import.meta.url));
const root = readFileSync(join(resources, 'project.path'), 'utf8').trimEnd();
const stateDir = join(homedir(), 'Library', 'Application Support', 'Cookbook Scanner');
const logDir = join(homedir(), 'Library', 'Logs', 'Cookbook Scanner');
const statePath = join(stateDir, 'helper.json');
const base = 'http://127.0.0.1:8080';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function health() {
    try {
        const response = await fetch(`${base}/api/scanner-health`, { signal: AbortSignal.timeout(1000) });
        if (!response.ok) return null;
        const data = await response.json();
        return data.service === 'cookbook-scanner' ? data : null;
    } catch { return null; }
}
function savedState() {
    try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return null; }
}
async function stopOwnedHelper() {
    const state = savedState(), live = await health();
    // Never terminate a process based on a stale PID alone.
    if (state && live?.instance === state.instance && Number.isInteger(state.pid) && state.pid > 0) {
        try { process.kill(state.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        writeFileSync(statePath, '{}');
    }
}
try {
    if (process.platform !== 'darwin') throw Error('This launcher is for macOS.');
    if (process.argv[2] === 'stop') {
        await stopOwnedHelper();
    } else {
        if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Install Node.js LTS (22 or newer) from nodejs.org, then reopen Cookbook Scanner.');
        const server = join(root, 'local-tools', 'scan-recipe', 'serve-locally.mjs');
        if (!existsSync(server)) throw Error('The Cookbook folder has moved. Run Install-Mac-Scanner.command from its new location to reconnect the app.');
        try { execFileSync('/usr/bin/open', ['-a', 'Ollama'], { stdio: 'ignore' }); }
        catch { throw Error('Install Ollama in Applications from ollama.com/download/mac, then reopen Cookbook Scanner.'); }
        mkdirSync(stateDir, { recursive: true }); mkdirSync(logDir, { recursive: true });
        const live = await health(), state = savedState();
        if (live && (!state || live.instance !== state.instance)) {
            throw Error('Another Cookbook helper is already running. Stop the old helper (Control-C in its Terminal), then reopen Cookbook Scanner.');
        }
        if (!live) {
            const instance = randomUUID();
            const fd = openSync(join(logDir, 'helper.log'), 'a');
            const child = spawn(process.execPath, [server], { cwd: root, detached: true,
                env: { ...process.env, HOST: '127.0.0.1', PORT: '8080', COOKBOOK_INSTANCE: instance, OLLAMA_BASE_URL: 'http://127.0.0.1:11434' },
                stdio: ['ignore', fd, fd] });
            closeSync(fd);
            await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
            child.unref();
            writeFileSync(statePath, JSON.stringify({ pid: child.pid, instance }));
            let ready = false;
            for (let attempt = 0; attempt < 30; attempt++) {
                if ((await health())?.instance === instance) { ready = true; break; }
                await pause(200);
            }
            if (!ready) {
                // This is our newly spawned process, not a PID read from disk.
                child.kill();
                throw Error('The helper could not start. Port 8080 may be occupied. Stop any old helper and try again. Details: ~/Library/Logs/Cookbook Scanner/helper.log');
            }
        }
        execFileSync('/usr/bin/open', ['http://localhost:8080/admin/scan.html']);
    }
} catch (error) { console.error(error.message); process.exitCode = 1; }
