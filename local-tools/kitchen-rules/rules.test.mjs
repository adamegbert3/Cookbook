import {before, after, beforeEach, test} from 'node:test';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertSucceeds, assertFails} from '@firebase/rules-unit-testing';
import {doc, collection, getDoc, getDocs, setDoc, updateDoc, runTransaction, serverTimestamp} from 'firebase/firestore';
let env;
const state=(uid,revision=1)=>({schemaVersion:1,revision,batches:{},meals:{},templates:{},checked:{},extras:{},events:[],updatedBy:uid,updatedAt:serverTimestamp()});
const db=(uid,anonymous=false)=>env.authenticatedContext(uid,{firebase:{sign_in_provider:anonymous?'anonymous':'password'}}).firestore();
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-cookbook',firestore:{host:'127.0.0.1',port:8089,rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{
 const d=c.firestore();await Promise.all(['alice','bob','carol'].map(uid=>setDoc(doc(d,'users',uid),{role:'user',householdId:uid==='alice'?'home':null})));
 await setDoc(doc(d,'households','home'),{name:'Home',code:'SECRET123',members:['alice'],createdBy:'alice'});
 await setDoc(doc(d,'household_invites','SECRET123'),{householdId:'home'});
 await setDoc(doc(d,'households/home/kitchen/state'),state('alice'));
});});
test('private kitchens and household codes cannot be enumerated or read by outsiders',async()=>{
 for(const d of [env.unauthenticatedContext().firestore(),db('guest',true),db('bob')]){
  await assertFails(getDoc(doc(d,'households/home/kitchen/state')));
  await assertFails(getDoc(doc(d,'households/home')));
  await assertFails(getDocs(collection(d,'households')));
  await assertFails(getDocs(collection(d,'household_invites')));
 }
 await assertSucceeds(getDoc(doc(db('alice'),'households/home/kitchen/state')));
});
test('knowing a household ID or changing your profile does not grant membership',async()=>{
 const d=db('bob');await assertSucceeds(updateDoc(doc(d,'users/bob'),{householdId:'home'}));
 await assertFails(updateDoc(doc(d,'households/home'),{members:['alice','bob']}));
 await assertFails(setDoc(doc(d,'households/home/kitchen/state'),state('bob',2)));
});
test('explicit invite joins work atomically; leaving immediately revokes access',async()=>{
 const d=db('bob');await assertSucceeds(getDoc(doc(d,'household_invites/SECRET123')));
 await assertSucceeds(updateDoc(doc(d,'users/bob'),{pendingHouseholdCode:'SECRET123'}));
 await assertSucceeds(runTransaction(d,async tx=>{const h=doc(d,'households/home');await tx.get(h);tx.update(h,{members:['alice','bob']});tx.update(doc(d,'users/bob'),{householdId:'home',pendingHouseholdCode:''});}));
 await assertSucceeds(getDoc(doc(d,'households/home/kitchen/state')));
 await assertFails(updateDoc(doc(d,'households/home'),{members:['bob']}));
 await assertSucceeds(updateDoc(doc(d,'households/home'),{members:['alice']}));
 await assertFails(getDoc(doc(d,'households/home/kitchen/state')));
});
test('members cannot add strangers or rewrite household metadata',async()=>{
 const d=db('alice');await assertFails(updateDoc(doc(d,'households/home'),{members:['alice','carol']}));
 await assertFails(updateDoc(doc(d,'households/home'),{code:'REPLACED'}));
 await assertFails(updateDoc(doc(d,'households/home'),{name:'Changed'}));
});
test('new household and invitation can be created together',async()=>{
 const d=db('bob');await assertSucceeds(runTransaction(d,async tx=>{
  tx.set(doc(d,'households/new'),{name:'New',code:'NEWSECRET',members:['bob'],createdBy:'bob',createdAt:serverTimestamp()});
  tx.set(doc(d,'household_invites/NEWSECRET'),{householdId:'new',createdAt:serverTimestamp()});
  tx.update(doc(d,'users/bob'),{householdId:'new'});
 }));
});
test('kitchen writes require valid revisions and bounded shape; wildcard cannot bypass them',async()=>{
 const d=db('alice'),r=doc(d,'households/home/kitchen/state');
 await assertFails(setDoc(r,{...state('alice',2),unexpected:true}));
 await assertFails(setDoc(r,state('alice',1)));
 await assertFails(setDoc(r,{...state('alice',2),batches:Object.fromEntries(Array.from({length:201},(_,i)=>[i,{}]))}));
 await assertFails(setDoc(doc(d,'households/home/kitchen/other'),state('alice')));
 await assertSucceeds(setDoc(r,state('alice',2)));
 await assertSucceeds(setDoc(doc(d,'households/home/weekly_plan/Monday'),{recipeId:'legacy'}));
});
test('personal kitchen cannot be read or written by a different user or guest',async()=>{
 await assertSucceeds(setDoc(doc(db('alice'),'users/alice/kitchen/state'),state('alice')));
 await assertFails(getDoc(doc(db('bob'),'users/alice/kitchen/state')));
 await assertFails(setDoc(doc(db('bob'),'users/alice/kitchen/state'),state('bob',2)));
 await assertFails(setDoc(doc(db('guest',true),'users/guest/kitchen/state'),state('guest')));
});
