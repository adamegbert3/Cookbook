// ==========================================
// 1. IMPORTS & SETUP
// ==========================================
import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
    serverTimestamp, arrayUnion, arrayRemove, query, where, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// Global Variables
let allRecipes = []; 
let userFavorites = []; 
window.currentShoppingList = []; // For the shopping list

console.log("✅ MAIN.JS VERSION 3.0 LOADED"); // Check your console for this!

// ==========================================
// 2. AUTHENTICATION & STARTUP
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("Logged in as:", user.email);
        
        // 1. Load User Favorites
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            if (userSnap.exists()) {
                userFavorites = userSnap.data().favorites || [];
            }
        } catch (err) { console.error("Error loading profile:", err); }

        // 2. Load Content
        const recipesGrid = document.getElementById('recipes');
        if (recipesGrid) loadAllRecipes(); // Homepage
        
        // 3. Load Page Specifics
        if (document.getElementById('chefNotes')) loadUserNote(); // Recipe Page
        if (document.getElementById('commentsList')) loadComments(); // Recipe Page
        if (document.getElementById('plan-Mon')) loadMealPlan(); // Homepage

    } else {
        console.log("User is guest.");
        // Guest handling logic here if needed
    }
});

// ==========================================
// 3. RECIPE DISPLAY LOGIC
// ==========================================
async function loadAllRecipes() {
    const container = document.getElementById('recipes');
    if (!container) return;

    container.innerHTML = "<p>Loading recipes...</p>";

    try {
        const querySnapshot = await getDocs(collection(db, "recipes"));
        allRecipes = [];

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            allRecipes.push({ id: doc.id, ...data });
        });

        // Sort A-Z
        allRecipes.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        renderRecipes(allRecipes);

    } catch (error) {
        console.error("Error loading recipes:", error);
        container.innerHTML = "<p>Error loading recipes.</p>";
    }
}

function renderRecipes(list) {
    const container = document.getElementById('recipes');
    if(!container) return;
    
    let html = '';
    list.forEach(recipe => html += RecipeTemplate(recipe));
    container.innerHTML = html;

    // Add Click Listeners
    document.querySelectorAll(".recipe-card").forEach(card => {
        card.addEventListener("click", (e) => {
            // Don't click if they hit the heart button
            if(e.target.closest('.heart-btn')) return;

            const name = card.getAttribute("data-name");
            const selectedRecipe = allRecipes.find(r => r.name === name);
            
            // Save data and go
            localStorage.setItem("currentRecipeData", JSON.stringify(selectedRecipe));
            const slug = selectedRecipe.name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
            window.location.href = `recipe.html?id=${slug}`;
        });
    });
}

function RecipeTemplate(recipe) {
    const tags = recipe.tags || []; 
    const author = recipe.author || "The Egbert Family";
    const isReviewed = recipe.reviewed === true;
    const statusIcon = isReviewed ? "✅" : "❌";
    const badgeColorClass = isReviewed ? "badge-green" : "badge-red";
    const isFav = userFavorites.includes(recipe.id);
    const heartIcon = isFav ? "❤️" : "🤍";

    return `
    <div class="recipe-card" data-name="${recipe.name}">
        <button class="heart-btn card-heart" onclick="toggleHeart(event, '${recipe.id}')">
            ${heartIcon}
        </button>
        <div class="status-badge ${badgeColorClass}">Reviewed: ${statusIcon}</div>
        <div id="info">
            <div id="tags">${tags.map(t => `<p>${t}</p>`).join('')}</div>
            <h2>${recipe.name}</h2>
        </div>
        <div id="author"><p>From: ${author}</p></div>
    </div>`;
}

// ==========================================
// 4. SHOPPING LIST (THE FIX)
// ==========================================

window.openShoppingModal = async function() {
    const user = auth.currentUser;
    if (!user) return alert("Please log in to use the Shopping List.");

    const modal = document.getElementById('shoppingModal');
    if(modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
    }
    document.getElementById('shopping-status').style.display = 'block';
    document.getElementById('shopping-list-container').style.display = 'none';
    document.getElementById('shopping-status').innerText = "Syncing with cloud...";

    try {
        const listRef = doc(db, "shopping_lists", user.uid);
        const docSnap = await getDoc(listRef);

        if (docSnap.exists() && docSnap.data().items.length > 0) {
            renderShoppingList(docSnap.data().items);
        } else {
            await generateFromPlan();
        }
    } catch (error) {
        console.error("Error loading list:", error);
    }
};

window.generateFromPlan = async function() {
    const plan = JSON.parse(localStorage.getItem('mealPlan')) || {};
    const recipes = Object.values(plan); 

    if (recipes.length === 0) {
        document.getElementById('shopping-status').innerText = "Meal plan is empty.";
        renderShoppingList([]); 
        return;
    }
    
    document.getElementById('shopping-status').innerText = "Finding ingredients...";
    
    try {
        const snapshot = await getDocs(collection(db, "recipes"));
        let newList = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            const rName = data.name || data.title || "Untitled";
            
            if (recipes.includes(rName)) {
                newList.push({ text: rName, type: 'header', checked: false });

                // --- SMART INGREDIENT CHECKER ---
                // We check recipeIngredient (from your recipePage.js) AND other variations
                let raw = data.recipeIngredient || data.ingredients || data.Ingredients || data.recipeIngredients || [];
                
                if (Array.isArray(raw)) {
                    raw.forEach(i => newList.push({ text: i, type: 'item', checked: false }));
                } 
                else if (typeof raw === 'string') {
                    let lines = raw.split(/\r?\n/);
                    if(lines.length === 1 && raw.includes(',')) lines = raw.split(',');
                    lines.forEach(line => {
                        if(line.trim()) newList.push({ text: line.trim(), type: 'item', checked: false });
                    });
                } 
                else {
                    newList.push({ text: "⚠️ (No ingredients found - Check Database)", type: 'item', checked: false });
                }
            }
        });

        await saveListToCloud(newList);
        renderShoppingList(newList);

    } catch (error) {
        console.error(error);
        document.getElementById('shopping-status').innerText = "Error reading recipes.";
    }
};

