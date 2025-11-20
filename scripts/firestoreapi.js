import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

// Your web app's Firebase configuration
const firebaseConfig = {
apiKey: "AIzaSyA7ILMR7YRqydfCMi-wnQ7QAXTZIGlYP6o",
authDomain: "cookbook-82676.firebaseapp.com",
projectId: "cookbook-82676",
storageBucket: "cookbook-82676.firebasestorage.app",
messagingSenderId: "672574462924",
appId: "1:672574462924:web:6aa1ce5722151605019b69"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const db = getFirestore(app)
const auth = getAuth(app)

export { db, auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail }