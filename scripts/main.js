// ==========================================
// 1. IMPORTS & SETUP
// ==========================================
import { db, auth } from './firebase-config.js'; 
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, 
    serverTimestamp, arrayUnion, arrayRemove, query, orderBy, limit, onSnapshot 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

let allRecipes = []; 
let userFavorites = []; 
let isAdmin = false; // <-- ADD THIS

// ⚠️ LIST OF ADMINS (Array of Strings)
const ADMIN_UIDS = [
    "n5aAU1g1tBY04Ut0HnhqegSgZe92", 
    "NrY491PYN3MIrqJp4rhu5S86w2R2",
    "mPBrypCN9ab1LCEQ578E5YrX8DI2"
];

console.log("✅ MAIN.JS LOADED - v19.0 (Multi-Admin)");

// ==========================================
// 2. AUTH & STARTUP
// ==========================================
onAuthStateChanged(auth, async (user) => {
    // Define elements safely
    const notSignedMsg = document.getElementById("notsigned");
    const recipeGrid = document.getElementById('recipes');
    const adminBtn = document.getElementById('admin-btn');

    if (user) {
        isAdmin = ADMIN_UIDS.includes(user.uid); // <-- ADD THIS LINE

        loadUserSettings(user);
        loadHomepageMenu(user);
        // 1. UI Updates (Only if elements exist)
        if (notSignedMsg) notSignedMsg.classList.add('hidden');
        if (recipeGrid) recipeGrid.style.display = 'grid';
        if (ADMIN_UIDS.includes(user.uid) && adminBtn) {
            adminBtn.classList.add('visible');
        }
        
        // 2. Load User Data (Favorites & Profile)
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            let userName = user.displayName || user.email.split('@')[0];
            
            if (userSnap.exists()) {
                userName = userSnap.data().Name || userName;
                userFavorites = userSnap.data().favorites || []; 
            }
            updateProfileIcon(userName); 
        } catch (err) { console.error("Profile Error:", err); }

        // 3. Load Content
        loadAllRecipes(); 
        
        // Page Specific Loaders (Check if elements exist first)
        if (document.getElementById('family-feed')) loadFamilyFeed();
        if (document.getElementById('commentsList')) loadComments();
        if (document.getElementById('plan-Mon')) loadMealPlan();
        if (document.getElementById('chefNotes')) loadUserNote();

    } else {
        // Guest Handling
        // If on a "Private" page (like Recipe View), kick them out
        if (document.getElementById('chefNotes')) {
            window.location.href = "index.html"; // Go to Login
            return;
        }

        // If on Homepage, show "Not Signed In" message
        if (notSignedMsg) notSignedMsg.classList.remove('hidden');
        if (recipeGrid) recipeGrid.style.display = 'none';
        
        resetProfileIcon();
    }
});

// ==========================================
// 3. RECIPE LOADER
// ==========================================
async function loadAllRecipes() {
    const container = document.getElementById('recipes');
    if(!container) return; // Stop if not on homepage

    container.innerHTML = '<p style="text-align:center; width:100%;">Opening Cookbook...</p>';

    try {
        const docRef = doc(db, "static_assets", "cookbook_index");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            allRecipes = data.recipes || [];
            renderLocalList(allRecipes); 
        } else {
            container.innerHTML = "<p style='text-align:center;'>Index missing.</p>";
        }
    } catch (e) { 
    console.error("Recipe Load Error:", e); // <--- This prints the real error to the console!
    container.innerHTML = "<p>Error loading recipes.</p>"; 
}
}

function getCategoryClass(category) {
    if (!category) return 'border-gray'; 
    const cat = category.toLowerCase();
    
    if (cat.includes('main')) return 'border-red';
    if (cat.includes('dessert')) return 'border-yellow';
    if (cat.includes('appetizer') || cat.includes('snack')) return 'border-blue';
    if (cat.includes('breakfast')) return 'border-orange';
    if (cat.includes('bread') || cat.includes('roll')) return 'border-brown';
    if (cat.includes('soup') || cat.includes('salad')) return 'border-purple';
    if (cat.includes('sauce') || cat.includes('dressing') || cat.includes('marinade')) return 'border-teal';
    if (cat.includes('dutch')) return 'border-slate';
    if (cat.includes('misc')) return 'border-gray';
    
    return 'border-gray'; // Catch-all 
}

