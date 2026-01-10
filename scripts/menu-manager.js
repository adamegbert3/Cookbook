import { db, auth } from './firebase-config.js'; 
import { 
    doc, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

// --- 1. ADD RECIPE TO MENU ---
// Saves recipe info + ingredients to a specific day
export async function addRecipeToMenu(day, mealType, recipe) {
    if (!auth.currentUser) return alert("Please sign in to save menus!");
    
    const userRef = doc(db, "users", auth.currentUser.uid, "weekly_menu", day);
    
    // We store a simplified version of the recipe to save space
    const mealData = {
        id: recipe.id,
        name: recipe.name,
        ingredients: recipe.recipeIngredient || recipe.ingredients || [],
        type: mealType, // "Breakfast", "Lunch", etc.
        uniqueId: Date.now() // Allows adding the same recipe twice in one day
    };

    // "arrayUnion" adds it to the list without deleting existing meals
    try {
        await setDoc(userRef, { meals: arrayUnion(mealData) }, { merge: true });
        alert(`Added ${recipe.name} to ${day} for ${mealType}!`);
    } catch (e) {
        console.error(e);
        alert("Error saving menu.");
    }
}

// --- 2. MANAGE CUSTOM ITEMS ---
// Adds a custom text item (like "Milk") to the list
export async function addCustomItem(itemText) {
    if (!auth.currentUser) return;
    const ref = doc(db, "users", auth.currentUser.uid, "weekly_menu", "custom_items");
    
    try {
        // Use a timestamp id so we can have duplicate names if needed
        const newItem = { text: itemText, id: Date.now(), isChecked: false };
        await setDoc(ref, { items: arrayUnion(newItem) }, { merge: true });
    } catch (e) { console.error(e); }
}

// --- 3. HANDLE CHECKMARKS (THE SAVING FEATURE) ---
// Toggles the "checked" state of an item
export async function toggleItemCheck(day, itemText, isChecked) {
    if (!auth.currentUser) return;
    
    // We store checked items in a separate "state" document to keep it clean
    const stateRef = doc(db, "users", auth.currentUser.uid, "weekly_menu", "shopping_state");
    
    try {
        if (isChecked) {
            await setDoc(stateRef, { checked: arrayUnion(itemText) }, { merge: true });
        } else {
            await updateDoc(stateRef, { checked: arrayRemove(itemText) });
        }
    } catch (e) { console.error(e); }
}

// --- 4. LOAD EVERYTHING (Real-time Listener) ---
// This enables the page to update instantly when you add/remove things
export function listenToMenu(callback) {
    if (!auth.currentUser) return;
    
    // Listen to the whole "weekly_menu" collection
    // Note: Firestore listeners on subcollections are tricky, 
    // so for this simple app, we might just fetch them once or 
    // use a slightly different structure if you need distinct real-time updates.
    // For now, let's just fetch once to keep it simple, or pass a 'reload' function.
}