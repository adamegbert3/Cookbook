import { db, auth } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "index.html";
        return;
    }
    loadLeaderboard();
});

async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;

    console.log("🏆 [LEADERBOARD] Loading global_cooks...");

    try {
        // Names come from the live profiles, not the copy frozen into each
        // cook record — a record written before the profile loaded got stuck
        // with the generic "Family Member" fallback and would otherwise show
        // up here as a stranger.
        const nameByUid = {};
        try {
            const usersSnap = await getDocs(collection(db, "users"));
            usersSnap.forEach(u => {
                const data = u.data();
                const name = data.Name || (data.email || '').split('@')[0];
                if (name) nameByUid[u.id] = name;
            });
        } catch (e) { console.warn("Could not load profiles for the leaderboard:", e.message); }

        const snap = await getDocs(collection(db, "global_cooks"));
        const byUser = {}; // uid -> { name, recipeIds: Set }

        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.uid) return; // Skip guest/unattributed cooks logged before per-user tracking existed

            if (!byUser[data.uid]) byUser[data.uid] = { name: "Family Member", recipeIds: new Set() };
            // Profile first, then whatever the record stored.
            byUser[data.uid].name = nameByUid[data.uid] || data.chef || byUser[data.uid].name;
            if (data.recipeId) byUser[data.uid].recipeIds.add(data.recipeId);
        });

        const ranked = Object.values(byUser)
            .map(u => ({ name: u.name, count: u.recipeIds.size }))
            .filter(u => u.count > 0)
            .sort((a, b) => b.count - a.count);

        if (ranked.length === 0) {
            list.innerHTML = `
                <div style="text-align:center; color:#94a3b8;">
                    <p style="font-weight:700; color:var(--primary);">🎉 The leaderboard just launched!</p>
                    <p>It only counts recipes marked "I Made This" going forward, so it's empty until someone's first click. Go cook something and be #1!</p>
                </div>`;
            return;
        }

        console.log(`✅ [LEADERBOARD] Ranked ${ranked.length} chef(s).`);
        const medals = ["🥇", "🥈", "🥉"];
        list.innerHTML = ranked.map((u, i) => `
            <div class="leaderboard-row${i < 3 ? ' leaderboard-top' : ''}">
                <div class="leaderboard-rank">${medals[i] || (i + 1)}</div>
                <div class="leaderboard-name">${u.name}</div>
                <div class="leaderboard-count">${u.count} recipe${u.count === 1 ? '' : 's'}</div>
            </div>`).join('');

    } catch (e) {
        console.error("Leaderboard error:", e);
        list.innerHTML = `<p style="text-align:center; color:red;">Could not load leaderboard. Please try again later.</p>`;
    }
}
