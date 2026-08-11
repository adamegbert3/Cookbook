// Fires the local Drive-sync helper right after an admin save, so the
// family member reading recipes from Drive (because they don't have
// internet access to the live site) doesn't fall behind. See
// local-tools/sync-to-drive/README.md for the full picture.
//
// This silently does nothing when the page isn't being served by
// local-tools/scan-recipe/serve-locally.mjs (i.e. this is the live https
// site) — there's no local server there to receive the request. That's
// fine: the background schedule installed by
// local-tools/sync-to-drive/install-schedule.sh still catches those changes
// periodically, so nothing is ever permanently missed, just delayed.
export async function triggerDriveSyncSilently() {
    try {
        const res = await fetch('/api/sync-to-drive', { method: 'POST' });
        if (res.ok) console.log('☁️ [DRIVE SYNC] Triggered in the background — will finish syncing shortly.');
    } catch (e) {
        // Not running via the local server right now — the scheduled sync
        // will pick this change up instead.
    }
}
