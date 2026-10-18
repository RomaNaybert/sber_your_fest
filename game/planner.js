/** Exact bounded multiset planner. No runtime dependencies, geometry or retry penalties. */
export const EFFICIENCY_TOLERANCE=20;
export function createPlanner(items,copy={}){
 const text=(key,params={})=>copyText(copy,PLANNER_COPY,key,params);
 const byId=new Map(items.map(item=>[item.id,item])),cache=new Map(),ratingCache=new Map();
 function analyze(scene){
  const key=JSON.stringify([scene.guests,scene.rainIntensity,scene.zoneIds.length,scene.unlockedItems.slice().sort()]);
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
  const available=scene.unlockedItems.map(id=>byId.get(id)).filter(Boolean),slots=scene.zoneIds.length;
  function baskets(category){
   const list=available.filter(it=>it.role!=='helper'&&it.category===category&&(category!=='shelter'||it.protection>=scene.rainIntensity)),helpers=available.filter(it=>it.role==='helper'&&it.category===category),out=[];
   function attach(ids,cost,capacity,index=0,assignments=[]){
    if(index===helpers.length){out.push({ids,cost,capacity,crew:assignments.length,slots:ids.length,assignments});return;}
    const helper=helpers[index];attach(ids,cost,capacity,index+1,assignments);const used=new Set();
    for(let propIndex=0;propIndex<ids.length;propIndex++){const id=ids[propIndex];if(!helper.boosts[id]||used.has(id)||assignments.some(a=>a.propIndex===propIndex))continue;used.add(id);attach(ids,cost+helper.price,capacity+helper.boosts[id],index+1,[...assignments,{helperId:helper.id,propIndex}]);}
   }
   function visit(i,ids,cost,capacity){if(i===list.length){attach(ids,cost,capacity);return;}const it=list[i];for(let n=0;n<=Math.min(it.maxCount,slots-ids.length);n++)visit(i+1,ids.concat(Array(n).fill(it.id)),cost+n*it.price,capacity+n*(it.capacity||0));}
   visit(0,[],0,0);return out;
  }
  const music=baskets('music').filter(p=>p.capacity>=scene.guests),food=baskets('food'),shelter=scene.rainIntensity?baskets('shelter'):[{ids:[],cost:0,capacity:0,crew:0,slots:0,assignments:[]}],decor=baskets('decoration');
  const minBySlot=Array(slots+1).fill(Infinity),plansBySlot=Array.from({length:slots+1},()=>[]);
  for(const m of music)for(const f of food){const crew=m.crew+f.crew;if(f.capacity<scene.guests+crew||m.slots+f.slots>slots)continue;for(const s of shelter){const n=m.slots+f.slots+s.slots;if(n>slots||(scene.rainIntensity&&s.capacity<scene.guests+crew))continue;const cost=m.cost+f.cost+s.cost;if(cost>minBySlot[n]+EFFICIENCY_TOLERANCE)continue;if(cost<minBySlot[n]){minBySlot[n]=cost;plansBySlot[n]=plansBySlot[n].filter(p=>p.cost<=cost+EFFICIENCY_TOLERANCE);}plansBySlot[n].push({ids:[...m.ids,...f.ids,...s.ids],cost,slots:n,crew,assignments:[...m.assignments,...f.assignments.map(a=>({...a,propIndex:a.propIndex+m.ids.length}))]});}}
  const minCost=Math.min(...minBySlot),plans=plansBySlot.flat();
  const result={minCost,minBySlot,plans,decor};cache.set(key,result);if(cache.size>32)cache.delete(cache.keys().next().value);return result;
 }
 function target(scene){const a=analyze(scene);let decorationTarget=-1,witness=null,totalCost=Infinity,assignments=[];
  for(const p of a.plans)for(const d of a.decor){if(d.slots>2)continue;const cost=p.cost+d.cost;if(p.slots+d.slots>scene.zoneIds.length||cost>scene.budget)continue;if(d.slots>decorationTarget||(d.slots===decorationTarget&&cost<totalCost)){decorationTarget=d.slots;totalCost=cost;witness=[...p.ids,...d.ids];assignments=p.assignments.map(a=>({...a}));}}
  return {decorationTarget:Math.max(0,decorationTarget),witness,assignments,totalCost,minEssentialsCost:a.minCost};
 }
 function rate(scene,inventory,valid){
  const ratingKey=JSON.stringify([scene.guests,scene.rainIntensity,scene.zoneIds.length,scene.budget,scene.unlockedItems.slice().sort(),inventory.map(e=>typeof e==='string'?e:e.itemId+'|'+(e.helperId||'')).sort(),valid]);if(ratingCache.has(ratingKey))return ratingCache.get(ratingKey);
  const a=analyze(scene),t=target(scene),basket=inventory.map(e=>byId.get(typeof e==='string'?e:e.itemId)),helperCost=inventory.reduce((sum,e)=>sum+(e.helperId?byId.get(e.helperId).price:0),0),essentialCost=helperCost+basket.filter(it=>it.category!=='decoration').reduce((sum,it)=>sum+it.price,0),decorationCount=basket.filter(it=>it.category==='decoration').length;
  const allowedSlots=scene.zoneIds.length-decorationCount,minEssentialsCost=Math.min(...a.minBySlot.slice(0,Math.max(0,allowedSlots)+1)),waste=Math.max(0,essentialCost-minEssentialsCost),efficient=Number.isFinite(minEssentialsCost)&&waste<=EFFICIENCY_TOLERANCE,stars=!valid?0:!efficient?1:decorationCount>=t.decorationTarget?3:2;
  const cheapest=a.plans.find(p=>p.cost===minEssentialsCost&&p.slots<=allowedSlots),tip=!valid?text('rules.ratingIncomplete'):!efficient?text('rules.ratingTryPlan'):stars<3?text('rules.ratingDecor'):t.decorationTarget?text('rules.ratingAllHappy'):text('rules.ratingThreeStars');
  const result={stars,efficient,decorationCount,decorationTarget:t.decorationTarget,waste,minEssentialsCost:Number.isFinite(minEssentialsCost)?minEssentialsCost:null,globalMinEssentialsCost:Number.isFinite(a.minCost)?a.minCost:null,essentialCost,efficiencyTolerance:EFFICIENCY_TOLERANCE,tip,cheaperPlan:cheapest?cheapest.ids.slice():[],cheaperAssignments:cheapest?cheapest.assignments.map(a=>({...a})):[]};ratingCache.set(ratingKey,result);if(ratingCache.size>64)ratingCache.delete(ratingCache.keys().next().value);return result;
 }
 return {analyze,target,rate};
}
function hash(seed,index){let v=(seed^Math.imul(index+1,0x9e3779b1))>>>0;v^=v>>>16;v=Math.imul(v,0x21f0aaad);v^=v>>>15;v=Math.imul(v,0x735a2d97);return (v^(v>>>15))>>>0;}
/** A generated scene always admits an affordable efficient plan with visible decoration. */
export function generateScenario(content,index,seed,carryCost=0,planner=createPlanner(content.items,content.copy)){
 const text=(key,params={})=>copyText(content.copy,PLANNER_COPY,key,params);
 const h=hash(seed,index),length=content.scenarios.length,offset=hash(seed,0)%Math.max(1,length-1),direction=hash(seed,1)%2?1:-1,step=index-length,base=content.scenarios[((offset+direction*step)%length+length)%length],weather=content.weatherNames||['sunny','drizzle','rain','storm'].map(key=>text('rules.weather.'+key));
 const scene={id:`journey-${index+1}`,procedural:true,bonus:true,location:base.location,background:base.background,guests:6+((h>>>5)%7),rainIntensity:(h>>>12)%4,zoneIds:content.zones.slice(0,7).map(z=>z.id),unlockedItems:content.items.map(it=>it.id)};
 // A single storm-proof pavilion shelters eight. Never generate an impossible forecast.
 while(!Number.isFinite(planner.analyze(scene).minCost)&&scene.guests>6)scene.guests--;
 const a=planner.analyze(scene),decor=content.items.filter(it=>it.category==='decoration').sort((x,y)=>x.price-y.price),spacePlan=a.plans.filter(p=>p.slots<scene.zoneIds.length).sort((x,y)=>x.cost-y.cost)[0];
 if(!spacePlan||!decor.length)throw new Error(text('generated.invalidPlan'));
 scene.budget=Math.ceil(Math.max(carryCost,spacePlan.cost+decor[0].price+[0,30,60][(h>>>20)%3])/10)*10;
 scene.title=scene.location;scene.forecast=weather[scene.rainIntensity];scene.brief=text('generated.brief',{count:scene.guests,weather:weather[scene.rainIntensity].toLowerCase(),amount:scene.budget});scene.tip=text('generated.tip');scene.success=text('generated.success');
 return scene;
}

