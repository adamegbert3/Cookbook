// ==========================================
// HOUSEHOLDS — shared weekly menu + shopping list
//
// A household is a small group (a couple, or a whole family) that plans
// meals together. When you're in one, your weekly menu and shopping list
// move from your own account to the household, so whatever your spouse adds
// shows up for you and vice versa.
//
// Storage:
//   households/{id}                     { name, code, members[], createdBy }
//   households/{id}/weekly_plan/{day}   same shape as users/{uid}/weekly_plan
//   households/{id}/settings/shopping_state
//   users/{uid}.householdId             which household you're in (if any)
//
// Not being in a household is completely normal — everything then reads and
// writes exactly where it always did, under your own uid. That fallback is
// what getPlanPath() below encodes, so callers never branch on it.
// ==========================================
import { db } from './firebase-config.js';
import {
    doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
    collection, query, where, arrayUnion, arrayRemove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

// Unambiguous alphabet: no O/0, I/1, so codes are easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateHouseholdCode(length = 6) {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return code;
}

// Returns the household id this user belongs to, or null.
export async function getUserHouseholdId(uid) {
    if (!uid) return null;
    try {
        const snap = await getDoc(doc(db, "users", uid));
        return snap.exists() ? (snap.data().householdId || null) : null;
    } catch (e) {
        console.warn("⚠️ [HOUSEHOLD] Could not read household id:", e.message);
        return null;
    }
}

export async function getHousehold(householdId) {
    if (!householdId) return null;
    try {
        const snap = await getDoc(doc(db, "households", householdId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (e) {
        console.warn("⚠️ [HOUSEHOLD] Could not load household:", e.message);
        return null;
    }
}

// THE key helper: where do this person's meal-plan docs live? Everything
// that touches the weekly plan or shopping list goes through this, so
// household vs solo is decided in exactly one place.
// Returns { segments: [...], householdId }
export async function getPlanPath(uid) {
    const householdId = await getUserHouseholdId(uid);
    return householdId
        ? { segments: ["households", householdId], householdId }
        : { segments: ["users", uid], householdId: null };
}

export async function createHousehold(uid, name) {
    // Retry a few times in the vanishingly unlikely event of a code clash
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateHouseholdCode();
        const existing = await getDocs(query(collection(db, "households"), where("code", "==", code)));
        if (!existing.empty) continue;

        const ref = await addDoc(collection(db, "households"), {
            name: name || "Our Household",
            code,
            members: [uid],
            createdBy: uid,
            createdAt: serverTimestamp()
        });

        await setDoc(doc(db, "users", uid), { householdId: ref.id }, { merge: true });
        console.log(`🏠 [HOUSEHOLD] Created "${name}" with join code ${code}`);
        return { id: ref.id, code, name };
    }
    throw new Error("Could not generate a unique join code — please try again.");
}

export async function joinHouseholdByCode(uid, code) {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) throw new Error("Enter a join code first.");

    const found = await getDocs(query(collection(db, "households"), where("code", "==", clean)));
    if (found.empty) throw new Error("No household found with that code — double-check it and try again.");

    const householdDoc = found.docs[0];
    await updateDoc(doc(db, "households", householdDoc.id), { members: arrayUnion(uid) });
    await setDoc(doc(db, "users", uid), { householdId: householdDoc.id }, { merge: true });

    console.log(`🏠 [HOUSEHOLD] Joined "${householdDoc.data().name}"`);
    return { id: householdDoc.id, ...householdDoc.data() };
}

export async function leaveHousehold(uid, householdId) {
    if (!householdId) return;
    try {
        await updateDoc(doc(db, "households", householdId), { members: arrayRemove(uid) });
    } catch (e) {
        console.warn("⚠️ [HOUSEHOLD] Could not remove membership:", e.message);
    }
    await setDoc(doc(db, "users", uid), { householdId: null }, { merge: true });
    console.log("🏠 [HOUSEHOLD] Left the household — your menu is personal again.");
}

// Used by the admin console to put someone in a household directly.
export async function assignUserToHousehold(uid, householdId) {
    if (householdId) {
        await updateDoc(doc(db, "households", householdId), { members: arrayUnion(uid) });
        await setDoc(doc(db, "users", uid), { householdId }, { merge: true });
    } else {
        await setDoc(doc(db, "users", uid), { householdId: null }, { merge: true });
    }
}

export async function listHouseholds() {
    const snap = await getDocs(collection(db, "households"));
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