function renderLocalList(list) {
    const container = document.getElementById('recipes');
    if(!container) return;

    container.innerHTML = "";

    // 1. Sort safely
    list.sort((a, b) => {
        const nameA = (a.n || a.name || "Untitled").toLowerCase();
        const nameB = (b.n || b.name || "Untitled").toLowerCase();
        return nameA.localeCompare(nameB);
    });

    let html = "";
    list.forEach(item => {
        // 🚨 CHECK IF HIDDEN
        const isHidden = item.h === true || item.isHidden === true;

        // 🚨 SKIP RENDERING IF HIDDEN AND NOT AN ADMIN
        if (isHidden && !isAdmin) return;

        // 2. Safety checks
        const recName = item.n || item.name || "Untitled Recipe";
        const recAuth = item.a || item.author || "Family";
        const recId   = item.id;
        
        // 3. TAG FIX: Force it to be an Array!
        let recTags = item.t || item.tags || [];
        if (!Array.isArray(recTags)) {
             recTags = [String(recTags)];
        }
        
        // Category logic
        const cat = recTags[0] || item.c || "Misc";
        const colorClass = getCategoryClass(cat);
        const isFav = userFavorites.includes(recId);
        const heartIcon = isFav ? "❤️" : "🤍";

        // 🚨 ADMIN VISUALS: Add the eye icon and dim the card
        const eyeIcon = isHidden ? `<div style="position: absolute; top: 10px; right: 40px; font-size: 1.2rem;" title="Hidden from public">👁️</div>` : "";
        const dimStyle = isHidden ? `opacity: 0.6; background-color: #f8fafc;` : "";

        html += `
        <div class="recipe-card ${colorClass}" style="${dimStyle}" onclick="goToRecipe('${recId}', '${recName.replace(/'/g, "\\'")}')">
            <div class="status-badge">${(item.r || item.reviewed) ? "✅" : ""}</div>
            ${eyeIcon}
            <button class="card-heart" onclick="toggleHeart(event, '${recId}')">${heartIcon}</button>
            <div class="card-content">
                <h2>${recName}</h2>
                <div class="recipe-author">From: ${recAuth}</div>
                <div class="tag-container">
                    ${recTags.map(t => `<span class="tag-pill">${t}</span>`).join('')}
                </div>
            </div>
        </div>`;
    });
    
    container.innerHTML = html || "<p style='text-align:center'>No recipes found.</p>";
}

window.goToRecipe = function(id, name) {
    localStorage.setItem("currentRecipeData", JSON.stringify({ id: id, name: name }));
    window.location.href = `recipe.html?id=${id}`;
};

window.toggleHeart = async function(event, recipeId) {
    event.stopPropagation(); 
    const user = auth.currentUser;
    if (!user) return alert("Log in to favorite!");
    
    const btn = event.currentTarget;
    const userRef = doc(db, "users", user.uid);

    try {
        if (userFavorites.includes(recipeId)) {
            btn.innerText = "🤍";
            userFavorites = userFavorites.filter(id => id !== recipeId);
            await updateDoc(userRef, { favorites: arrayRemove(recipeId) });
        } else {
            btn.innerText = "❤️";
            userFavorites.push(recipeId);
            await updateDoc(userRef, { favorites: arrayUnion(recipeId) });
        }
    } catch (e) { console.error("Heart Error:", e); }
};

// ==========================================
// 4. ANNOUNCEMENTS & COMMENTS
// ==========================================
async function loadFamilyFeed() {
    const feedList = document.getElementById('family-feed');
    if (!feedList) return;
    try {
        const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"), limit(3));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) { 
            feedList.innerHTML = "<p class='empty-feed'>No announcements.</p>"; 
            return; 
        }
        
        let html = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            let icon = "📢";
            if (data.type === "new_recipe") icon = "🍳";

            html += `<div class="announce-item">
                <div class="announce-icon">${icon}</div>
                <div class="announce-text">${data.message}</div>
            </div>`;
        });
        feedList.innerHTML = html;
    } catch (e) { console.error(e); }
}

