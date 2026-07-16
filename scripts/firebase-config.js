import { initializeApp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
// 1. ADD THIS LINE:
import { getFirestore, enableIndexedDbPersistence} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

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

// enableIndexedDbPersistence(db)
//     .then(() => {
//         console.log("💾 [FIRESTORE OFFLINE] IndexedDB Persistence successfully enabled!");
//     })
//     .catch((err) => {
//         console.error("⚠️ [FIRESTORE OFFLINE ERROR]:", err.code);
//         if (err.code == 'failed-precondition') {
//             console.warn("👉 Reason: Multiple tabs open. Close other tabs of this app!");
//         } else if (err.code == 'unimplemented') {
//             console.warn("👉 Reason: This browser doesn't support offline storage.");
//         }
//     });