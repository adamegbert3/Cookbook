// ==========================================
// 1. IMPORTS & SETUP
// ==========================================
import { db, auth } from './firebase-config.js'; 

// Firestore Imports (Database)
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
    serverTimestamp, arrayUnion, arrayRemove, query, where, orderBy, limit, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

// Authentication Imports (User Login) <-- THIS WAS MISSING
import { 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

// Global Variables
let allRecipes = []; 
let userFavorites = []; 
window.currentShoppingList = []; 

console.log("✅ MAIN.JS LOADED - v7.1 (Imports Fixed)");

// ==========================================
// 2. AUTHENTICATION & STARTUP
// ==========================================
// ⚠️ PASTE YOUR ADMIN ID HERE ⚠️
const MY_ADMIN_ID = "n5aAU1g1tBY04Ut0HnhqegSgZe92"; 

onAuthStateChanged(auth, async (user) => {
    // --- 1. IF USER IS LOGGED IN (FAMILY MEMBER) ---
    if (user) {
        console.log("Logged in as:", user.email);

        // UI Updates
        const notSignedMsg = document.getElementById("notsigned");
        if (notSignedMsg) notSignedMsg.style.display = 'none';
        
        const recipesGrid = document.getElementById('recipes');
        if (recipesGrid) recipesGrid.style.display = 'flex';

        if (user.uid === MY_ADMIN_ID) {
            const adminBtn = document.getElementById('admin-btn');
            if(adminBtn) adminBtn.style.display = "block"; 
        }

        // Load Profile
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            let userName = user.displayName || user.email.split('@')[0];
            if (userSnap.exists() && userSnap.data().Name) { userName = userSnap.data().Name; }
            updateProfileIcon(userName); 
        } catch (err) { console.error("Error loading profile:", err); }

        // Load Page Content
        if (recipesGrid) loadAllRecipes();
        
        // --- RECIPE PAGE SPECIFIC ---
        if (document.getElementById('chefNotes')) {
            loadUserNote();
            
            // ✅ TRACK VIEW (Only runs for logged-in members!)
            trackRecipeView(); 
        }
        
        if (document.getElementById('commentsList')) loadComments();
        if (document.getElementById('plan-Mon')) loadMealPlan();
        if (document.getElementById('family-feed')) loadFamilyFeed();

    } 
    // --- 2. IF USER IS A GUEST (STRANGER) ---
    else {
        console.log("User is guest.");

        // ⛔️ THE BOUNCER: PROTECT RECIPE PAGE
        // If we are on the recipe page ('chefNotes' exists) but not logged in...
        if (document.getElementById('chefNotes')) {
            alert("This recipe is for family only! Please sign in.");
            window.location.href = "homepage.html"; // Kick them out
            return; // Stop running code
        }

        // Guest UI for Homepage
        const notSignedMsg = document.getElementById("notsigned");
        if (notSignedMsg) notSignedMsg.style.display = 'block';
        
        const recipesGrid = document.getElementById('recipes');
        if (recipesGrid) recipesGrid.style.display = 'none';

        const adminBtn = document.getElementById('admin-btn');
        if(adminBtn) adminBtn.style.display = "none";
        
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
            const data = doc.data(); // <--- FIXED: Defined 'data' here
            
            // Filter Hidden Recipes
            if (data.isHidden === true) return; 
            
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

// ==========================================
// REPLACED LOAD COMMENTS (Real-time & Better UI)
// ==========================================
function loadComments() {
    const list = document.getElementById('commentsList');
    if (!list) return;

    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    if (!currentRecipe) return;

    const user = auth.currentUser;
    const ADMIN_ID = MY_ADMIN_ID; 

    // Listen for updates in real-time
    const q = query(collection(db, "recipes", currentRecipe.id, "comments"), orderBy("timestamp", "asc"));
    
    // onSnapshot runs every time the database changes!
    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            list.innerHTML = '<div style="text-align:center; padding: 20px; color: #999; background: #f9f9f9; border-radius: 10px;">👋 No comments yet. Start the conversation!</div>';
            return;
        }

        let html = '';
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const cid = docSnap.id;
            
            // Format Time
            const dateObj = data.timestamp ? data.timestamp.toDate() : new Date();
            const timeStr = dateObj.toLocaleDateString() + " " + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            const isMe = user && data.uid === user.uid;
            const isAdmin = user && user.uid === ADMIN_ID;
            
            // Get Initials for Avatar
            const initials = (data.author || "Guest").substring(0,2).toUpperCase();

            // CHAT BUBBLE STYLING
            const wrapperStyle = isMe 
                ? "display: flex; justify-content: flex-end; margin-bottom: 15px;" 
                : "display: flex; justify-content: flex-start; margin-bottom: 15px;";
            
            const bubbleStyle = isMe
                ? "background: #0a4d74; color: white; padding: 12px 16px; border-radius: 15px 15px 0 15px; max-width: 80%; box-shadow: 0 2px 5px rgba(0,0,0,0.1);"
                : "background: #f3f4f6; color: #1f2937; padding: 12px 16px; border-radius: 15px 15px 15px 0; max-width: 80%; border: 1px solid #e5e7eb;";

            const metaStyle = isMe
                ? "text-align: right; font-size: 10px; color: #cbd5e1; margin-top: 5px;"
                : "font-size: 10px; color: #6b7280; margin-top: 5px;";

            // Delete button (Only show if allowed)
            let deleteBtn = "";
            if (isMe || isAdmin) {
                deleteBtn = `<button onclick="deleteComment('${cid}')" style="font-size: 10px; color: ${isMe ? '#93c5fd' : 'red'}; background: none; border: none; cursor: pointer; text-decoration: underline; margin-left: 5px;">Delete</button>`;
            }

            html += `
                <div style="${wrapperStyle}">
                    ${!isMe ? `<div style="width: 35px; height: 35px; background: #ddd; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 10px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">${initials}</div>` : ''}
                    
                    <div style="display: flex; flex-direction: column; ${isMe ? 'align-items: flex-end;' : 'align-items: flex-start;'}">
                        <div style="${bubbleStyle}">
                            <div style="font-weight: bold; font-size: 12px; margin-bottom: 2px; ${isMe ? 'color: #93c5fd;' : 'color: #0a4d74;'}">${data.author}</div>
                            <div style="line-height: 1.4;">${data.text}</div>
                        </div>
                        <div style="${metaStyle}">
                            ${timeStr} ${deleteBtn}
                        </div>
                    </div>
                </div>`;
        });
        list.innerHTML = html;
        
        // Auto-scroll to bottom
        list.scrollTop = list.scrollHeight;
    });
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

