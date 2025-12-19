// ==========================================
// 1. IMPORTS & SETUP
// ==========================================
import { db, auth } from './firebase-config.js'; 
import { collection, getDocs, doc, getDoc, addDoc, setDoc, deleteDoc, serverTimestamp, query, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

let allRecipes = []; 
const MY_ADMIN_ID = "n5aAU1g1tBY04Ut0HnhqegSgZe92"; 

console.log("✅ MAIN.JS LOADED - v14.0 (CSS Classes Refactor)");

onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById("notsigned").classList.add('hidden');
        document.getElementById('recipes').style.display = 'grid';

        if (user.uid === MY_ADMIN_ID) {
            document.getElementById('admin-btn').classList.add('visible');
        }
        
        loadAllRecipes(); 
        
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            let userName = user.displayName || user.email.split('@')[0];
            if (userSnap.exists() && userSnap.data().Name) { userName = userSnap.data().Name; }
            updateProfileIcon(userName); 
        } catch (err) { console.error(err); }
        
        if (document.getElementById('family-feed')) loadFamilyFeed();
        if (document.getElementById('commentsList')) loadComments();
        if (document.getElementById('plan-Mon')) loadMealPlan();
        if (document.getElementById('chefNotes')) loadUserNote();

    } else {
        if (document.getElementById('chefNotes')) {
            window.location.href = "homepage.html";
            return;
        }
        document.getElementById("notsigned").classList.remove('hidden');
        document.getElementById('recipes').style.display = 'none';
        resetProfileIcon();
    }
});

// ==========================================
// 2. RECIPE LOADER & COLORS
// ==========================================
async function loadAllRecipes() {
    const container = document.getElementById('recipes');
    if(!container) return; 

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
    } catch (e) { container.innerHTML = "<p>Error loading.</p>"; }
}

function getCategoryClass(category) {
    if (!category) return ''; 
    const cat = category.toLowerCase();
    
    if (cat.includes('appetizer')) return 'border-blue';
    if (cat.includes('bread')) return 'border-green';
    if (cat.includes('dessert')) return 'border-yellow';
    if (cat.includes('main')) return 'border-red';
    if (cat.includes('soup') || cat.includes('salad')) return 'border-purple';
    if (cat.includes('breakfast')) return 'border-orange';
    
    return ''; // Default Teal
}

function renderLocalList(list) {
    const container = document.getElementById('recipes');
    container.innerHTML = "";
    list.sort((a, b) => a.n.localeCompare(b.n));

    let html = "";
    list.forEach(item => {
        const cat = item.c || (item.t && item.t[0]) || ""; 
        const colorClass = getCategoryClass(cat);

        html += `
        <div class="recipe-card ${colorClass}" onclick="goToRecipe('${item.id}', '${item.n.replace(/'/g, "\\'")}')">
            <div class="status-badge">${item.r ? "✅" : ""}</div>
            <div class="card-content">
                <h2>${item.n}</h2>
                <div class="recipe-author">From: ${item.a}</div>
                <div class="tag-container">
                    ${(item.t || []).map(t => `<span class="tag-pill">${t}</span>`).join('')}
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

// ==========================================
// 3. ANNOUNCEMENTS & COMMENTS (CSS CLASSES)
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
// 4. SHOPPING & MEAL PLAN (CSS CLASSES)
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
                // Header
                listEl.innerHTML += `<li class="shop-header">${data.name}</li>`;
                const ings = data.ingredients || data.recipeIngredient || [];
                if(Array.isArray(ings)) {
                    ings.forEach((i, idx) => {
                        // Interactive Item
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
// 5. NOTES & UTILS
// ==========================================
async function loadUserNote() {
    const noteBox = document.getElementById('chefNotes');
    if (!noteBox) return;
    const user = auth.currentUser;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    if (!user || !currentRecipe) return;

    try {
        const noteRef = doc(db, "users", user.uid, "private_notes", currentRecipe.id);
        const docSnap = await getDoc(noteRef);
        if (docSnap.exists()) noteBox.value = docSnap.data().text || "";
    } catch (e) { console.error(e); }
}

window.saveNote = async function() {
    const noteBox = document.getElementById('chefNotes');
    const user = auth.currentUser;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    
    if (!user || !noteBox || !currentRecipe) return alert("Please log in to save notes.");

    try {
        const noteRef = doc(db, "users", user.uid, "private_notes", currentRecipe.id);
        await setDoc(noteRef, {
            text: noteBox.value, 
            updatedAt: serverTimestamp(), 
            recipeName: currentRecipe.name
        });
        
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#cbd5e1" /><path d="M20 20a8 8 0 100-16 8 8 0 000 16zm0 4c-5.33 0-16 2.67-16 8v4h32v-4c0-5.33-10.67-8-16-8z" fill="white"/></svg>`;
    if (iconEl) iconEl.src = `data:image/svg+xml;base64,${btoa(svg)}`;
}

// Helper Functions from before (Search/Filter) - Ensure these exist
// I'll re-add them briefly here so you don't lose them
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
        const term = input.value.toLowerCase().trim();
        if (!term) return;
        const filtered = allRecipes.filter(r => (r.n || "").toLowerCase().includes(term));
        renderLocalList(filtered);
        overlay.classList.add('hidden');
        input.value = "";
    }
}

function setupCategoryFilters() {
    const buttons = document.querySelectorAll('.folders button');
    buttons.forEach(btn => {
        btn.onclick = () => {
            const category = btn.innerText.replace("✓ ", "").trim();
            if (btn.classList.contains('active-filter')) {
                btn.classList.remove('active-filter');
                renderLocalList(allRecipes);
            } else {
                buttons.forEach(b => b.classList.remove('active-filter'));
                btn.classList.add('active-filter');
                const filtered = allRecipes.filter(r => {
                    const tags = r.t || [];
                    return tags.includes(category); 
                });
                renderLocalList(filtered);
            }
        };
    });
}

// Init
setTimeout(() => { setupSearch(); setupCategoryFilters(); }, 500);