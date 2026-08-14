// 📴 OFFLINE RECIPE DRAFTS — captures recipes into localStorage on THIS
// device with no network involved at all, so it works with zero signal
// (airplane mode, a road trip, etc). Nothing touches Firestore until
// "Upload All" is tapped while back online.
//
// Deliberately does NOT auth-gate the form itself. Firebase Auth can fail
// to ever resolve while offline (it tries to reach apis.google.com at
// startup and onAuthStateChanged simply never fires if that fails — see
// the note in scripts/main.js), so gating on login here would risk the
// form never appearing at all on a device with no signal. Auth is only
// needed — and only checked — at upload time, when the device is online by
// definition.
import { db, auth } from './firebase-config.js';
import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { buildRecipeFields, DIETARY_TAGS } from './recipe-model.js';

const QUEUE_KEY = 'offlineRecipeDrafts';

document.getElementById('dietary').innerHTML = DIETARY_TAGS.map(tag => `
    <label class="dietary-check"><input type="checkbox" value="${tag}"> ${tag}</label>`).join('');

// ==========================================
// CONNECTION STATUS
// ==========================================
function updateConnectionStatus() {
    const banner = document.getElementById('status-banner');
    const uploadBtn = document.getElementById('upload-all-btn');
    const online = navigator.onLine;

    banner.className = `status-banner ${online ? 'online' : 'offline'}`;
    banner.innerText = online
        ? "🌐 Online — you can upload your saved drafts now."
        : "📴 Offline — drafts are saving to this device only.";

    uploadBtn.style.display = (online && loadQueue().length > 0) ? 'block' : 'none';
}

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

// ==========================================
// QUEUE (localStorage only)
// ==========================================
function loadQueue() {
    try {
        const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch (e) {
        return [];
    }
}

function saveQueue(list) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
}

function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderQueue() {
    const list = loadQueue();
    document.getElementById('queue-count').innerText = list.length;

    const container = document.getElementById('queue-list');
    container.innerHTML = list.length === 0
        ? '<p class="queue-empty">Nothing saved yet.</p>'
        : list.map(d => `
            <div class="queue-item">
                <div>
                    <div class="qi-name">${escapeHtml(d.name || 'Untitled')}</div>
                    <div class="qi-meta">From: ${escapeHtml(d.author || 'Family')} · saved ${new Date(d.savedAt).toLocaleString()}</div>
                </div>
                <div class="qi-actions">
                    <button type="button" class="pill-btn btn-slate" onclick="editDraft('${d.localId}')">✏️ Edit</button>
                    <button type="button" class="pill-btn btn-slate" onclick="deleteDraft('${d.localId}')">🗑️</button>
                </div>
            </div>`).join('');

    updateConnectionStatus();
}

let editingLocalId = null;

function resetForm() {
    document.getElementById('submitForm').reset();
    document.querySelectorAll('#dietary input').forEach(cb => cb.checked = false);
    editingLocalId = null;
    document.getElementById('form-heading').innerText = "📝 New Draft";
    document.getElementById('save-draft-btn').innerText = "💾 Save to This Device";
}

window.editDraft = function(localId) {
    const draft = loadQueue().find(d => d.localId === localId);
    if (!draft) return;

    document.getElementById('title').value = draft.name || '';
    document.getElementById('chef').value = draft.author || '';
    document.getElementById('ingredients').value = draft.ingredientsText || '';
    document.getElementById('instructions').value = draft.instructionsText || '';
    document.getElementById('category').value = draft.category || 'Miscellaneous';
    document.getElementById('family').value = draft.family || 'Both';
    document.getElementById('notes').value = draft.notes || '';
    document.getElementById('sourceUrl').value = draft.sourceUrl || '';
    document.querySelectorAll('#dietary input').forEach(cb => {
        cb.checked = Array.isArray(draft.dietary) && draft.dietary.includes(cb.value);
    });

    editingLocalId = localId;
    document.getElementById('form-heading').innerText = "✏️ Editing Draft";
    document.getElementById('save-draft-btn').innerText = "💾 Update This Device";
    document.getElementById('submitForm').scrollIntoView({ behavior: 'smooth' });
};

