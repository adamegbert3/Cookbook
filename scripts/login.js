import { db, auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from "./firestoreapi.js"
import { collection, addDoc, getDoc, doc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

function alertPlaceholder(message) {
    document.getElementById('messageText').textContent = message;
    document.getElementById('messageBox').classList.remove('hidden');
    document.getElementById('messageBox').classList.add('flex');
}

function showSignUp() {
    document.getElementById("signUp").classList.remove('hidden');
    document.getElementById('signUp').classList.add('flex')
}

function hideMessageBox() {
    document.getElementById('messageBox').classList.add('hidden');
    document.getElementById('messageBox').classList.remove('flex');
}

function hideSignUpBox() {
    document.getElementById('signUp').classList.add('hidden')
    document.getElementById('signUp').classList.remove('flex')
}

function sendReset() {
    document.getElementById('reset').classList.remove('hidden')
    document.getElementById('reset').classList.add('flex')
}

function submitReset() {
    const email = document.getElementById('emailReset').value;
    document.getElementById('reset').classList.add('hidden')
    document.getElementById('reset').classList.remove('flex')
    sendPasswordResetEmail(auth, email).then(() => {
        alertPlaceholder("Password Reset sent")
    }).catch((error) => {
        alertPlaceholder(error.message)
    })

}

// JavaScript to handle form submission
document.getElementById('loginForm').addEventListener('submit', function(event) {
    event.preventDefault(); // Prevent the default form submission (page reload)
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    let errorMessage
    
    // Log data for demonstration (replace this with your actual authentication logic)
    signInWithEmailAndPassword(auth, email, password).then(async (userCredential) => {
        const user = doc(db, "users", email);
        const user_prof = await getDoc(user)
        window.location.href = "homepage.html"
    }).catch((error) => {
        errorMessage = error.message;
        alertPlaceholder(errorMessage)
    });
});

document.getElementById('signUpForm').addEventListener('submit', function(event) {
    event.preventDefault()

    const email = document.getElementById('emailSign').value;
    const password = document.getElementById('passwordSign').value;

    createUserWithEmailAndPassword(auth, email, password).then(
        (async (userCredential) => {
            const user = doc(db, "users", email);
            const user_prof = await getDoc(user)
            window.location.href = "homepage.html"
        })
    )

});

window.hideSignUpBox = hideSignUpBox;
window.hideMessageBox = hideMessageBox;
window.showSignUp = showSignUp;
window.alertPlaceholder = alertPlaceholder;
window.sendReset = sendReset;
window.submitReset = submitReset;