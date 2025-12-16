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
window.currentShoppingList = []; 

console.log("✅ MAIN.JS LOADED - v6.0 (All Features)");

// ==========================================
// 2. AUTHENTICATION & STARTUP
// ==========================================
// ⚠️ REPLACE THIS WITH YOUR REAL ADMIN ID ⚠️
const MY_ADMIN_ID = "n5aAU1g1tBY04Ut0HnhqegSgZe92"; 

onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("Logged in as:", user.email);

        // --- 1. ADMIN BUTTON CHECK ---
        if (user.uid === MY_ADMIN_ID) {
            const adminBtn = document.getElementById('admin-btn');
            if(adminBtn) adminBtn.style.display = "block"; 
        }

        // --- 2. UI UPDATES ---
        const notSignedMsg = document.getElementById("notsigned");
        if(notSignedMsg) notSignedMsg.style.display = 'none';
        
        const recipesGrid = document.getElementById('recipes');
        if(recipesGrid) recipesGrid.style.display = 'flex';

        // --- 3. LOAD USER INFO ---
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            let userName = user.displayName || user.email.split('@')[0];

            if (userSnap.exists()) {
                const data = userSnap.data();
                userFavorites = data.favorites || [];
                if (data.Name) { userName = data.Name; }
            }
            
            // Fixes "Can't find variable: updateProfileIcon"
            updateProfileIcon(userName); 

        } catch (err) { console.error("Error loading profile:", err); }

        // --- 4. LOAD CONTENT ---
        if (recipesGrid) loadAllRecipes();
        if (document.getElementById('chefNotes')) {
            loadUserNote();
            trackRecipeView(); // Fixes "Not tracking"
        }
        if (document.getElementById('commentsList')) loadComments();
        if (document.getElementById('plan-Mon')) loadMealPlan();
        if (document.getElementById('family-feed')) loadFamilyFeed();

    } else {
        // Guest Logic
        const adminBtn = document.getElementById('admin-btn');
        if(adminBtn) adminBtn.style.display = "none";

        console.log("User is guest/logged out.");
        const notSignedMsg = document.getElementById("notsigned");
        if(notSignedMsg) notSignedMsg.style.display = 'block';
        
        const recipesGrid = document.getElementById('recipes');
        if(recipesGrid) recipesGrid.style.display = 'none';

        resetProfileIcon();
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
            const data = doc.data(); // <--- THIS LINE WAS MISSING BEFORE!
            
            // Filter Hidden Recipes
            if (data.isHidden === true) {
                return; // Skip this one
            }
            
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

    // Click Listeners
    document.querySelectorAll(".recipe-card").forEach(card => {
        card.addEventListener("click", (e) => {
            if(e.target.closest('.heart-btn')) return;

            const name = card.getAttribute("data-name");
            const selectedRecipe = allRecipes.find(r => r.name === name);
            
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
// 4. MEAL PLANNER & SHOPPING
// ==========================================
window.clearMealPlan = function() {
    if (confirm("Clear Weekly Menu?")) {
        localStorage.removeItem('mealPlan');
        window.location.reload();
    }
};

function loadMealPlan() {
    const plan = JSON.parse(localStorage.getItem('mealPlan')) || {};
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    days.forEach(day => {
        const element = document.getElementById(`plan-${day}`);
        if (element && plan[day]) {
            element.innerText = plan[day];
            if(element.parentElement) {
                element.parentElement.style.borderColor = "#10b981"; 
                element.parentElement.style.backgroundColor = "#f0fdf4";
            }
        }
    });
}

window.openShoppingModal = async function() {
    const user = auth.currentUser;
    if (!user) return alert("Please log in.");

    const modal = document.getElementById('shoppingModal');
    if(modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
    
    const status = document.getElementById('shopping-status');
    if(status) { status.style.display = 'block'; status.innerText = "Syncing..."; }
    document.getElementById('shopping-list-container').style.display = 'none';

    try {
        const listRef = doc(db, "shopping_lists", user.uid);
        const docSnap = await getDoc(listRef);

        if (docSnap.exists() && docSnap.data().items.length > 0) {
            renderShoppingList(docSnap.data().items);
        } else {
            await generateFromPlan();
        }
    } catch (error) { console.error(error); }
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

                let raw = data.recipeIngredient || data.ingredients || data.Ingredients || [];
                
                if (Array.isArray(raw)) {
                    raw.forEach(i => newList.push({ text: i, type: 'item', checked: false }));
                } else if (typeof raw === 'string') {
                    let lines = raw.split(/\r?\n/);
                    if(lines.length === 1 && raw.includes(',')) lines = raw.split(',');
                    lines.forEach(line => {
                        if(line.trim()) newList.push({ text: line.trim(), type: 'item', checked: false });
                    });
                } else {
                    newList.push({ text: "⚠️ Check Database", type: 'item', checked: false });
                }
            }
        });

        await saveListToCloud(newList);
        renderShoppingList(newList);

    } catch (error) { console.error(error); }
};

function renderShoppingList(items) {
    const listEl = document.getElementById('shopping-ul');
    window.currentShoppingList = items;
    listEl.innerHTML = "";
    
    if (items.length === 0) {
        document.getElementById('shopping-status').innerText = "List is empty.";
        document.getElementById('shopping-status').style.display = 'block';
        document.getElementById('shopping-list-container').style.display = 'none';
        return;
    }

    items.forEach((item, index) => {
        if (item.type === 'header') {
            listEl.innerHTML += `<li style="margin-top: 15px; font-weight: bold; color: #0a4d74; border-bottom: 2px solid #eee;">${item.text}</li>`;
        } else {
            const isChecked = item.checked ? 'text-decoration: line-through; color: #ccc;' : 'color: #333;';
            const checkIcon = item.checked ? '✓' : '';
            const border = item.checked ? '#10b981' : '#ddd';
            const bg = item.checked ? '#10b981' : 'transparent';

            listEl.innerHTML += `
                <li onclick="toggleItem(${index})" style="padding: 10px 0; border-bottom: 1px solid #f9f9f9; cursor: pointer; display: flex; align-items: center; gap: 12px;">
                    <div style="width: 20px; height: 20px; border: 2px solid ${border}; background: ${bg}; border-radius: 4px; display:flex; align-items:center; justify-content:center; color:white; font-size:12px;">${checkIcon}</div>
                    <span style="font-size: 15px; ${isChecked}">${item.text}</span>
                </li>`;
        }
    });

    document.getElementById('shopping-status').style.display = 'none';
    document.getElementById('shopping-list-container').style.display = 'block';
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

window.closeShoppingModal = function() {
    document.getElementById('shoppingModal').style.display = 'none';
};

window.copyShoppingList = function() {
    let text = "🛒 Shopping List:\n\n";
    window.currentShoppingList.forEach(i => {
        if(i.type === 'item' && !i.checked) text += `- ${i.text}\n`;
    });
    navigator.clipboard.writeText(text).then(() => alert("Copied!"));
};

// ==========================================
// 5. COMMENTS, FAVORITES & UTILS
// ==========================================

// COMMENTS
async function loadComments() {
    const list = document.getElementById('commentsList');
    if (!list) return;

    // USE YOUR SAME ADMIN ID HERE
    const ADMIN_ID = MY_ADMIN_ID; 

    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    if (!currentRecipe) return;
    const user = auth.currentUser;

    try {
        const q = query(collection(db, "recipes", currentRecipe.id, "comments"), orderBy("timestamp", "asc"));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            list.innerHTML = '<p style="color: #999;">No comments yet.</p>';
            return;
        }

        let html = '';
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const cid = docSnap.id;
            const time = data.timestamp ? data.timestamp.toDate().toLocaleDateString() : "Just now";
            
            const isMe = user && data.uid === user.uid;
            const isAdmin = user && user.uid === ADMIN_ID;
            const canManage = isMe || isAdmin;

            const bg = isMe ? "#d1fae5" : "#f3f4f6"; 
            const align = isMe ? "margin-left: auto;" : ""; 

            let menuHtml = "";
            if (canManage) {
                menuHtml = `
                <div style="float: right;">
                    <button onclick="toggleCommentMenu('${cid}')" style="background:none; border:none; cursor:pointer;">⋮</button>
                    <div id="menu-${cid}" class="comment-menu hidden" style="position: absolute; right: 0; background: white; border: 1px solid #ddd; padding: 5px;">
                        <button onclick="deleteComment('${cid}')" style="color:red; background:none; border:none; cursor:pointer;">Delete</button>
                    </div>
                </div>`;
            }

            html += `
                <div style="background: ${bg}; padding: 10px; border-radius: 8px; max-width: 85%; margin-bottom: 10px; ${align}">
                    ${menuHtml}
                    <div style="font-weight: bold; font-size: 11px; color: #555;">${data.author} • ${time}</div>
                    <div>${data.text}</div>
                </div>`;
        });
        list.innerHTML = html;
    } catch (error) { console.error(error); }
}

