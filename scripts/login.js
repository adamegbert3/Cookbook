// ==========================================
// LOGIN.JS (FINAL CLEAN VERSION)
// ==========================================

// 1. IMPORTS
// We import 'auth' and 'db' from your config file
import { auth, db } from './firebase-config.js'; 

// We import Auth tools (Login, Create User, Update Name)
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    updateProfile, 
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// We import Database tools (Save User Data)
import { 
    doc, 
    setDoc 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

// --- HELPER FUNCTIONS ---

function alertPlaceholder(message) {
    const msgText = document.getElementById('messageText');
    const msgBox = document.getElementById('messageBox');
    if (msgText && msgBox) {
        msgText.textContent = message;
        msgBox.classList.remove('hidden');
        msgBox.classList.add('flex');
    } else {
        alert(message);
    }
}

function showSignUp() {
    const signUp = document.getElementById("signUp");
    if(signUp) {
        signUp.classList.remove('hidden');
        signUp.classList.add('flex');
    }
}

function hideMessageBox() {
    const box = document.getElementById('messageBox');
    if(box) {
        box.classList.add('hidden');
        box.classList.remove('flex');
    }
}

function hideSignUpBox() {
    const box = document.getElementById('signUp');
    if(box) {
        box.classList.add('hidden');
        box.classList.remove('flex');
    }
}

function sendReset() {
    const box = document.getElementById('reset');
    if(box) {
        box.classList.remove('hidden');
        box.classList.add('flex');
    }
}

function submitReset() {
    const email = document.getElementById('emailReset').value;
    const box = document.getElementById('reset');
    if(box) {
        box.classList.add('hidden');
        box.classList.remove('flex');
    }
    
    sendPasswordResetEmail(auth, email).then(() => {
        alertPlaceholder("Password Reset sent");
    }).catch((error) => {
        alertPlaceholder(error.message);
    });
}

// --- MAIN LOGIN LOGIC ---

const loginForm = document.getElementById('loginForm');

if (loginForm) {
    loginForm.addEventListener('submit', function(event) {
        event.preventDefault(); // Stop refresh
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        signInWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                console.log("Logged in!");
                window.location.href = "homepage.html";
            })
            .catch((error) => {
                console.error("Login failed", error);
                alertPlaceholder(error.message);
            });
    });
}

// --- SIGN UP LOGIC ---

const signUpForm = document.getElementById('signUpForm');

if (signUpForm) {
    signUpForm.addEventListener('submit', function(event) {
        event.preventDefault();

        const name = document.getElementById('fullName').value;
        const email = document.getElementById('emailSign').value;
        const password = document.getElementById('passwordSign').value;

        createUserWithEmailAndPassword(auth, email, password)
            .then(async (userCredential) => {
                const user = userCredential.user;
                
                // 1. UPDATE AUTH PROFILE
                // This ensures "updateProfile" is only used once here
                await updateProfile(user, {
                    displayName: name
                });

                // 2. SAVE TO DATABASE
                try {
                    // We can use setDoc because we imported it at the top
                    await setDoc(doc(db, "users", user.uid), {
                        Name: name,
                        email: user.email,
                        role: "user",
                        favorites: [],
                        createdAt: new Date()
                    });
                    
                    console.log("Profile created for " + name);
                    window.location.href = "homepage.html";
                    
                } catch (error) {
                    console.error("Database Error:", error);
                    // Even if database fails, the account exists, so let them in
                    window.location.href = "homepage.html";
                }
            })
            .catch((error) => {
                alertPlaceholder(error.message);
            });
    });
}

// Attach functions to window so HTML buttons work
window.hideSignUpBox = hideSignUpBox;
window.hideMessageBox = hideMessageBox;
window.showSignUp = showSignUp;
window.alertPlaceholder = alertPlaceholder;
window.sendReset = sendReset;
window.submitReset = submitReset;