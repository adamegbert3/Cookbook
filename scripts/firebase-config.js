import { initializeApp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { initializeFirestore, doc, getDoc, setDoc, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA7ILMR7YRqydfCMi-wnQ7QAXTZIGlYP6o",
    authDomain: "cookbook-82676.firebaseapp.com",
    databaseURL: "https://cookbook-82676-default-rtdb.firebaseio.com/", // Make sure this line exists!
    projectId: "cookbook-82676",
    storageBucket: "cookbook-82676.firebasestorage.app",
    messagingSenderId: "672574462924",
    appId: "1:672574462924:web:6aa1ce5722151605019b69"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// ==========================================
// FIRESTORE TRANSPORT
// Firestore's default streaming connection (WebChannel) is what produced
// the constant console error:
//   "Fetch API cannot load https://firestore.googleapis.com/...Listen/channel...
//    due to access control checks."
// That request is the live-updates channel used by onSnapshot (family
// comments, the shopping list). Safari, some VPNs, and content blockers
// routinely break that streaming transport, which leaves the listener
// retrying forever and spamming the console — and can make the first load
// after sign-in feel slow while it retries.
//
// autoDetectLongPolling lets the SDK notice the streaming channel isn't
// working and quietly fall back to ordinary long-polling requests, which
// those environments allow. Everything else behaves identically.
// ==========================================
export const db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false
});

// ==========================================
// OFFLINE MODE
// We deliberately do NOT use Firestore's enableIndexedDbPersistence() here.
// That feature must fully initialize its own local database before ANY
// other Firestore read is allowed to proceed — on a device that's already
// set it up, that's instant, but on a first-time visit it can be slow or
// simply hang depending on the browser's storage/privacy settings, which
// blocks every read on the page behind it. That's exactly the bug we hit:
// it worked on devices that already had it cached and silently broke the
// site for everyone else. Offline support instead comes from two simpler,
// independent, non-blocking pieces: the Service Worker below (app shell:
// HTML/CSS/JS) and plain localStorage caching of recipe data as it's
// viewed (see recipePage.js / main.js) — neither can stall a live read.
// ==========================================

// Skip the Service Worker entirely on localhost/127.0.0.1 dev servers (Live
// Server, etc.) — otherwise it caches your local edits and you end up
// staring at yesterday's version wondering why your change isn't showing up.
const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);

if ('serviceWorker' in navigator && !isLocalDev) {
    // When a new deploy ships a new sw.js, the new worker takes over
    // (self.clients.claim() in sw.js) but the ALREADY-OPEN page is still
    // running old JS in memory. Reload once, automatically, so a fresh
    // deploy actually reaches people instead of needing a manual hard
    // refresh — this is the standard "auto-update" pattern for PWAs.
    let hasReloadedForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hasReloadedForUpdate) return;
        hasReloadedForUpdate = true;
        window.location.reload();
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => console.log('[Offline] Service worker active, scope:', registration.scope))
            .catch((error) => console.error('[Offline] Service worker registration failed:', error));
    });
} else if (isLocalDev && 'serviceWorker' in navigator) {
    // Clean up any Service Worker a previous local test may have registered,
    // so local testing always reflects exactly what's on disk.
    navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
    });
    caches.keys().then((names) => names.forEach((name) => caches.delete(name)));
}

// ==========================================
// FREE USAGE TRACKING (no Cloud Functions / no billing required)
// Two things get written once per signed-in browser session per day:
//  1. An anonymous daily counter in "site_visits" (no identity) — feeds the
//     admin dashboard's Site Usage chart.
//  2. A per-person doc in "site_visits_log" (one per person per day, via a
//     deterministic id) — feeds the Activity roster, so simply opening the
//     site (not just opening a specific recipe) shows up there too. This
//     was previously missing, which made Site Usage's count and the
//     Activity roster look mismatched even though nothing was broken —
//     they were just measuring different things.
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    try {
        const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const sessionFlag = `visit-logged-${todayKey}`;
        if (sessionStorage.getItem(sessionFlag)) return;

        let viewerName = user.email ? user.email.split('@')[0] : "Family Member";
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            if (userSnap.exists() && userSnap.data().Name) viewerName = userSnap.data().Name;
        } catch (e) { /* fall back to the email-based name above */ }

        await Promise.all([
            setDoc(doc(db, "site_visits", todayKey), {
                date: todayKey,
                count: increment(1),
                lastUpdated: serverTimestamp()
            }, { merge: true }),
            setDoc(doc(db, "site_visits_log", `${user.uid}_${todayKey}`), {
                uid: user.uid,
                viewerName,
                date: todayKey,
                timestamp: serverTimestamp()
            }, { merge: true })
        ]);

        // Only mark today as logged once both writes actually succeed —
        // otherwise a blocked write (e.g. rules not deployed yet) would
        // silently mark the session as done and never retry.
        sessionStorage.setItem(sessionFlag, "true");
    } catch (err) {
        console.warn("[Usage] Could not record today's visit:", err.code || err.message);
    }
});