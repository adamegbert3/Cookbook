import { db } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js';
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateHouseholdCode(length=16){return Array.from(crypto.getRandomValues(new Uint8Array(length)),n=>ALPHABET[n%ALPHABET.length]).join('');}
export async function getUserHouseholdId(uid){if(!uid)return null;const snap=await getDoc(doc(db,'users',uid));return snap.data()?.householdId||null;}
export async function getHousehold(id){if(!id)return null;const snap=await getDoc(doc(db,'households',id));return snap.exists()?{id:snap.id,...snap.data()}:null;}
export async function getPlanPath(uid){const id=await getUserHouseholdId(uid);if(id){const h=await getHousehold(id);if(!h?.members?.includes(uid))throw Error('Household membership is unavailable. Refresh your account settings.');}return id?{segments:['households',id],householdId:id}:{segments:['users',uid],householdId:null};}
// Lazy invite creation preserves existing household codes without exposing household listings.
export async function ensureHouseholdInvite(id){
    const household=await getHousehold(id);if(!household)return;
    const ref=doc(db,'household_invites',household.code);
    await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists())tx.set(ref,{householdId:id,createdAt:serverTimestamp()});});
    return household;
}
export async function createHousehold(uid,name){
    const ref=doc(collection(db,'households')),code=generateHouseholdCode();
    await runTransaction(db,async tx=>{
        const userRef=doc(db,'users',uid),profile=await tx.get(userRef),oldId=profile.data()?.householdId;
        const old=oldId?await tx.get(doc(db,'households',oldId)):null;
        const inviteRef=doc(db,'household_invites',code),invite=await tx.get(inviteRef);if(invite.exists())throw Error('Please retry creating the household.');
        if(old?.exists())tx.update(old.ref,{members:old.data().members.filter(x=>x!==uid)});
        tx.set(ref,{name:name||'Our Household',code,members:[uid],createdBy:uid,createdAt:serverTimestamp()});
        tx.set(inviteRef,{householdId:ref.id,createdAt:serverTimestamp()});tx.set(userRef,{householdId:ref.id},{merge:true});
    });return {id:ref.id,code,name};
}
export async function joinHouseholdByCode(uid,code){
    const clean=String(code||'').trim().toUpperCase();if(!clean)throw Error('Enter a join code.');
    const invite=await getDoc(doc(db,'household_invites',clean));if(!invite.exists())throw Error('Code not available. Ask a household member to open household settings once, then try again.');
    const id=invite.data().householdId;
    // A signed-in joiner may get this one household only while their profile carries
    // the invite code. The transaction proves possession without making codes public.
    const userRef=doc(db,'users',uid);
    await runTransaction(db,async tx=>{
        const profile=await tx.get(userRef);tx.set(userRef,{pendingHouseholdCode:clean},{merge:true});
    });
    try {
        await runTransaction(db,async tx=>{
            const profile=await tx.get(userRef),houseRef=doc(db,'households',id),house=await tx.get(houseRef);
            if(!house.exists()||house.data().code!==clean)throw Error('That invitation is no longer valid.');
            const oldId=profile.data()?.householdId,old=oldId&&oldId!==id?await tx.get(doc(db,'households',oldId)):null;
            if(old?.exists())tx.update(old.ref,{members:old.data().members.filter(x=>x!==uid)});
            if(!house.data().members.includes(uid))tx.update(houseRef,{members:[...house.data().members,uid]});
            tx.set(userRef,{householdId:id,pendingHouseholdCode:''},{merge:true});
        });
    } catch(e){throw e;}
    return await getHousehold(id);
}
export async function leaveHousehold(uid,id){
    if(!id)return;await runTransaction(db,async tx=>{const h=await tx.get(doc(db,'households',id));if(h.exists())tx.update(h.ref,{members:h.data().members.filter(x=>x!==uid)});tx.set(doc(db,'users',uid),{householdId:null,pendingHouseholdCode:''},{merge:true});});
}
export async function assignUserToHousehold(uid,id){
    await runTransaction(db,async tx=>{
        const profile=await tx.get(doc(db,'users',uid)),oldId=profile.data()?.householdId;
        const old=oldId&&oldId!==id?await tx.get(doc(db,'households',oldId)):null;
        const next=id?await tx.get(doc(db,'households',id)):null;
        if(id&&!next?.exists())throw Error('Household does not exist.');
        if(old?.exists())tx.update(old.ref,{members:old.data().members.filter(x=>x!==uid)});
        if(next)tx.update(next.ref,{members:[...new Set([...next.data().members,uid])]});
        tx.set(doc(db,'users',uid),{householdId:id||null,pendingHouseholdCode:''},{merge:true});
    });
}
export async function listHouseholds(){const snap=await getDocs(collection(db,'households'));return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||''));}
