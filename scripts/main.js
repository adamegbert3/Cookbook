// ==========================================
// 1. IMPORTS & SETUP
// ==========================================
import { db, auth } from './firebase-config.js'; 
import { collection, getDocs, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, arrayRemove, query, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

let allRecipes = []; 
const MY_ADMIN_ID = "n5aAU1g1tBY04Ut0HnhqegSgZe92"; // ⚠️ PUT YOUR ID HERE

console.log("✅ MAIN.JS LOADED - v12.0 (Notes Fixed)");

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User Logged In
        const notSigned = document.getElementById("notsigned");
        if(notSigned) notSigned.style.display = 'none';
        
        const grid = document.getElementById('recipes');
        if(grid) grid.style.display = 'grid';

        if (user.uid === MY_ADMIN_ID) {
            const adminBtn = document.getElementById('admin-btn');
            if(adminBtn) adminBtn.style.display = 'block';
        }
        
        // Load Data
        loadAllRecipes(); 
        
        // Load Profile Name
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            let userName = user.displayName || user.email.split('@')[0];
            if (userSnap.exists() && userSnap.data().Name) { userName = userSnap.data().Name; }
            updateProfileIcon(userName); 
        } catch (err) { console.error("Error loading profile:", err); }
        
        // Page Specifics
        if (document.getElementById('family-feed')) loadFamilyFeed();
        if (document.getElementById('commentsList')) loadComments();
        if (document.getElementById('plan-Mon')) loadMealPlan();
        if (document.getElementById('chefNotes')) loadUserNote(); // This will work now!

    } else {
        // Guest Handling
        if (document.getElementById('chefNotes')) {
            window.location.href = "homepage.html";
            return;
        }
        const notSigned = document.getElementById("notsigned");
        if(notSigned) notSigned.style.display = 'block';
        
        const grid = document.getElementById('recipes');
        if(grid) grid.style.display = 'none';
        
        resetProfileIcon();
    }
});

// ==========================================
// 2. RECIPE LOADER (1 READ ONLY)
// ==========================================
async function loadAllRecipes() {
    const container = document.getElementById('recipes');
    if(!container) return; // Stop if not on homepage

    container.innerHTML = '<p style="text-align:center; width:100%;">Opening Cookbook...</p>';

    try {
        // 1. Fetch ONLY the Index Document
        const docRef = doc(db, "static_assets", "cookbook_index");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            allRecipes = data.recipes || [];
            console.log(`✅ Index loaded: ${allRecipes.length} recipes. (1 Read Used)`);
            renderLocalList(allRecipes); 
        } else {
            container.innerHTML = "<p style='text-align:center; color:red;'>Index missing. Admin: Please go to Admin Panel and click 'Update Homepage Index'.</p>";
            allRecipes = [];
        }
    } catch (e) { 
        console.error("Load Error:", e);
        container.innerHTML = "<p>Error loading recipes.</p>";
    }
}