function loadComments() {
    const list = document.getElementById('commentsList');
    if (!list) return;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    if (!currentRecipe) return;
    
    const user = auth.currentUser;
    const q = query(collection(db, "recipes", currentRecipe.id, "comments"), orderBy("timestamp", "asc"));
    
    onSnapshot(q, (snap) => {
        if(snap.empty){list.innerHTML='<p class="empty-feed">No comments.</p>';return;}
        
        let html='';
        snap.forEach(docSnap => {
            const d = docSnap.data(); 
            const init = (d.author||"G").charAt(0).toUpperCase();
            
            let deleteBtn = "";
            if (user && (user.uid === d.uid || user.uid === MY_ADMIN_ID)) {
                deleteBtn = `<span onclick="deleteComment('${docSnap.id}')" class="delete-icon" title="Delete">🗑️</span>`;
            }

            html += `
            <div class="comment-row">
                <div class="comment-avatar">${init}</div>
                <div class="comment-bubble">
                    <div class="comment-author">
                        ${d.author}
                        ${deleteBtn}
                    </div>
                    <div class="comment-text">${d.text}</div>
                </div>
            </div>`;
        });
        list.innerHTML = html;
    });
}

window.deleteComment = async function(commentId) {
    if(!confirm("Delete this comment?")) return;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    try {
        await deleteDoc(doc(db, "recipes", currentRecipe.id, "comments", commentId));
    } catch(e) { alert("Error deleting."); }
}

window.postComment = async function() {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");
    const inp = document.getElementById('commentInput');
    const val = inp.value.trim();
    if(!val) return;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    await addDoc(collection(db, "recipes", currentRecipe.id, "comments"), {
        text: val, author: user.displayName || user.email.split('@')[0], uid: user.uid, timestamp: serverTimestamp()
    });
    inp.value = "";
}

// ==========================================
// 5. SHOPPING & MEAL PLAN
// ==========================================
window.openShoppingModal = function() {
    const modal = document.getElementById('shoppingModal');
    if(modal) {
        modal.classList.remove('hidden');
        generateFromPlan();
    }
}
window.closeShoppingModal = function() {
    document.getElementById('shoppingModal').classList.add('hidden');
}

window.generateFromPlan = async function() {
    const listEl = document.getElementById('shopping-ul');
    const status = document.getElementById('shopping-status');
    const container = document.getElementById('shopping-list-container');
    if(!listEl) return;

    const plan = JSON.parse(localStorage.getItem('mealPlan')) || {};
    const recipeNames = Object.values(plan);

    if(recipeNames.length === 0) {
        status.innerText = "Weekly Menu is empty.";
        container.classList.add('hidden');
        return;
    }

    status.innerText = "Loading ingredients...";
    container.classList.add('hidden');
    listEl.innerHTML = "";

    try {
        const q = query(collection(db, "recipes")); 
        const snap = await getDocs(q);
        
        snap.forEach(doc => {
            const data = doc.data();
            if (recipeNames.includes(data.name)) {
                listEl.innerHTML += `<li class="shop-header">${data.name}</li>`;
                const ings = data.ingredients || data.recipeIngredient || [];
                if(Array.isArray(ings)) {
                    ings.forEach((i) => {
                        listEl.innerHTML += `
                        <li class="shop-item" onclick="this.classList.toggle('checked')">
                            <div class="check-box">✓</div>
                            <span class="shop-text">${i}</span>
                        </li>`;
                    });
                }
            }
        });
        status.style.display = 'none';
        container.classList.remove('hidden');
        container.style.display = 'block';
    } catch(e) { status.innerText = "Error loading list."; }
}

window.copyShoppingList = function() {
    const list = document.getElementById('shopping-ul').innerText;
    navigator.clipboard.writeText(list).then(() => alert("Copied to clipboard!"));
}

function loadMealPlan() {
    const plan = JSON.parse(localStorage.getItem('mealPlan')) || {};
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(day => {
        const el = document.getElementById(`plan-${day}`);
        if(el && plan[day]) {
            el.innerText = plan[day];
            if(el.parentElement) el.parentElement.classList.add('active');
        }
    });
}
window.clearMealPlan = function() {
    if(confirm("Clear Menu?")) { localStorage.removeItem('mealPlan'); window.location.reload(); }
}