const PLANNER_COPY={
  "rules.weather.sunny": "Солнечно",
  "rules.weather.drizzle": "Морось",
  "rules.weather.rain": "Дождь",
  "rules.weather.storm": "Ливень",
  "rules.ratingIncomplete": "Давай проверим, всем ли хватит музыки, еды и места от дождя.",
  "rules.ratingTryPlan": "Можно попробовать другой план. Сравни цены и посмотри, на сколько друзей хватит покупки.",
  "rules.ratingDecor": "Друзьям всего хватило! Теперь можно добавить украшения.",
  "rules.ratingAllHappy": "Друзья довольны, и праздник получился по-твоему!",
  "rules.ratingThreeStars": "Всем хватило, и монеты удалось сберечь. Три звезды!",
  "generated.invalidPlan": "Не удалось собрать площадку. Можно попробовать ещё раз.",
  "generated.brief": "Давай устроим новую встречу! Друзей — {count}, погода — {weather}. У нас {amount} монет. Все покупки приехали с тобой.",
  "generated.tip": "Можно вернуть покупку за полную цену и попробовать другой план. А потом добавить украшения.",
  "generated.success": "Получилось! Друзья рады отправиться дальше."
};

function copyText(copy,fallback,key,params={}){
 const template=typeof copy?.[key]==='string'?copy[key]:fallback[key]||key;
 return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,(token,name)=>Object.prototype.hasOwnProperty.call(params,name)?String(params[name]):token);
}