window.deleteDraft = function(localId) {
    if (!confirm("Remove this draft from this device? This can't be undone.")) return;
    saveQueue(loadQueue().filter(d => d.localId !== localId));
    if (editingLocalId === localId) resetForm();
    renderQueue();
};

document.getElementById('submitForm').addEventListener('submit', (e) => {
    e.preventDefault();

    const draft = {
        localId: editingLocalId || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: document.getElementById('title').value.trim(),
        author: document.getElementById('chef').value.trim(),
        ingredientsText: document.getElementById('ingredients').value,
        instructionsText: document.getElementById('instructions').value,
        category: document.getElementById('category').value,
        family: document.getElementById('family').value,
        notes: document.getElementById('notes').value.trim(),
        sourceUrl: document.getElementById('sourceUrl').value.trim(),
        dietary: Array.from(document.querySelectorAll('#dietary input:checked')).map(cb => cb.value),
        savedAt: editingLocalId ? (loadQueue().find(d => d.localId === editingLocalId)?.savedAt || new Date().toISOString()) : new Date().toISOString()
    };

    const list = loadQueue();
    const existingIndex = list.findIndex(d => d.localId === draft.localId);
    if (existingIndex >= 0) list[existingIndex] = draft;
    else list.push(draft);
    saveQueue(list);

    resetForm();
    renderQueue();
    console.log(`📴 [OFFLINE] Saved "${draft.name}" to this device. ${list.length} total queued.`);
});

// ==========================================
// UPLOAD (only runs once actually online)
// ==========================================
window.uploadAllDrafts = async function() {
    const statusEl = document.getElementById('upload-status');
    const btn = document.getElementById('upload-all-btn');

    if (!navigator.onLine) {
        statusEl.innerText = "❌ Still offline — try again once you have signal.";
        return;
    }

    let list = loadQueue();
    if (list.length === 0) return;

    btn.disabled = true;
    statusEl.innerText = "⏳ Checking you're logged in...";

    // Online now, so this resolves quickly — but still guarded with a
    // timeout rather than trusting that unconditionally.
    const user = await Promise.race([
        new Promise((resolve) => {
            const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
        }),
        new Promise((resolve) => setTimeout(() => resolve(auth.currentUser || null), 5000))
    ]);

    if (!user) {
        statusEl.innerHTML = `❌ You're not logged in. <a href="index.html">Log in</a>, then come back to this page — your drafts are still saved.`;
        btn.disabled = false;
        return;
    }

    let uploaded = 0, failed = 0;
    const stillQueued = [];

    for (let i = 0; i < list.length; i++) {
        const draft = list[i];
        statusEl.innerText = `⏳ Uploading ${i + 1} of ${list.length}: "${draft.name}"...`;

        try {
            const ingredientFields = buildRecipeFields(draft.ingredientsText, 'ingredients');
            const instructionFields = buildRecipeFields(draft.instructionsText, 'instructions');

            // Exactly the same shape and destination as a normal submit.html
            // submission — this is just that same form, filled out earlier
            // with no signal. Goes to the review queue like any other
            // submission; nothing here needs the Testing Kitchen (that's for
            // a recipe you want to cook and verify yourself first — these
            // are hand-typed from a known source, not something to test).
            await addDoc(collection(db, "pending_recipes"), {
                name: draft.name,
                author: draft.author,
                submittedBy: user.email,
                uid: user.uid,
                category: draft.category,
                ...ingredientFields,
                ...instructionFields,
                notes: draft.notes || "",
                sourceUrl: draft.sourceUrl || "",
                family: draft.family || 'Both',
                dietary: draft.dietary || [],
                timestamp: serverTimestamp(),
                status: "pending"
            });

            uploaded++;
        } catch (err) {
            console.error(`🔥 [OFFLINE] Upload failed for "${draft.name}":`, err);
            failed++;
            stillQueued.push(draft); // keep it queued so nothing is lost
        }
    }

    saveQueue(stillQueued);
    renderQueue();
    btn.disabled = false;

    statusEl.innerText = failed === 0
        ? `✅ Uploaded all ${uploaded} — waiting in the review queue, same as any other submission.`
        : `⚠️ Uploaded ${uploaded}, ${failed} failed and are still saved here — try "Upload All" again.`;
};

renderQueue();