// ==========================================
// 6. NOTES & UTILS
// ==========================================
async function loadUserNote() {
    const noteSection = document.getElementById('notes-section');
    const noteBox = document.getElementById('chefNotes');
    const printNotes = document.getElementById('print-chef-notes');
    
    if (!noteSection || !noteBox) return;
    
    const user = auth.currentUser;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    
    if (!user || !currentRecipe) {
        // If not logged in, ensure the whole section is hidden
        noteSection.classList.add('hidden');
        return;
    }

    // Logged in? Show the section
    noteSection.classList.remove('hidden');

    try {
        const noteRef = doc(db, "users", user.uid, "private_notes", currentRecipe.id);
        const docSnap = await getDoc(noteRef);
        
        if (docSnap.exists() && docSnap.data().text) {
            const text = docSnap.data().text;
            noteBox.value = text;
            if(printNotes) printNotes.innerText = text;
            noteSection.classList.remove('no-print'); // Let it print!
        } else {
            if(printNotes) printNotes.innerText = "";
            noteSection.classList.add('no-print'); // Hide from printer if empty
        }
    } catch (e) { console.error(e); }
}

window.saveNote = async function() {
    const noteSection = document.getElementById('notes-section');
    const noteBox = document.getElementById('chefNotes');
    const printNotes = document.getElementById('print-chef-notes');
    
    const user = auth.currentUser;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    
    if (!user || !noteBox || !currentRecipe) return alert("Please log in to save notes.");
    
    const textValue = noteBox.value.trim();

    try {
        const noteRef = doc(db, "users", user.uid, "private_notes", currentRecipe.id);
        await setDoc(noteRef, { text: textValue, updatedAt: serverTimestamp(), recipeName: currentRecipe.name || currentRecipe.n });
        
        // Sync to print view
        if(printNotes) printNotes.innerText = textValue;
        if (textValue && noteSection) {
            noteSection.classList.remove('no-print');
        } else if (noteSection) {
            noteSection.classList.add('no-print');
        }

        const status = document.getElementById('saveStatus');
        if(status) { status.innerText = "Saved!"; setTimeout(() => status.innerText = "", 2000); }
    } catch (e) { alert("Error saving note."); }
};

function updateProfileIcon(name) {
    const iconEl = document.getElementById('header-profile-icon');
    if (!iconEl) return;
    const initials = (name || "Guest").split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#0d9488" /><text x="50%" y="50%" dy=".35em" fill="white" font-family="Arial, sans-serif" font-weight="bold" font-size="16" text-anchor="middle">${initials}</text></svg>`;
    iconEl.src = `data:image/svg+xml;base64,${btoa(svg)}`;
}

function resetProfileIcon() {
    const iconEl = document.getElementById('header-profile-icon');
    if (iconEl) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#cbd5e1" /><path d="M20 20a8 8 0 100-16 8 8 0 000 16zm0 4c-5.33 0-16 2.67-16 8v4h32v-4c0-5.33-10.67-8-16-8z" fill="white"/></svg>`;
        iconEl.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    }
}

// ==========================================
// UNIFIED HOMEPAGE FILTERING
// ==========================================
let currentCategoryFilter = null;

window.applyHomepageFilters = function() {
    const searchInput = document.getElementById('searchbar');
    const term = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const showReviewedOnly = document.getElementById('reviewed-toggle') ? document.getElementById('reviewed-toggle').checked : false;
    
    let filtered = allRecipes;

    // 1. Filter by Reviewed Status
    if (showReviewedOnly) {
        filtered = filtered.filter(r => r.r === true || r.reviewed === true);
    }

    // 2. Filter by Category
    if (currentCategoryFilter) {
        filtered = filtered.filter(r => {
            const tags = r.t || [];
            return tags.includes(currentCategoryFilter);
        });
    }

    // 3. Filter by Search Term
    if (term) {
        filtered = filtered.filter(r => (r.n || "").toLowerCase().includes(term));
    }

    renderLocalList(filtered);
};

function setupSearch() {
    const openBtn = document.getElementById('header-search-btn');
    const overlay = document.getElementById('search-overlay');
    const closeBtn = document.getElementById('close-search');
    const form = document.getElementById('search-form');
    const input = document.getElementById('searchbar');
    
    if (!openBtn) return;
    openBtn.onclick = () => { overlay.classList.remove('hidden'); setTimeout(() => input.focus(), 100); };
    if (closeBtn) closeBtn.onclick = () => overlay.classList.add('hidden');
    
    if (form) form.onsubmit = (e) => {
        e.preventDefault();
        applyHomepageFilters(); // Use the unified filter
        overlay.classList.add('hidden');
        input.value = "";
    }
}

