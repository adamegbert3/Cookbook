// 1. Import Auth and Database
import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from "./firestoreapi.js";
// We need 'db' to save the user profile, so import it from your config
import { db } from "./firebase-config.js"; 
// We need these tools to write to the database
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

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

// --- SIGN UP LOGIC (UPDATED) ---

const signUpForm = document.getElementById('signUpForm');

if (signUpForm) {
    signUpForm.addEventListener('submit', function(event) {
        event.preventDefault(); // Stop refresh

        const email = document.getElementById('emailSign').value;
        const password = document.getElementById('passwordSign').value;

        createUserWithEmailAndPassword(auth, email, password)
            .then(async (userCredential) => {
                // 1. The Account is created in Authentication...
                const user = userCredential.user;
                console.log("Account created for:", user.email);

                // 2. NOW we create their folder in the Database
                try {
                    await setDoc(doc(db, "users", user.uid), {
                        email: user.email,
                        role: "user",      // You can manually change this to 'admin' in Console later
                        favorites: [],     // Empty list ready for hearts!
                        createdAt: new Date()
                    });
                    console.log("User profile saved to Firestore!");
                    
                    // 3. ONLY redirect after the profile is saved
                    window.location.href = "homepage.html";
                    
                } catch (error) {
                    console.error("Error saving profile:", error);
                    alertPlaceholder("Account created, but profile failed. Check console.");
                }
            })
            .catch((error) => {
                // Handle errors like "Email already in use"
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