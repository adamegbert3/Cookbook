// 1. Import from your API file
import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from "./firestoreapi.js";

// We don't need the Firestore imports anymore!
// import { collection... } from ...firebase-firestore.js"; <-- DELETE THIS

// --- HELPER FUNCTIONS ---

function alertPlaceholder(message) {
    const msgText = document.getElementById('messageText');
    const msgBox = document.getElementById('messageBox');
    if (msgText && msgBox) {
        msgText.textContent = message;
        msgBox.classList.remove('hidden');
        msgBox.classList.add('flex');
    } else {
        alert(message); // Fallback if HTML elements are missing
    }
}

function showSignUp() {
    document.getElementById("signUp").classList.remove('hidden');
    document.getElementById('signUp').classList.add('flex');
}

function hideMessageBox() {
    document.getElementById('messageBox').classList.add('hidden');
    document.getElementById('messageBox').classList.remove('flex');
}

function hideSignUpBox() {
    document.getElementById('signUp').classList.add('hidden');
    document.getElementById('signUp').classList.remove('flex');
}

function sendReset() {
    document.getElementById('reset').classList.remove('hidden');
    document.getElementById('reset').classList.add('flex');
}

function submitReset() {
    const email = document.getElementById('emailReset').value;
    document.getElementById('reset').classList.add('hidden');
    document.getElementById('reset').classList.remove('flex');
    
    sendPasswordResetEmail(auth, email).then(() => {
        alertPlaceholder("Password Reset sent");
    }).catch((error) => {
        alertPlaceholder(error.message);
    });
}

// --- MAIN LOGIN LOGIC ---

// 1. Check if the form exists before attaching listener to prevent errors
const loginForm = document.getElementById('loginForm');

if (loginForm) {
    loginForm.addEventListener('submit', function(event) {
        // THIS IS THE MOST IMPORTANT LINE:
        event.preventDefault(); // Stop the page from refreshing
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        signInWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                // Success! Redirect immediately.
                // We removed the code that looked for "user_prof" in Firestore
                // because it was crashing the script.
                console.log("Logged in!");
                window.location.href = "homepage.html";
            })
            .catch((error) => {
                console.error("Login failed", error);
                alertPlaceholder(error.message);
            });
    });
} else {
    console.error("Could not find element with id 'loginForm'");
}

// --- SIGN UP LOGIC ---

const signUpForm = document.getElementById('signUpForm');

if (signUpForm) {
    signUpForm.addEventListener('submit', function(event) {
        event.preventDefault(); // Stop refresh

        const email = document.getElementById('emailSign').value;
        const password = document.getElementById('passwordSign').value;

        createUserWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                // Account created! Go to homepage.
                console.log("Account created!");
                window.location.href = "homepage.html";
            })
            .catch((error) => {
                alertPlaceholder(error.message);
            });
    });
}

// Attach functions to window so HTML onclick="..." works
window.hideSignUpBox = hideSignUpBox;
window.hideMessageBox = hideMessageBox;
window.showSignUp = showSignUp;
window.alertPlaceholder = alertPlaceholder;
window.sendReset = sendReset;
window.submitReset = submitReset;