function setupCategoryFilters() {
    const buttons = document.querySelectorAll('.folders button');
    buttons.forEach(btn => {
        btn.onclick = () => {
            const category = btn.innerText.trim();
            
            if (btn.classList.contains('active-filter')) {
                // Turn off filter
                btn.classList.remove('active-filter');
                currentCategoryFilter = null;
            } else {
                // Turn on filter
                buttons.forEach(b => b.classList.remove('active-filter'));
                btn.classList.add('active-filter');
                currentCategoryFilter = category;
            }
            
            applyHomepageFilters(); // Use the unified filter
        };
    });
}

setTimeout(() => { setupSearch(); setupCategoryFilters(); }, 500);
// ==========================================
// 7. WEEKLY MENU LOGIC (Responsive, Clickable & Deletable)
// ==========================================

async function loadHomepageMenu(user) {
    try {
        const querySnapshot = await getDocs(collection(db, "users", user.uid, "weekly_plan"));
        
        querySnapshot.forEach((doc) => {
            const dayFull = doc.id; 
            const data = doc.data();
            const shortDay = dayFull.substring(0, 3); 
            const box = document.getElementById(`menu-${shortDay}`);
            
            if (box) {
                if (data.meals && data.meals.length > 0) {
                    let html = "";
                    
                    data.meals.forEach(meal => {
                        const uniqueId = meal.addedAt || 0;
                        const safeName = (meal.name || "Unknown").replace(/'/g, "\\'");
                        const recipeId = meal.id; 

                        html += `
                        <div style="background: var(--bg-card); margin-top: 4px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; box-shadow: var(--shadow-sm);">
                            
                            <a href="recipe.html?id=${recipeId}" style="text-decoration: none; flex-grow: 1; overflow: hidden; margin-right: 8px;">
                                <span style="font-size: 13px; color: var(--primary); font-weight: 600; text-align: left; line-height: 1.3; display: block; white-space: normal;">
                                    ${meal.name}
                                </span>
                            </a>

                            <button onclick="deleteMealFromMenu('${dayFull}', ${uniqueId}, '${safeName}')" 
                                  style="background: none; border: none; cursor: pointer; color: #ef4444; font-size: 18px; font-weight: bold; padding: 0; line-height: 1;">
                                &times;
                            </button>
                        </div>`;
                    });
                    
                    box.innerHTML = html;
                } else {
                    box.innerHTML = `<span style="color:#9ca3af; font-size: 12px; font-style: italic;">Nothing planned</span>`;
                }
            }
        });
    } catch (e) {
        console.error("Error loading menu widget:", e);
    }
}

// 🗑️ THIS IS THE MISSING FUNCTION!
window.deleteMealFromMenu = async function(dayFull, uniqueId, mealName) {
    const user = auth.currentUser;
    if (!user) return;

    if(!confirm(`Remove "${mealName}" from ${dayFull}?`)) return;

    const shortDay = dayFull.substring(0, 3);
    const box = document.getElementById(`menu-${shortDay}`);
    
    // Visual Feedback
    if(box) box.style.opacity = "0.5";

    try {
        const docRef = doc(db, "users", user.uid, "weekly_plan", dayFull);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const currentMeals = docSnap.data().meals || [];
            
            // Filter out the meal we want to delete
            const newMeals = currentMeals.filter(m => {
                if (uniqueId !== 0 && m.addedAt) {
                    return m.addedAt !== uniqueId;
                }
                return m.name !== mealName;
            });

            // Update Database
            await updateDoc(docRef, { meals: newMeals });
            
            // Reload UI
            loadHomepageMenu(user);
            if(box) box.style.opacity = "1";
        }
    } catch (e) {
        console.error("Delete Error:", e);
        alert("Could not delete item.");
        if(box) box.style.opacity = "1";
    }
};
// ==========================================
// 8. SETTINGS & THEME ENGINE (DEBUG VERSION)
// ==========================================

// Apply settings immediately if found in LocalStorage (prevents flash)
const cachedSettings = JSON.parse(localStorage.getItem('userSettings'));
if (cachedSettings) {
    console.log("🎨 [THEME] Applied cached settings from LocalStorage");
    applyTheme(cachedSettings);
}