function renderLocalList(list) {
    const container = document.getElementById('recipes');
    container.innerHTML = "";
    
    // Alphabetical Sort
    list.sort((a, b) => a.n.localeCompare(b.n));

    let html = "";
    list.forEach(item => {
        // COMPACT CARD TEMPLATE
        html += `
        <div class="recipe-card" onclick="goToRecipe('${item.id}', '${item.n.replace(/'/g, "\\'")}')">
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
    
    if (list.length === 0) {
        container.innerHTML = "<p style='text-align:center'>No recipes found.</p>";
    } else {
        container.innerHTML = html;
    }
}

window.goToRecipe = function(id, name) {
    localStorage.setItem("currentRecipeData", JSON.stringify({ id: id, name: name }));
    window.location.href = `recipe.html?id=${id}`;
};

// ==========================================
// 3. MEAL PLANNER
// ==========================================
function loadMealPlan() {
    const plan = JSON.parse(localStorage.getItem('mealPlan')) || {};
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    days.forEach(day => {
        const element = document.getElementById(`plan-${day}`);
        if (element && plan[day]) {
            element.innerText = plan[day];
            if(element.parentElement) {
                element.parentElement.style.borderColor = "#0d9488";
                element.parentElement.style.backgroundColor = "#f0fdf4";
            }
        }
    });
}

window.clearMealPlan = function() {
    if (confirm("Clear Weekly Menu?")) {
        localStorage.removeItem('mealPlan');
        window.location.reload();
    }
};

// ==========================================
// 4. SEARCH & FILTERS
// ==========================================
function setupSearch() {
    const openBtn = document.getElementById('header-search-btn');
    const overlay = document.getElementById('search-overlay');
    const closeBtn = document.getElementById('close-search');
    const form = document.getElementById('search-form');
    const input = document.getElementById('searchbar');

    if (!openBtn || !overlay) return;

    openBtn.onclick = () => {
        overlay.classList.remove('hidden');
        setTimeout(() => input.focus(), 100);
    };

    if (closeBtn) closeBtn.onclick = () => overlay.classList.add('hidden');

    if (form) {
        form.onsubmit = (e) => {
            e.preventDefault();
            const term = input.value.toLowerCase().trim();
            if (!term) return;

            const filtered = allRecipes.filter(r => {
                const name = (r.n || "").toLowerCase();
                const tags = (r.t || []).join(" ").toLowerCase();
                return name.includes(term) || tags.includes(term);
            });

            renderLocalList(filtered);
            overlay.classList.add('hidden');
            input.value = "";
        }
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

// ==========================================
// 5. CHEF NOTES (THE MISSING PIECE!)
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
    if (!user || !noteBox || !currentRecipe) return;

    try {
        await setDoc(doc(db, "users", user.uid, "private_notes", currentRecipe.id), {
            text: noteBox.value, updatedAt: serverTimestamp(), recipeName: currentRecipe.name
        });
        const status = document.getElementById('saveStatus');
        if(status) {
            status.innerText = "Saved!";
            setTimeout(() => status.innerText = "", 2000);
        }
    } catch (e) { alert("Error saving note"); }
};

// ==========================================
// 6. FEED, COMMENTS & UTILS
// ==========================================
async function loadFamilyFeed() {
    const feedList = document.getElementById('family-feed');
    if (!feedList) return;
    try {
        const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"), limit(3));
        const snapshot = await getDocs(q);
        if (snapshot.empty) { feedList.innerHTML = "<p style='color:#999;font-style:italic;'>No new announcements.</p>"; return; }
        let html = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            const icon = data.type === "new_recipe" ? "🍳" : "📢";
            html += `<div style="padding:10px;border-bottom:1px solid #eee;display:flex;gap:10px;align-items:center;"><div style="font-size:18px;">${icon}</div><div style="font-size:14px;color:#334155;">${data.message}</div></div>`;
        });
        feedList.innerHTML = html;
    } catch (e) { console.error(e); }
}

function loadComments() {
    const list = document.getElementById('commentsList');
    if (!list) return;
    const currentRecipe = JSON.parse(localStorage.getItem("currentRecipeData"));
    if (!currentRecipe) return;
    const q = query(collection(db, "recipes", currentRecipe.id, "comments"), orderBy("timestamp", "asc"));
    onSnapshot(q, (snap) => {
        if(snap.empty){list.innerHTML='<p style="text-align:center;color:#999">No comments.</p>';return;}
        let html='';
        snap.forEach(d=>{
            const dat=d.data(); 
            const init=(dat.author||"G").charAt(0).toUpperCase();
            html+=`<div style="display:flex;gap:10px;margin-bottom:10px;"><div style="background:#0a4d74;color:white;width:25px;height:25px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;">${init}</div><div style="background:#f1f5f9;padding:8px;border-radius:8px;font-size:0.9rem;"><strong>${dat.author}:</strong> ${dat.text}</div></div>`;
        });
        list.innerHTML=html;
    });
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

window.openShoppingModal = function() {
    document.getElementById('shoppingModal').style.display = 'flex';
    document.getElementById('shoppingModal').classList.remove('hidden');
}
window.closeShoppingModal = function() {
    document.getElementById('shoppingModal').style.display = 'none';
}

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

// Init
setTimeout(() => {
    setupSearch();
    setupCategoryFilters();
}, 500);