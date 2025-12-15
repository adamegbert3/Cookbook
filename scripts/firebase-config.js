import { initializeApp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
// 1. ADD THIS LINE:
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

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
// 2. ADD THIS LINE:
export const db = getFirestore(app);