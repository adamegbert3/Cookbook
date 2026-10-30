// Pure, deterministic kitchen calculations. Dates are household calendar dates.
export const UNITS = { g: ['mass', 1], kg: ['mass', 1000], oz: ['mass', 28.349523], lb: ['mass', 453.59237], ml: ['volume', 1], l: ['volume', 1000], tsp: ['volume', 4.928922], tbsp: ['volume', 14.786765], cup: ['volume', 236.58824], each: ['count', 1] };
export const foodKey = value => String(value || '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
export const round = value => Math.round((value + Number.EPSILON) * 1000) / 1000;
export function calendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}
export function addDays(date, count) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10); }
export function todayLocal() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function emptyKitchen() { return { schemaVersion: 1, revision: 0, batches: {}, meals: {}, checked: {}, extras: {}, templates: {}, events: [] }; }
export function validateItem(item) {
    if (!foodKey(item.name) || item.name.length > 120) throw Error('Give each food a name of 1–120 characters.');
    if (!UNITS[item.unit] || !Number.isFinite(item.quantity) || round(item.quantity) <= 0 || item.quantity > 1000000) throw Error('Enter a positive amount and supported unit for every food.');
    return { name: item.name.trim(), quantity: round(item.quantity), unit: item.unit };
}
export function validateBatch(batch) {
    const item = validateItem(batch);
    if (!['pantry','fridge','freezer'].includes(batch.location)) throw Error('Choose pantry, fridge, or freezer.');
    if (!['unknown','none','date'].includes(batch.datePolicy)) throw Error('Confirm the food’s planning date.');
    if (batch.datePolicy === 'date' && !calendarDate(batch.cutoff)) throw Error('Enter a valid use-by planning date.');
    if (!['user','label','estimate','unknown'].includes(batch.dateSource)) throw Error('Choose where the date came from.');
    return { ...item, location: batch.location, datePolicy: batch.datePolicy, cutoff: batch.datePolicy === 'date' ? batch.cutoff : '', dateSource: batch.dateSource };
}
export function validateMeal(meal) {
    if (!calendarDate(meal.date) || !['Breakfast','Lunch','Dinner','Snack'].includes(meal.slot)) throw Error('Choose a date and meal slot.');
    if (!meal.name?.trim() || meal.name.length > 160) throw Error('Enter a meal name.');
    if (!Array.isArray(meal.demands) || !meal.demands.length || meal.demands.length > 50) throw Error('Confirm 1–50 ingredient rows before planning.');
    return { name: meal.name.trim(), recipeId: String(meal.recipeId || ''), date: meal.date, slot: meal.slot,
        multiplier: Number(meal.multiplier) || 1, demands: meal.demands.map(validateItem), status: 'planned' };
}
const slotOrder = { Breakfast: 0, Lunch: 1, Dinner: 2, Snack: 3 };
export function allocateKitchen(batches, meals) {
    const balances = Object.fromEntries(Object.entries(batches).map(([id,b]) => [id, b.quantity * (UNITS[b.unit]?.[1] || 0)]));
    const orderedBatches = Object.entries(batches).sort((a,b) => (a[1].cutoff || '9999').localeCompare(b[1].cutoff || '9999') || a[0].localeCompare(b[0]));
    const results = {};
    for (const [id, meal] of Object.entries(meals).filter(([,m]) => m.status === 'planned').sort((a,b) => a[1].date.localeCompare(b[1].date) || slotOrder[a[1].slot]-slotOrder[b[1].slot] || a[0].localeCompare(b[0]))) {
        const lines = [];
        for (const demand of meal.demands) {
            const unit = UNITS[demand.unit]; if (!unit) throw Error('A planned ingredient has an unsupported unit. Edit the meal.');
            let remaining = demand.quantity * unit[1]; const allocations = [];
            for (const [batchId, batch] of orderedBatches) {
                if (remaining <= 0.000001) break;
                if (foodKey(batch.name) !== foodKey(demand.name) || UNITS[batch.unit]?.[0] !== unit[0] || batch.datePolicy === 'unknown' || (batch.datePolicy === 'date' && batch.cutoff < meal.date)) continue;
                const amount = Math.min(remaining, Math.max(0, balances[batchId] || 0));
                if (amount <= 0) continue;
                balances[batchId] -= amount; remaining -= amount;
                allocations.push({ batchId, quantity: amount / UNITS[batch.unit][1] });
            }
            lines.push({ ...demand, missing: round(Math.max(0,remaining) / unit[1]), allocations });
        }
        results[id] = lines;
    }
    return { meals: results, balances };
}
export function shoppingForWeek(state, start) {
    const end = addDays(start, 6), allocation = allocateKitchen(state.batches, state.meals), groups = {};
    for (const [id, lines] of Object.entries(allocation.meals)) {
        const meal = state.meals[id]; if (meal.date < start || meal.date > end) continue;
        for (const line of lines) {
            const [dimension, factor] = UNITS[line.unit]; const key = foodKey(line.name) + '|' + dimension;
            const row = groups[key] ||= { key, name: line.name, unit: {mass:'g',volume:'ml',count:'each'}[dimension], required:0, missing:0, meals:[] };
            row.required += line.quantity * factor; row.missing += line.missing * factor;
            if (!row.meals.includes(meal.name)) row.meals.push(meal.name);
        }
    }
    return Object.values(groups).map(r => ({ ...r, required:round(r.required), missing:round(r.missing) })).sort((a,b)=>a.name.localeCompare(b.name));
}
export function cookMeal(state, id, now = todayLocal()) {
    const meal = state.meals[id]; if (!meal) throw Error('Meal no longer exists. Refresh and try again.');
    if (meal.status === 'cooked') return false;
    if (meal.status !== 'planned') throw Error('Only a planned meal can be marked cooked.');
    if (meal.date !== now) throw Error('Move this meal to today before recording it as cooked.');
    const lines = allocateKitchen(state.batches, state.meals).meals[id];
    const consumed = {};
    for (const line of lines) for (const allocation of line.allocations) consumed[allocation.batchId]=(consumed[allocation.batchId]||0)+allocation.quantity;
    for (const [batchId,quantity] of Object.entries(consumed)) {
        const batch = state.batches[batchId];
        batch.quantity = round(Math.max(0, batch.quantity - quantity));
        if (batch.quantity === 0) delete state.batches[batchId];
    }
    meal.status = 'cooked';
    state.events.push({ type:'cooked', mealId:id, name:meal.name, date:now, missing: lines.filter(l=>l.missing>0).map(l=>l.name) });
    state.events = state.events.slice(-100); return true;
}
const aliases = { grams:'g',gram:'g',kilograms:'kg',kilogram:'kg',ounces:'oz',ounce:'oz',pounds:'lb',pound:'lb',lbs:'lb',cups:'cup',tablespoon:'tbsp',tablespoons:'tbsp',teaspoon:'tsp',teaspoons:'tsp',liters:'l',liter:'l',milliliters:'ml',pieces:'each',piece:'each' };
export function draftIngredient(raw) {
    let text = String(raw).replace(/½/g,' 1/2').replace(/¼/g,' 1/4').replace(/¾/g,' 3/4').replace(/⅓/g,' 1/3').replace(/⅔/g,' 2/3').trim();
    const match = text.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+([a-zA-Z]+)\.?\s+(.+)$/);
    if (!match) return { name:text, quantity:null, unit:'each', needsReview:true };
    const unit = aliases[match[2].toLowerCase()] || match[2].toLowerCase();
    if (!UNITS[unit]) return { name:text, quantity:null, unit:'each', needsReview:true };
    const quantity = match[1].split(/\s+/).reduce((sum,x)=>sum+(x.includes('/')?Number(x.split('/')[0])/Number(x.split('/')[1]):Number(x)),0);
    return { name:match[3].trim(), quantity:round(quantity), unit, needsReview:true };
}
export function suggestRecipes(recipes, state, date) {
    return recipes.filter(r=>Array.isArray(r.demands) && r.demands.length).map(recipe => {
        const meal = { ...recipe, date, slot:'Dinner', status:'planned' };
        const all = { ...state.meals, suggestion: meal };
        const lines = allocateKitchen(state.batches, all).meals.suggestion;
        const covered = lines.filter(l=>l.missing === 0).length;
        const urgent = new Set(lines.flatMap(l=>l.allocations).filter(a=>state.batches[a.batchId].datePolicy==='date' && state.batches[a.batchId].cutoff<=addDays(date,3)).map(a=>a.batchId)).size;
        return { ...recipe, score: covered/lines.length + urgent, covered, count:lines.length, urgent };
    }).sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name));
}
export function previewWeek(recipes, state, start) {
    const draft = structuredClone(state), proposals = [], used = new Set();
    for (let day=0;day<7;day++) {
        const date=addDays(start,day);
        if (Object.values(draft.meals).some(m=>m.date===date && m.slot==='Dinner')) continue;
        const candidate=suggestRecipes(recipes.filter(r=>!used.has(r.recipeId)),draft,date)[0];
        if (!candidate) break;
        const meal=validateMeal({...candidate,date,slot:'Dinner',multiplier:1});
        proposals.push(meal); draft.meals['preview-'+day]=meal; used.add(candidate.recipeId);
    }
    return proposals;
}
export function checkCapacity(state) {
    if (Object.keys(state.batches).length>200 || Object.keys(state.meals).length>100 || Object.keys(state.extras).length>100 || Object.keys(state.templates||{}).length>100 || Object.keys(state.checked).length>1000 || JSON.stringify(state).length>600000) throw Error('This kitchen has reached its current capacity. Remove old meals or unused batches before adding more.');
}