export async function saveUserSettings(settings) {
    const user = auth.currentUser;
    
    // 1. Check if user is actually logged in
    if (!user) {
        console.error("❌ [SETTINGS] Cannot save: No user logged in.");
        alert("Error: You must be logged in to save settings.");
        return;
    }

    console.log("💾 [SETTINGS] Saving for user:", user.uid);
    console.log("📦 [SETTINGS] Data to save:", settings);

    // 2. Save to LocalStorage (Instant UI update)
    localStorage.setItem('userSettings', JSON.stringify(settings));
    applyTheme(settings);

    // 3. Save to Firebase (Persistence)
    // PATH: users -> {uid} -> settings -> preferences
    // This puts it exactly in the 'settings' folder circled in your screenshot.
    try {
        const docRef = doc(db, "users", user.uid, "settings", "preferences");
        console.log("📍 [SETTINGS] Writing to Firebase path:", docRef.path);
        
        await setDoc(docRef, settings);
        
        console.log("✅ [SETTINGS] Firebase Save Success!");
    } catch (e) {
        console.error("🔥 [SETTINGS] Firebase Save FAILED:", e);
        alert("Could not save to cloud. Check console for error.");
    }
}

export async function loadUserSettings(user) {
    if (!user) return;

    console.log("📥 [SETTINGS] Fetching from cloud for:", user.uid);

    try {
        // MATCHING PATH: users -> {uid} -> settings -> preferences
        const docRef = doc(db, "users", user.uid, "settings", "preferences");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const settings = docSnap.data();
            console.log("✨ [SETTINGS] Found cloud settings:", settings);
            
            // Update LocalStorage and Apply
            localStorage.setItem('userSettings', JSON.stringify(settings));
            applyTheme(settings);
        } else {
            console.log("⚠️ [SETTINGS] No cloud settings found (using defaults).");
        }
    } catch (e) {
        console.error("❌ [SETTINGS] Load Error:", e);
    }
}

function applyTheme(settings) {
    const html = document.documentElement;
    
    // 1. Dark Mode
    if (settings.theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        html.removeAttribute('data-theme');
    }

    // 2. Font Size
    html.setAttribute('data-size', settings.fontSize || 'normal');

    // 3. Font Style
    html.setAttribute('data-font', settings.fontStyle || 'inter');
}
// ==========================================
// 8. QUICK THEME TOGGLE LOGIC
// ==========================================
window.quickToggleTheme = async function() {
    // 1. Get current settings (or defaults)
    let settings = JSON.parse(localStorage.getItem('userSettings')) || {
        theme: 'light',
        fontSize: 'normal',
        fontStyle: 'inter'
    };
    
    // 2. Flip the theme
    const isDark = settings.theme === 'dark';
    settings.theme = isDark ? 'light' : 'dark';
    
    // 3. Apply it instantly to the screen
    const html = document.documentElement;
    if (settings.theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        html.removeAttribute('data-theme');
    }
    
    // 4. Update the button icons
    updateThemeIcons(settings.theme);

    // 5. Save it to LocalStorage immediately
    localStorage.setItem('userSettings', JSON.stringify(settings));

    // 6. Save it to Firebase in the background (if user is logged in)
    const user = auth.currentUser;
    if (user) {
        try {
            const docRef = doc(db, "users", user.uid, "settings", "preferences");
            await setDoc(docRef, settings);
        } catch (e) { console.error("Could not save theme to cloud:", e); }
    }
};

// Helper function to make sure the buttons say the right thing when the page loads
function updateThemeIcons(theme) {
    const homeBtn = document.getElementById('homeThemeBtn');
    const recipeBtn = document.getElementById('recipeThemeBtn');
    
    if (homeBtn) {
        homeBtn.innerText = theme === 'dark' ? '☀️' : '🌙';
    }
    if (recipeBtn) {
        recipeBtn.innerText = theme === 'dark' ? '☀️ Day Mode' : '🌙 Night Mode';
    }
}

// Run this once when the page loads to ensure icons match the current theme
setTimeout(() => {
    let settings = JSON.parse(localStorage.getItem('userSettings')) || {};
    updateThemeIcons(settings.theme || 'light');
}, 500);