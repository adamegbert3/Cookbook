import { sanitizeEvent, errorCode } from './telemetry-core.js';

let writer = null, enabledUser = false, disabled = false, sent = 0;
// randomUUID is unavailable on plain HTTP LAN pages used for phone scanning.
let sessionId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const n = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
        return (c === 'x' ? n : (n & 3) | 8).toString(16);
    });
const recent = new Map();
try {
    sessionId = sessionStorage.getItem('diagnostics-session') || sessionId;
    sessionStorage.setItem('diagnostics-session', sessionId);
    sent = Math.max(0, Number(sessionStorage.getItem('diagnostics-count')) || 0);
} catch { /* Memory-only fallback when storage is blocked. */ }
export function diagnosticsEnabled() {
    try { return localStorage.getItem('cookbook-diagnostics') !== 'off' && navigator.doNotTrack !== '1'; }
    catch { return false; }
}
export function trackEvent(name, details = {}) {
    // Diagnostics must never prevent cooking, saving, or scanning.
    try {
        if (!writer || !enabledUser || disabled || !diagnosticsEnabled() || !navigator.onLine || sent >= 200) return;
        const event = sanitizeEvent(name, details, { path: location.pathname, sessionId,
            userAgent: navigator.userAgent, production: ['yum4you.com', 'www.yum4you.com'].includes(location.hostname) });
        if (!event) return;
        const key = `${name}:${event.code}`;
        // Only suppress repeated page observations and error storms. Every completed
        // file scan/import is a separate outcome, even if it finishes quickly.
        const deduplicate = ['page_view', 'page_load', 'runtime_error', 'scan_check'].includes(name);
        if (deduplicate && Date.now() - (recent.get(key) || 0) < 3000) return;
        recent.set(key, Date.now()); sent++;
        try { sessionStorage.setItem('diagnostics-count', String(sent)); } catch {}
        Promise.resolve(writer(event)).catch(() => { disabled = true; });
    } catch { /* Telemetry is best-effort, with no retries or recursive logging. */ }
}
export function startTelemetry(write, user) {
    writer = write;
    enabledUser = !!user && !user.isAnonymous;
    if (!enabledUser) return;
    trackEvent('page_view');
    const recordLoad = () => {
        const entry = performance.getEntriesByType('navigation')[0];
        if (entry?.loadEventEnd > 0) trackEvent('page_load', { durationMs: entry.loadEventEnd });
    };
    if (document.readyState === 'complete') recordLoad();
    else window.addEventListener('load', () => setTimeout(recordLoad, 0), { once: true });
}
window.addEventListener('error', event => trackEvent('runtime_error', { code: errorCode(event.error) }));
window.addEventListener('unhandledrejection', event => trackEvent('runtime_error', { code: errorCode(event.reason) }));

function setupPreference() {
    const toggle = document.getElementById('diagnostics-toggle');
    if (!toggle) return;
    toggle.checked = diagnosticsEnabled();
    toggle.disabled = navigator.doNotTrack === '1';
    toggle.addEventListener('change', () => {
        try { localStorage.setItem('cookbook-diagnostics', toggle.checked ? 'on' : 'off'); }
        catch { toggle.checked = false; }
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupPreference, { once: true });
else setupPreference();