function renderShoppingList(items) {
    const listEl = document.getElementById('shopping-ul');
    const container = document.getElementById('shopping-list-container');
    const status = document.getElementById('shopping-status');
    
    window.currentShoppingList = items;
    if(listEl) listEl.innerHTML = "";
    
    if (items.length === 0) {
        if(status) { status.innerText = "List is empty."; status.style.display = 'block'; }
        if(container) container.style.display = 'none';
        return;
    }

    items.forEach((item, index) => {
        if (item.type === 'header') {
            listEl.innerHTML += `
                <li style="margin-top: 15px; font-weight: bold; color: #0a4d74; border-bottom: 2px solid #eee; padding-bottom: 5px;">
                    ${item.text}
                </li>`;
        } else {
            const isChecked = item.checked ? 'text-decoration: line-through; color: #ccc;' : 'color: #333;';
            const boxColor = item.checked ? '#10b981' : 'transparent';
            const border = item.checked ? '#10b981' : '#ddd';
            const checkIcon = item.checked ? '✓' : '';

            listEl.innerHTML += `
                <li onclick="toggleItem(${index})" style="padding: 10px 0; border-bottom: 1px solid #f9f9f9; cursor: pointer; display: flex; align-items: center; gap: 12px;">
                    <div style="width: 20px; height: 20px; border: 2px solid ${border}; background: ${boxColor}; border-radius: 4px; display:flex; align-items:center; justify-content:center; color:white; font-size:12px;">${checkIcon}</div>
                    <span style="font-size: 15px; ${isChecked}">${item.text}</span>
                </li>`;
        }
    });

    if(status) status.style.display = 'none';
    if(container) container.style.display = 'block';
}

window.toggleItem = async function(index) {
    window.currentShoppingList[index].checked = !window.currentShoppingList[index].checked;
    renderShoppingList(window.currentShoppingList);
    await saveListToCloud(window.currentShoppingList);
};

async function saveListToCloud(items) {
    const user = auth.currentUser;
    if(!user) return;
    try {
        await setDoc(doc(db, "shopping_lists", user.uid), { items: items, updatedAt: serverTimestamp() });
    } catch (e) { console.error("Save failed:", e); }
}

window.clearShoppingList = async function() {
    if(!confirm("Clear list?")) return;
    await saveListToCloud([]);
    renderShoppingList([]);
};

window.copyShoppingList = function() {
    let text = "🛒 Shopping List:\n\n";
    window.currentShoppingList.forEach(i => {
        if(i.type === 'item' && !i.checked) text += `- ${i.text}\n`;
    });
    navigator.clipboard.writeText(text).then(() => alert("Copied remaining items!"));
};

window.closeShoppingModal = function() {
    document.getElementById('shoppingModal').style.display = 'none';
};

// ==========================================
// 5. USER ACTIONS (Hearts, Notes, Etc.)
// ==========================================
window.toggleHeart = async function(event, recipeId) {
    event.stopPropagation();
    const user = auth.currentUser;
    if (!user) return alert("Please log in!");

    const btn = event.currentTarget;
    const isFav = userFavorites.includes(recipeId);
    const userRef = doc(db, "users", user.uid);

    try {
        if (isFav) {
            await updateDoc(userRef, { favorites: arrayRemove(recipeId) });
            userFavorites = userFavorites.filter(id => id !== recipeId);
            btn.innerText = "🤍";
        } else {
            await updateDoc(userRef, { favorites: arrayUnion(recipeId) });
            userFavorites.push(recipeId);
            btn.innerText = "❤️";
        }
    } catch (error) { console.error(error); }
};

window.recordCook = async function(btnElement) {
    if (typeof fireConfetti === "function") fireConfetti(btnElement);
    const recipeTitle = document.title;
    const recipeKey = 'cookCount-' + recipeTitle;
    let count = parseInt(localStorage.getItem(recipeKey) || 0) + 1;
    localStorage.setItem(recipeKey, count);
    
    const counterText = document.getElementById('cook-counter');
    if(counterText) counterText.innerHTML = `You've cooked this <strong>${count} times</strong>!`;

    try {
        await addDoc(collection(db, "global_cooks"), { recipe: recipeTitle, timestamp: serverTimestamp() });
    } catch (error) { console.error("Error recording cook:", error); }
};

// MEAL PLANNER LOADER
function loadMealPlan() {
    const plan = JSON.parse(localStorage.getItem('mealPlan')) || {};
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    days.forEach(day => {
        const element = document.getElementById(`plan-${day}`);
        if (element && plan[day]) {
            element.innerText = plan[day];
            if(element.parentElement) element.parentElement.style.borderColor = "#10b981"; 
        }
    });
}