// ==========================================
// 6. IN-HOUSE PROFILE ICONS (NO EXTERNAL LINKS!)
// ==========================================

function updateProfileIcon(name) {
    const iconEl = document.getElementById('header-profile-icon');
    
    // Safety Check: If we are on the Login page, this element doesn't exist.
    // So we just stop here to prevent the error.
    if (!iconEl) return;

    // 1. Get Initials (e.g., "Sue Egbert" -> "SE")
    const initials = name.split(' ')
        .map(p => p.charAt(0))
        .join('')
        .toUpperCase()
        .substring(0, 2);

    // 2. Draw the Icon Locally (using SVG)
    // This creates the image "in-house" without asking another website
    const svgString = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <rect width="100%" height="100%" fill="#0a4d74"/>
            <text x="50%" y="50%" dy=".35em" font-family="Arial" font-weight="bold" font-size="40" fill="white" text-anchor="middle">
                ${initials}
            </text>
        </svg>
    `;

    // 3. Convert code to an Image
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(svgString);
    iconEl.src = dataUrl;
}

function resetProfileIcon() {
    const iconEl = document.getElementById('header-profile-icon');
    if (iconEl) iconEl.src = "images/profile-icon.png"; 
}

// ==========================================
// 🛠️ DEBUG VERSION: TRACK RECIPE VIEW
// ==========================================
async function trackRecipeView() {
    console.log("-------------------------------");
    console.log("🕵️‍♂️ STARTING VIEW TRACKER...");

    // 1. CHECK LOCAL STORAGE
    const currentRecipeString = localStorage.getItem("currentRecipeData");
    
    if (!currentRecipeString) {
        console.error("❌ ERROR: No 'currentRecipeData' found in LocalStorage.");
        console.warn("Did you click a recipe card? Or did you just refresh the page?");
        return;
    }

    const currentRecipe = JSON.parse(currentRecipeString);
    console.log("✅ Recipe Found:", currentRecipe.name, "(ID:", currentRecipe.id, ")");

    // 2. CHECK USER AUTH
    const user = auth.currentUser;
    if (!user) {
        console.error("❌ ERROR: User is not logged in. View will NOT be tracked.");
        return;
    }
    const viewerName = user.displayName || user.email;
    console.log("✅ Viewer Identified:", viewerName);

    // 3. ATTEMPT TO SAVE TO FIRESTORE
    try {
        console.log("⏳ Sending to Firestore (Collection: 'recipe_views')...");
        
        await addDoc(collection(db, "recipe_views"), {
            recipeId: currentRecipe.id,
            recipeTitle: currentRecipe.name || "Untitled Recipe",
            viewer: viewerName,
            timestamp: serverTimestamp()
        });

        console.log("🎉 SUCCESS! View recorded in database.");
        // alert("View Tracked Successfully! Check Firebase now."); 

    } catch (e) { 
        console.error("🔥 FIRESTORE WRITE FAILED:", e);
        alert("Tracker Error: " + e.message); // This will pop up if permissions are wrong
    }
    console.log("-------------------------------");
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
// ==========================================
// 7. MISSING FUNCTIONS (Chef Notes)
// ==========================================

async function loadUserNote() {
    const noteBox = document.getElementById('chefNotes');
    // If we aren't on a recipe page, stop.
    if (!noteBox) return;

    const user = auth.currentUser;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    
    // Safety check: User must be logged in & recipe data must exist
    if (!user || !currentRecipe) return;

    try {
        // Path: users -> {userId} -> private_notes -> {recipeId}
        const noteRef = doc(db, "users", user.uid, "private_notes", currentRecipe.id);
        const docSnap = await getDoc(noteRef);

        if (docSnap.exists()) {
            noteBox.value = docSnap.data().text || "";
            console.log("📝 Note loaded.");
        }
    } catch (e) {
        console.error("Error loading note:", e);
    }
}

window.saveNote = async function() {
    const noteBox = document.getElementById('chefNotes');
    const statusSpan = document.getElementById('saveStatus');
    const user = auth.currentUser;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));

    if (!user || !noteBox || !currentRecipe) return alert("Error: Missing data.");

    try {
        const noteRef = doc(db, "users", user.uid, "private_notes", currentRecipe.id);
        
        await setDoc(noteRef, {
            text: noteBox.value,
            updatedAt: serverTimestamp(),
            recipeName: currentRecipe.name || "Unknown"
        });

        // Show "Saved!" message
        if (statusSpan) {
            statusSpan.innerText = "Saved! ✅";
            setTimeout(() => statusSpan.innerText = "", 2000);
        }
    } catch (e) {
        console.error("Error saving note:", e);
        alert("Could not save note.");
    }
};