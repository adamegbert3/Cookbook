import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js';
import { doc, getDoc, getDocs, collection, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js';
import { UNITS, emptyKitchen, validateBatch, validateItem, validateMeal, allocateKitchen, shoppingForWeek, cookMeal, todayLocal, addDays, round, draftIngredient, suggestRecipes, previewWeek, checkCapacity } from './kitchen-core.js';
import { scanFoodPhoto } from './food-scan.js';
import { trackEvent } from './telemetry.js';
import { errorCode } from './telemetry-core.js';

const $ = id => document.getElementById(id);
let state=emptyKitchen(), ref=null, unsubscribe=null, user=null, recipes=[], preview=null, editingBatch=null, editingMeal=null, editRevision=0, scanRevision=0, formId=null, scopeGeneration=0;
const uid = () => crypto.randomUUID();
const message = text => { $('kitchen-status').textContent=text; for(const d of document.querySelectorAll('dialog[open]')){let status=d.querySelector('[role=status]');if(!status){status=el('p');status.setAttribute('role','status');d.querySelector('form').append(status);}status.textContent=text;} };
const el = (tag,text,cls) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n; };
function button(text,action) { const b=el('button',text); b.type='button'; b.onclick=()=>perform(b,action); return b; }
async function perform(b,action) { b.disabled=true; try { await action(); } catch(e) { message(e.message || 'Could not save. Please retry.'); } finally { b.disabled=false; } }
function input(label,type,value='') { const l=el('label',label),n=document.createElement('input'); n.type=type;n.value=value;l.append(n);return {label:l,input:n}; }
function select(label,options,value) { const l=el('label',label),n=document.createElement('select'); for(const [v,t] of options)n.append(new Option(t,v)); n.value=value;l.append(n);return {label:l,input:n}; }
function itemFields(item={},batch=false) {
    const box=el('div',undefined,'kitchen-draft'),row=el('div',undefined,'kitchen-row');
    const name=input('Food name','text',item.name||''); name.input.maxLength=120;name.input.required=true;name.input.setAttribute('list','known-foods');name.label.className='food-name';
    const quantity=input('Amount','number',item.quantity??'');quantity.input.min='0.001';quantity.input.step='0.001';quantity.input.required=true;
    const unit=select('Unit',Object.keys(UNITS).map(x=>[x,x==='cup'?'cup (US)':x]),item.unit||'each');
    row.append(name.label,quantity.label,unit.label);box.append(row);
    let location,policy,cutoff,source;
    if(batch) {
        const row2=el('div',undefined,'kitchen-row');
        location=select('Stored in',[['pantry','Pantry'],['fridge','Fridge'],['freezer','Freezer']],item.location||'pantry');
        policy=select('Planning date',[['unknown','Unknown — needs review'],['date','Use by this date'],['none','I confirm no cutoff for planning']],item.datePolicy||'unknown');
        cutoff=input('Planning cutoff','date',item.cutoff||'');
        source=select('Date source',[['unknown','Unknown'],['label','Label (confirmed)'],['user','My chosen date'],['estimate','Estimate (not a safety guarantee)']],item.dateSource||'unknown');
        row2.append(location.label,policy.label,cutoff.label,source.label);box.append(row2);
        const show=()=>{cutoff.label.hidden=policy.input.value!=='date';cutoff.input.required=policy.input.value==='date';};policy.input.onchange=show;show();
    }
    box.dataset.id=uid();
    box.read=()=>({name:name.input.value.trim(),quantity:Number(quantity.input.value),unit:unit.input.value,...(batch?{location:location.input.value,datePolicy:policy.input.value,cutoff:cutoff.input.value,dateSource:source.input.value}:{})});
    box.append(button('Remove row',()=>box.remove()));return box;
}
async function mutate(action,expectedRevision) {
    if(!ref||!user||user.isAnonymous)throw Error('Sign in as a member to save your kitchen.');
    if(!navigator.onLine)throw Error('Connect to the internet before changing inventory or meals.');
    const target=ref, actor=user.uid;
    await runTransaction(db,async tx=>{
        const snap=await tx.get(target),current=snap.exists()?snap.data():emptyKitchen();
        if(expectedRevision!==undefined && current.revision!==expectedRevision)throw Error('Your kitchen changed while you were reviewing. Close and reopen this form, or generate a new preview, before saving.');
        current.templates ||= {}; current.extras ||= {}; current.events ||= [];
        action(current);checkCapacity(current);current.events=current.events.slice(-100);current.revision++;
        tx.set(target,{...current,updatedAt:serverTimestamp(),updatedBy:actor});
    });
    message('Saved to your kitchen.');
}
function log(s,type,name){s.events.push({type,name,date:todayLocal()});}
function render() {
    const foods=$('known-foods');foods.replaceChildren();for(const name of new Set(Object.values(state.batches).map(b=>b.name)))foods.append(new Option(name,name));
    const stock=$('stock-list');stock.replaceChildren();
    for(const [id,b] of Object.entries(state.batches).sort((a,b)=>(a[1].cutoff||'9999').localeCompare(b[1].cutoff||'9999'))) {
        const row=el('div',undefined,'kitchen-item');row.append(el('h3',`${b.name} · ${b.quantity} ${b.unit}`));
        row.append(el('small',`${b.location} · ${b.datePolicy==='date'?'Planning cutoff '+b.cutoff+(b.cutoff<todayLocal()?' · past cutoff':''):b.datePolicy==='unknown'?'Date unknown — excluded from automatic allocation':'No planning cutoff (confirmed)'}`));
        row.append(button('Edit / adjust',()=>openFood(id)),button('Discard batch',async()=>{if(!confirm(`Discard the remaining ${b.name}?`))return;await mutate(s=>{if(!s.batches[id])return;log(s,'discarded',s.batches[id].name);delete s.batches[id];});}));stock.append(row);
    }
    if(!stock.children.length)stock.append(el('p','Your pantry starts here. Add a batch or scan a grocery photo.','muted'));
    const start=$('week-start').value,end=addDays(start,6),allocation=allocateKitchen(state.batches,state.meals),plan=$('meal-list');plan.replaceChildren();
    const overdue=Object.values(state.meals).filter(m=>m.status==='planned'&&m.date<todayLocal()).sort((a,b)=>a.date.localeCompare(b.date));
    if(overdue.length){const warning=el('p',`${overdue.length} past meal(s) still reserve food. Move, skip or remove them. `);warning.append(button('Review oldest meal',()=>{$('week-start').value=overdue[0].date;render();}));plan.append(warning);}
    for(const [id,m] of Object.entries(state.meals).filter(([,m])=>m.date>=start&&m.date<=end).sort((a,b)=>a[1].date.localeCompare(b[1].date))) {
        const row=el('div',undefined,'kitchen-item');row.append(el('h3',m.name),el('small',`${m.date} · ${m.slot} · ${m.status} · ${m.multiplier||1}× recipe`));
        if(m.status==='planned') {
            const missing=(allocation.meals[id]||[]).filter(l=>l.missing>0);row.append(el('p',missing.length?`To buy / untracked: ${missing.map(l=>`${l.missing} ${l.unit} ${l.name}`).join(', ')}`:'Covered by confirmed inventory.','muted'));
            row.append(button('Edit / move',()=>openMeal(m,id)),button('Cooked today',async()=>{
                if(!confirm(`Mark ${m.name} cooked? This deducts its allocated food. ${missing.length?'Missing or untracked ingredients will not be invented or deducted.':''}`))return;
                await mutate(s=>cookMeal(s,id),state.revision);
            }),button('Skip',()=>mutate(s=>{if(s.meals[id]?.status==='planned'){s.meals[id].status='skipped';log(s,'skipped',s.meals[id].name);}})));
        }
        row.append(button('Remove from plan',async()=>{if(!confirm('Remove this plan entry? Food already consumed will not be restored.'))return;await mutate(s=>{delete s.meals[id];});}));plan.append(row);
    }
    if(!plan.children.length)plan.append(el('p','No meals planned for these dates.','muted'));
    const shop=$('shopping-list');shop.replaceChildren();
    for(const r of shoppingForWeek(state,start)) {
        const key=start+'|'+r.key,row=el('div',undefined,'kitchen-item');
        const label=el('label',undefined,'kitchen-check'),check=document.createElement('input');check.type='checkbox';check.checked=!!state.checked[key];check.disabled=r.missing===0;
        label.append(check,el('span',r.missing?`${r.missing} ${r.unit} ${r.name}`:`${r.name} — covered by inventory`));
        check.onchange=()=>perform(check,()=>mutate(s=>{if(check.checked)s.checked[key]=true;else delete s.checked[key];}));
        row.append(label,el('small',`Needed: ${r.required} ${r.unit} · ${r.meals.join(', ')}`));shop.append(row);
    }
    for(const [id,x] of Object.entries(state.extras||{}).filter(([,x])=>x.week===start)) {
        const row=el('div',undefined,'kitchen-item'),label=el('label',undefined,'kitchen-check'),check=document.createElement('input');check.type='checkbox';check.checked=!!x.checked;
        label.append(check,el('span',x.name+' · extra'));check.onchange=()=>perform(check,()=>mutate(s=>{if(s.extras[id])s.extras[id].checked=check.checked;}));
        row.append(label,button('Remove extra',()=>mutate(s=>{delete s.extras[id];})));shop.append(row);
    }
    if(!shop.children.length)shop.append(el('p','Plan a meal to build your list.','muted'));
    const ideas=$('suggestions');ideas.replaceChildren();
    for(const r of suggestRecipes(Object.values(state.templates||{}),state,$('suggest-date').value).slice(0,5)) {
        const row=el('div',undefined,'kitchen-item');row.append(el('h3',r.name),el('small',`${r.covered}/${r.count} ingredients covered · ${r.urgent} batch(es) approaching cutoff`),button('Review and plan',()=>openMeal({...r,date:$('suggest-date').value,slot:'Dinner',multiplier:1})));ideas.append(row);
    }
    if(!ideas.children.length)ideas.append(el('p','Plan a recipe and confirm its ingredient amounts to make it available for suggestions.','muted'));
    const history=$('kitchen-history');history.replaceChildren();for(const x of [...(state.events||[])].reverse().slice(0,15))history.append(el('p',`${x.date} · ${x.type} · ${x.name}`));
}
function openFood(id=null) { editingBatch=id;formId=id||uid();editRevision=state.revision;$('food-fields').replaceChildren(itemFields(id?state.batches[id]:{},true));$('food-dialog').showModal(); }
function openMeal(meal=null,id=null) {
    editingMeal=id;formId=id||uid();editRevision=state.revision;$('recipe-choice').value=meal?.recipeId||'';$('meal-name').value=meal?.name||'';$('meal-date').value=meal?.date||$('suggest-date').value;$('meal-slot').value=meal?.slot||'Dinner';$('meal-multiplier').value=1;
    $('meal-demands').replaceChildren(...(meal?.demands||[{}]).map(i=>itemFields(i)));$('meal-dialog').showModal();
}
$('add-food').onclick=()=>openFood();$('add-meal').onclick=()=>openMeal();$('add-demand').onclick=()=> $('meal-demands').append(itemFields());
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
$('recipe-choice').onchange=()=>{const r=recipes.find(r=>r.id===$('recipe-choice').value);if(!r)return;$('meal-name').value=r.name||r.n||'Recipe';$('meal-demands').replaceChildren(...(r.ingredients||r.recipeIngredient||[]).map(i=>itemFields(draftIngredient(i))));};
$('food-form').onsubmit=e=>{e.preventDefault();perform(e.submitter,async()=>{
    const field=$('food-fields').firstElementChild;if(!field)throw Error('Add a food row first.');const b=validateBatch(field.read()),id=formId;
    await mutate(s=>{s.batches[id]=b;log(s,editingBatch?'adjusted':'added',b.name);},editRevision);$('food-dialog').close();
});};
$('meal-form').onsubmit=e=>{e.preventDefault();perform(e.submitter,async()=>{
    const factor=Number($('meal-multiplier').value);if(!Number.isFinite(factor)||factor<.25||factor>20)throw Error('Choose a multiplier from 0.25 to 20.');
    const demands=[...$('meal-demands').children].map(f=>validateItem(f.read())).map(i=>({...i,quantity:round(i.quantity*factor)}));
    const meal=validateMeal({name:$('meal-name').value,date:$('meal-date').value,slot:$('meal-slot').value,recipeId:$('recipe-choice').value,multiplier:factor,demands}),id=formId;
    await mutate(s=>{if(editingMeal&&s.meals[id]?.status!=='planned')throw Error('This meal has changed. Close and reopen it.');s.meals[id]=meal;if(meal.recipeId)s.templates[meal.recipeId]={name:meal.name,recipeId:meal.recipeId,demands:meal.demands};log(s,'planned',meal.name);},editRevision);$('meal-dialog').close();
});};
$('week-start').value=todayLocal();$('suggest-date').value=todayLocal();$('week-start').onchange=()=>{preview=null;$('accept-week').hidden=true;$('week-preview').replaceChildren();if($('week-start').value)render();};$('suggest-date').onchange=()=>{if($('suggest-date').value)render();};
$('preview-week').onclick=()=>{
    const meals=previewWeek(Object.values(state.templates||{}),state,$('week-start').value);preview={revision:state.revision,meals};const box=$('week-preview');box.replaceChildren();
    const draft=structuredClone(state);meals.forEach((m,i)=>{draft.meals['preview-'+i]=m;});const allocation=allocateKitchen(draft.batches,draft.meals);
    meals.forEach((m,i)=>{const missing=allocation.meals['preview-'+i].filter(l=>l.missing>0);box.append(el('p',`${m.date} · ${m.slot} · ${m.name} — ${missing.length?'To buy: '+missing.map(l=>`${l.missing} ${l.unit} ${l.name}`).join(', '):'Covered by inventory'}`));});if(!meals.length)box.append(el('p','No empty dinner slots or reviewed recipes available.'));$('accept-week').hidden=!meals.length;
};
$('accept-week').onclick=()=>perform($('accept-week'),async()=>{if(!preview)return;const p=preview;const ids=p.meals.map(()=>uid());await mutate(s=>{p.meals.forEach((m,i)=>{s.meals[ids[i]]=m;});log(s,'planned',`${p.meals.length} approved dinner suggestions`);},p.revision);preview=null;$('accept-week').hidden=true;$('week-preview').replaceChildren();});
$('extra-form').onsubmit=e=>{e.preventDefault();perform(e.submitter,async()=>{const name=e.target.elements.name.value.trim();if(!name)return;const id=uid();await mutate(s=>{s.extras[id]={name,week:$('week-start').value,checked:false};});e.target.reset();});};
$('clear-history').onclick=()=>perform($('clear-history'),async()=>{if(!confirm('Remove past cooked/skipped plan entries? Inventory changes and recent activity remain.'))return;await mutate(s=>{for(const [id,m]of Object.entries(s.meals))if(m.date<todayLocal()&&m.status!=='planned')delete s.meals[id];for(const k of Object.keys(s.checked))if(k.slice(0,10)<addDays(todayLocal(),-28))delete s.checked[k];});});
const isLocal=['localhost','127.0.0.1'].includes(location.hostname);$('scan-location').textContent=isLocal?'Connected to the local scanner.':'Open the Cookbook Scanner Mac app and visit My Kitchen there to scan photos. Manual entry works on this website.';$('scan-food').disabled=!isLocal;
$('scan-food').onclick=()=>perform($('scan-food'),async()=>{
    const file=$('food-photo').files[0];if(!file)throw Error('Choose a photo first.');message('Reading your grocery photo…');
    const generation=scopeGeneration,started=performance.now();let drafts;
    try{drafts=await scanFoodPhoto(file);trackEvent('scan_success',{durationMs:performance.now()-started,count:drafts.length});}catch(e){trackEvent('scan_failure',{durationMs:performance.now()-started,code:errorCode(e)});throw e;}
    if(generation!==scopeGeneration)return;scanRevision=state.revision;$('food-drafts').replaceChildren(...drafts.map(d=>itemFields(d,true)));$('save-food-drafts').hidden=!drafts.length;message(drafts.length?'Review every name, amount, unit and date before confirming.':'No foods were readable. Try a closer photo.');
});
$('save-food-drafts').onclick=()=>perform($('save-food-drafts'),async()=>{const batches=[...$('food-drafts').children].map(f=>validateBatch(f.read()));if(!batches.length)throw Error('No batches to save.');const ids=[...$('food-drafts').children].map(f=>f.dataset.id);await mutate(s=>{batches.forEach((b,i)=>{s.batches[ids[i]]=b;log(s,'added',b.name);});},scanRevision);$('food-drafts').replaceChildren();$('save-food-drafts').hidden=true;});
onAuthStateChanged(auth,async current=>{
    const generation=++scopeGeneration;unsubscribe?.();ref=null;user=current;state=emptyKitchen();$('kitchen-content').hidden=true;
    for(const d of document.querySelectorAll('dialog[open]'))d.close();preview=null;$('accept-week').hidden=true;$('week-preview').replaceChildren();$('food-drafts').replaceChildren();$('save-food-drafts').hidden=true;
    if(!user||user.isAnonymous){$('kitchen-scope').textContent='Sign in as a member to use your kitchen.';message('Open the Cookbook sign-in page, then return here.');return;}
    try {
        const profile=await getDoc(doc(db,'users',user.uid));const householdId=profile.data()?.householdId;
        let segments=['users',user.uid],name='Your personal kitchen';
        if(householdId){const household=await getDoc(doc(db,'households',householdId));if(!household.exists()||!household.data().members?.includes(user.uid))throw Error('Your household membership needs updating. Open Settings or ask an admin.');segments=['households',householdId];name=household.data().name+' · shared kitchen';}
        if(generation!==scopeGeneration)return;ref=doc(db,...segments,'kitchen','state');$('kitchen-scope').textContent=name;
        unsubscribe=onSnapshot(ref,snap=>{if(generation!==scopeGeneration)return;state=snap.exists()?snap.data():emptyKitchen();state.templates||={};state.extras||={};$('kitchen-content').hidden=false;try{render();}catch(e){message('Some kitchen data needs review: '+e.message);}},e=>{message('Kitchen data could not be loaded: '+e.message);$('kitchen-content').hidden=true;});
        const recipeSnap=await getDocs(collection(db,'recipes'));if(generation!==scopeGeneration)return;recipes=recipeSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||''));$('recipe-choice').replaceChildren(new Option('Choose a recipe',''));for(const r of recipes)$('recipe-choice').append(new Option(r.name||r.n||'Untitled',r.id));message('Your kitchen is ready.');
    } catch(e){message(e.message);}
});
