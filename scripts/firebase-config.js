import { initializeApp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp, increment, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

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
export const db = getFirestore(app);

// ==========================================
// OFFLINE MODE (free, built into Firebase/the browser — no billing required)
// Any recipe a user has opened stays readable with no signal, like Google
// Docs offline: Firestore caches document reads in IndexedDB, and the
// Service Worker below caches the app shell (HTML/CSS/JS) so the pages
// themselves still load with no connection.
// ==========================================
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn("[Offline] Persistence only works in one tab at a time — close other open tabs of this site.");
    } else if (err.code === 'unimplemented') {
        console.warn("[Offline] This browser doesn't support offline storage.");
    }
});

// Skip the Service Worker entirely on localhost/127.0.0.1 dev servers (Live
// Server, etc.) — otherwise it caches your local edits and you end up
// staring at yesterday's version wondering why your change isn't showing up.
const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);

if ('serviceWorker' in navigator && !isLocalDev) {
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
// One doc per calendar day in "site_visits", incremented once per signed-in
// browser session so the admin dashboard can show day/week/month usage
// without needing Firebase's paid Cloud Monitoring access.
// ==========================================
onAuthStateChanged(auth, (user) => {
    if (!user) return;

    try {
        const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const sessionFlag = `visit-logged-${todayKey}`;
        if (sessionStorage.getItem(sessionFlag)) return;

        setDoc(doc(db, "site_visits", todayKey), {
            date: todayKey,
            count: increment(1),
            lastUpdated: serverTimestamp()
        }, { merge: true }).then(() => {
            // Only mark today as logged once the write actually succeeds —
            // otherwise a blocked write (e.g. rules not deployed yet) would
            // silently mark the session as done and never retry.
            sessionStorage.setItem(sessionFlag, "true");
        }).catch((err) => {
            console.warn("[Usage] Could not record today's visit:", err.code || err.message);
        });
    } catch (e) { /* Never let usage tracking break the app */ }
});