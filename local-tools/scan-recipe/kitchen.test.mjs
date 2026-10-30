import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyKitchen, validateBatch, validateMeal, allocateKitchen, shoppingForWeek, cookMeal, draftIngredient, previewWeek, calendarDate } from '../../scripts/kitchen-core.js';
import { parseFoodScan } from '../../scripts/food-scan.js';
const batch=(quantity,cutoff='2026-11-02',unit='g')=>({name:'chicken',quantity,unit,location:'fridge',datePolicy:'date',dateSource:'user',cutoff});
const meal=(quantity,date='2026-10-30')=>({name:'Chicken dinner',date,slot:'Dinner',status:'planned',demands:[{name:'chicken',quantity,unit:'g'}],multiplier:1});
test('stock is allocated once across meals, and shortages are added across a week',()=>{
 const s=emptyKitchen();s.batches.a=batch(900);s.meals.a=meal(600);s.meals.b=meal(700,'2026-10-31');
 assert.equal(shoppingForWeek(s,'2026-10-29')[0].missing,400);
 assert.equal(s.batches.a.quantity,900);
});
test('food must be usable on the meal date; unknown dates and incompatible units never cover demand',()=>{
 const s=emptyKitchen();s.batches.a=batch(900,'2026-10-30');s.batches.b={...batch(1000),datePolicy:'unknown'};s.batches.c=batch(1000,'2026-11-05','ml');s.meals.a=meal(600);s.meals.b=meal(700,'2026-10-31');
 assert.equal(shoppingForWeek(s,'2026-10-29')[0].missing,700);
});
test('earliest cutoff is used first, and compatible mass units convert',()=>{
 const s=emptyKitchen();s.batches.late=batch(1,'2026-11-02','kg');s.batches.early=batch(300,'2026-10-30');s.meals.a=meal(600);
 const lines=allocateKitchen(s.batches,s.meals).meals.a;
 assert.equal(lines[0].allocations[0].batchId,'early');assert.equal(lines[0].allocations[1].quantity,.3);assert.equal(lines[0].missing,0);
});
test('cook confirmation consumes exactly once and cannot consume a past/future meal',()=>{
 const s=emptyKitchen();s.batches.a=batch(900);s.meals.a=meal(600);
 assert.throws(()=>cookMeal(s,'a','2026-10-29'),/today/);
 assert.equal(cookMeal(s,'a','2026-10-30'),true);assert.equal(s.batches.a.quantity,300);
 assert.equal(cookMeal(s,'a','2026-10-30'),false);assert.equal(s.events.length,1);assert.equal(s.batches.a.quantity,300);
});
test('preview preserves occupied slots, avoids duplicate suggestions, and does not mutate inventory',()=>{
 const s=emptyKitchen();s.batches.a=batch(900);s.meals.manual=meal(100,'2026-10-30');
 const before=JSON.stringify(s);const p=previewWeek([{recipeId:'one',name:'One',demands:meal(200).demands},{recipeId:'two',name:'Two',demands:meal(200).demands}],s,'2026-10-30');
 assert.equal(p.length,2);assert.equal(p[0].date,'2026-10-31');assert.notEqual(p[0].recipeId,p[1].recipeId);assert.equal(JSON.stringify(s),before);
});
test('ingredient drafts leave ambiguous amounts for review and validate calendar dates',()=>{
 assert.equal(draftIngredient('1 1/2 cups flour').quantity,1.5);assert.equal(draftIngredient('½ cup flour').quantity,.5);
 assert.equal(draftIngredient('salt to taste').quantity,null);assert.equal(draftIngredient('2 large onions').quantity,null);
 assert.equal(calendarDate('2026-02-30'),false);
 assert.throws(()=>validateBatch({...batch(1),cutoff:'2026-02-30'}),/valid/);
 assert.throws(()=>validateMeal({...meal(0),demands:meal(0).demands}),/positive/);
});
test('food photos become unconfirmed batches, never safety-certified or automatically dated stock',()=>{
 const [f]=parseFoodScan({response:JSON.stringify({foods:[{name:'milk',quantity:1,unit:'l',labelDate:'2026-11-01'}]})});
 assert.equal(f.datePolicy,'unknown');assert.equal(f.dateSource,'unknown');assert.equal(f.cutoff,'2026-11-01');
 assert.throws(()=>parseFoodScan({response:'{}'}),/Unexpected/);
 assert.throws(()=>parseFoodScan({done_reason:'length',response:'{}'}),/cut off/);
});
