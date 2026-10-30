import { collection, getDocs, query, where, orderBy, limit, Timestamp } from 'https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js';
import { summarizeEvents } from './telemetry-core.js';

function listCounts(id, values, empty) {
    const container = document.getElementById(id);
    container.replaceChildren();
    const sorted = Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!sorted.length) { const p = document.createElement('p'); p.className = 'health-muted'; p.textContent = empty; container.append(p); return; }
    for (const [label, count] of sorted) {
        const row = document.createElement('div'); row.className = 'health-row';
        const text = document.createElement('span'); text.textContent = label;
        const badge = document.createElement('strong'); badge.textContent = count.toLocaleString();
        row.append(text, badge); container.append(row);
    }
}
export function renderHealth(rows, environment, capped) {
    const filtered = rows.filter(r => r.environment === environment);
    const summary = summarizeEvents(filtered);
    const totalScans = summary.success + summary.failed;
    document.getElementById('health-views').textContent = summary.views.toLocaleString();
    document.getElementById('health-sessions').textContent = summary.sessions.toLocaleString();
    document.getElementById('health-scan-rate').textContent = totalScans ? `${Math.round(summary.success / totalScans * 100)}%` : '—';
    document.getElementById('health-scan-detail').textContent = totalScans ? `${summary.success} succeeded · ${summary.failed} failed` : 'No completed scans recorded';
    document.getElementById('health-speed').textContent = summary.p75 === null ? '—' : `${(summary.p75 / 1000).toFixed(1)}s`;
    const speedDetail = document.getElementById('health-speed-detail');
    if (speedDetail) speedDetail.textContent = summary.loadSamples
        ? summary.loadSamples + ' page loads' + (summary.loadSamples < 20 ? ' · early sample' : '') + ' · not recipe readiness or LCP'
        : 'No load samples yet · not recipe readiness or LCP';
    listCounts('health-features', summary.pages, 'Feature visits will appear after members use the updated app.');
    listCounts('health-errors', summary.errors, 'No errors recorded in this sample. This does not guarantee there were no failures.');
    listCounts('health-devices', summary.devices, 'No device groups recorded yet.');
    document.getElementById('health-status').textContent = `${filtered.length} recorded events · past 7 days · ${environment === 'local' ? 'local / preview' : 'production'}${capped ? ' · showing a capped sample of the latest 500 events across environments' : ''}.`;
    const guidance = document.getElementById('health-next');
    const errorNames = Object.keys(summary.errors).join(' ');
    guidance.textContent = !filtered.length ? 'Start with a few normal visits and one scan. Check back after the updated code and Firestore rules are deployed.'
        : /model_missing|model_incompatible/.test(errorNames) ? 'Prioritize scanner setup: install the selected vision model and confirm it can load on the affected computer.'
        : /network|permission/.test(errorNames) ? 'Prioritize connection failures: check the local helper, sign-in state, and deployed Firestore rules.'
        : summary.p75 > 4000 ? 'Page loads are taking over four seconds for part of this sample. Check large assets and slow network requests before adding more homepage content.'
        : summary.failed ? 'Review scanner failures by browser and operating system below. Try the same photo on an affected device.'
        : 'Keep collecting normal usage. Use feature visits to decide which workflows deserve the next round of improvements.';
}
export async function loadHealthDashboard(db) {
    const status = document.getElementById('health-status');
    if (!status) return;
    const button = document.getElementById('health-refresh');
    const select = document.getElementById('health-environment');
    button.onclick = () => loadHealthDashboard(db);
    button.disabled = true; status.textContent = 'Loading recorded diagnostics…';
    try {
        const snap = await getDocs(query(collection(db, 'diagnostic_events'), where('createdAt', '>=', Timestamp.fromMillis(Date.now() - 7 * 86400000)), orderBy('createdAt', 'desc'), limit(500)));
        const rows = snap.docs.map(doc => doc.data());
        const render = () => renderHealth(rows, select.value, rows.length === 500);
        select.onchange = render; render();
    } catch (error) {
        status.textContent = error.code === 'permission-denied'
            ? 'Diagnostics are unavailable. Sign in as an admin and deploy the updated Firestore rules.'
            : 'Could not load diagnostics. Check your connection and try Refresh.';
    } finally { button.disabled = false; }
}
