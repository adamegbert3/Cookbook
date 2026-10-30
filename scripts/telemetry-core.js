// Closed vocabulary: never persist messages, URLs, recipe content, or identities.
export const RELEASE = '2026.10-health-1';
export const EVENTS = ['page_view', 'page_load', 'runtime_error', 'scan_check', 'scan_success', 'scan_failure', 'import_success', 'import_failure'];
export const CODES = ['none', 'network', 'timeout', 'permission', 'model_missing', 'model_incompatible', 'invalid_output', 'image_decode', 'no_recipe', 'unknown'];
export const PAGES = ['index', 'homepage', 'recipe', 'favorites', 'weekly-menu', 'shopping-list', 'profile', 'settings', 'submit', 'review', 'admin', 'admin/scan', 'admin/import', 'admin/upload', 'admin/usage', 'other'];
export function pageKey(path) {
    const value = String(path).split(/[?#]/)[0].replace(/^\//, '').replace(/\.html$/, '') || 'index';
    return PAGES.includes(value) ? value : 'other';
}
export function errorCode(error) {
    const value = String(error?.code || '') + ' ' + String(error?.message || error || '');
    if (/permission|unauthorized|denied/i.test(value)) return 'permission';
    if (/timeout|timed out|abort/i.test(value)) return 'timeout';
    if (/model.*not found|pull.*model/i.test(value)) return 'model_missing';
    if (/cannot read photos|architecture|vision.*support|memory/i.test(value)) return 'model_incompatible';
    if (/decode|HEIC/i.test(value)) return 'image_decode';
    if (/JSON|malformed|cut short|recipe list/i.test(value)) return 'invalid_output';
    if (/fetch|network|reach Ollama|unexpected response|local helper/i.test(value)) return 'network';
    return 'unknown';
}
export function clientFamily(ua = '') {
    return {
        browser: /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other',
        os: /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : 'Other'
    };
}
export function sanitizeEvent(event, input = {}, context = {}) {
    if (!EVENTS.includes(event)) return null;
    const bounded = (n, max) => Math.min(max, Math.max(0, Math.round(Number(n) || 0)));
    return { event, page: pageKey(context.path), release: RELEASE,
        environment: context.production ? 'production' : 'local',
        ...clientFamily(context.userAgent),
        code: CODES.includes(input.code) ? input.code : 'none',
        durationMs: bounded(input.durationMs, 600000), count: bounded(input.count, 100),
        sessionId: /^[a-f0-9-]{36}$/.test(context.sessionId || '') ? context.sessionId : '00000000-0000-0000-0000-000000000000' };
}
export function summarizeEvents(rows) {
    const pages = {}, errors = {}, devices = {}, durations = [];
    let views = 0, success = 0, failed = 0;
    const sessions = new Set();
    for (const row of rows) {
        sessions.add(row.sessionId);
        if (row.event === 'page_view') { views++; pages[row.page] = (pages[row.page] || 0) + 1; devices[`${row.os} / ${row.browser}`] = (devices[`${row.os} / ${row.browser}`] || 0) + 1; }
        if (row.event === 'scan_success') success++;
        if (row.event === 'scan_failure') failed++;
        if (row.event === 'page_load' && Number.isFinite(row.durationMs)) durations.push(row.durationMs);
        if (row.code !== 'none' || row.event === 'runtime_error') {
            const key = `${row.code} · ${row.page} · ${row.os} / ${row.browser}`;
            errors[key] = (errors[key] || 0) + 1;
        }
    }
    durations.sort((a, b) => a - b);
    return { views, sessions: sessions.size, success, failed, pages, errors, devices,
        p75: durations.length ? durations[Math.ceil(durations.length * .75) - 1] : null };
}