window.toggleCommentMenu = function(id) {
    const menu = document.getElementById(`menu-${id}`);
    if(menu) menu.classList.toggle('hidden');
};

window.deleteComment = async function(cid) {
    if(!confirm("Delete?")) return;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    try {
        await deleteDoc(doc(db, "recipes", currentRecipe.id, "comments", cid));
        loadComments();
    } catch (e) { alert("Error deleting"); }
};

window.postComment = async function() {
    const user = auth.currentUser;
    if (!user) return alert("Please log in!");
    const input = document.getElementById('commentInput');
    const text = input.value.trim();
    if (!text) return;

    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    
    try {
        let authorName = user.displayName;
        if (!authorName) {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            authorName = userDoc.exists() && userDoc.data().Name ? userDoc.data().Name : user.email.split('@')[0];
        }

        await addDoc(collection(db, "recipes", currentRecipe.id, "comments"), {
            text: text, author: authorName, uid: user.uid, timestamp: serverTimestamp()
        });
        input.value = ""; 
        loadComments();
    } catch (e) { alert("Error posting"); }
};

// FAMILY FEED
async function loadFamilyFeed() {
    const feedList = document.getElementById('family-feed');
    if (!feedList) return;

    try {
        const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"), limit(10));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            feedList.innerHTML = "<p style='color:#999;'>No news yet...</p>";
            return;
        }

        let html = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            const time = data.timestamp ? data.timestamp.toDate().toLocaleDateString() : "Just now";
            const icon = data.type === "new_recipe" ? "🍳" : "📢";
            const color = data.type === "new_recipe" ? "#ecfdf5" : "#f3f4f6";

            html += `
                <div style="background: ${color}; padding: 10px; border-radius: 8px; display: flex; gap: 10px; align-items: center;">
                    <div style="font-size: 20px;">${icon}</div>
                    <div>
                        <div style="font-size: 14px;">${data.message}</div>
                        <div style="font-size: 11px; color: #888;">${time}</div>
                    </div>
                </div>`;
        });
        feedList.innerHTML = html;
    } catch (e) { console.error(e); }
}

// PROFILE ICONS (The Missing Helper Functions!)
function updateProfileIcon(name) {
    const iconEl = document.getElementById('header-profile-icon');
    if (!iconEl) return;
    const initials = name.split(' ').map(p => p.charAt(0)).join('').toUpperCase().substring(0, 2);
    iconEl.src = `https://ui-avatars.com/api/?name=${initials}&background=0a4d74&color=fff&size=100&rounded=true`;
}

function resetProfileIcon() {
    const iconEl = document.getElementById('header-profile-icon');
    if (iconEl) iconEl.src = "images/profile-icon.png"; 
}

// RECIPE TRACKING
async function trackRecipeView() {
    const user = auth.currentUser;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    if (!currentRecipe) return;

    try {
        await addDoc(collection(db, "recipe_views"), {
            recipeId: currentRecipe.id,
            recipeTitle: currentRecipe.name || "Unknown",
            viewer: user ? (user.displayName || user.email) : "Guest",
            timestamp: serverTimestamp()
        });
    } catch (e) { console.error(e); }
}

window.toggleHeart = async function(event, recipeId) {
    event.stopPropagation();
    const user = auth.currentUser;
    if (!user) return alert("Log in to favorite!");
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
    } catch (e) { console.error(e); }
};