/** Session-only festival rules. Pure data evaluation; no storage, network or geometry. */
import {createPlanner,generateScenario} from './planner.js?v=festival13';
export function createGame(content,options={}) {
  const data = validateAndClone(content);
  const text=(key,params={})=>copyText(data.copy,RULE_COPY,key,params);
  const items = new Map(data.items.map(item => [item.id,item]));
  const planner=createPlanner(data.items,data.copy),seed=Number.isFinite(options.seed)?options.seed>>>0:Math.floor(Math.random()*4294967296);
  let generated=null,nextGenerated=null,completedCount=0;
  let scenarioIndex=0,stage='build',inventory=[],history=[],serial=0,attempts=0,lastEvaluation=null,completedScenarios=[];
  const scenario=()=>generated||data.scenarios[scenarioIndex];
  function getNextScenario(){if(scenarioIndex+1<data.scenarios.length)return clone(data.scenarios[scenarioIndex+1]);if(!nextGenerated)nextGenerated=generateScenario(data,scenarioIndex+1,seed,spent(),planner);return clone(nextGenerated);}
  function advance(){const next=getNextScenario();scenarioIndex++;generated=scenarioIndex>=data.scenarios.length?next:null;nextGenerated=null;stage='transfer';history=[];attempts=0;lastEvaluation=null;}
  const crewCount=()=>inventory.filter(entry=>entry.helperId).length;
  const crewAssignments=()=>inventory.filter(entry=>entry.helperId).map(entry=>({helperId:entry.helperId,instanceId:entry.id,zoneId:entry.zoneId,itemId:entry.itemId,boost:items.get(entry.helperId).boosts[entry.itemId]}));
  const spent=()=>inventory.reduce((sum,entry)=>sum+items.get(entry.itemId).price+(entry.helperId?items.get(entry.helperId).price:0),0);
  const editable=()=>stage==='build'||stage==='transfer';
  const checkpoint=()=>{history.push(clone(inventory));lastEvaluation=null;nextGenerated=null;};
  const result=(ok,code,message)=>({ok,...(code?{code,message}:{}),state:getState()});
  function getState(){return clone({stage,scenarioIndex,scenario:scenario(),crewAssignments:crewAssignments(),crewCount:crewCount(),totalAttendees:scenario().guests+crewCount(),availableItems:data.items.filter(item=>scenario().unlockedItems.includes(item.id)),budget:scenario().budget,spent:spent(),remaining:scenario().budget-spent(),inventory,attempts,completedScenarios,completedCount,canUndo:editable()&&history.length>0,lastEvaluation});}
  function placementError(zoneId,ignoreId){
    if(!scenario().zoneIds.includes(zoneId))return ['invalid-zone',text('rules.placeFree')];
    if(inventory.some(entry=>entry.id!==ignoreId&&entry.zoneId===zoneId))return ['occupied',text('rules.placeOccupied')];
    return null;
  }
  function itemError(itemId,ignoreId){
    const item=items.get(itemId);
    if(!item)return ['unknown-item',text('rules.itemMissing')];
    if(!scenario().unlockedItems.includes(itemId))return ['item-locked',text('rules.itemLocked')];
    if(inventory.filter(entry=>entry.id!==ignoreId&&entry.itemId===itemId).length>=item.maxCount)return ['limit',text('rules.itemLimit',{count:item.maxCount})];
    return null;
  }
  function budgetError(total){return total>scenario().budget?['budget',text('rules.budget',{amount:total-scenario().budget})]:null;}
  function buy(itemId,zoneId){
    if(items.get(itemId)?.role==='helper')return assignHelper(itemId,zoneId);
    if(!editable())return result(false,'locked',text('rules.returnToPlan'));
    const error=itemError(itemId)||placementError(zoneId)||budgetError(spent()+items.get(itemId).price);
    if(error)return result(false,...error);
    checkpoint();inventory.push({id:`prop-${++serial}`,itemId,zoneId});return result(true);
  }
  function place(instanceId,zoneId){
    if(!editable())return result(false,'locked',text('rules.returnToPlan'));
    const entry=inventory.find(entry=>entry.id===instanceId);
    if(!entry)return result(false,'unknown-instance',text('rules.instanceMissing'));
    const error=placementError(zoneId,instanceId);if(error)return result(false,...error);
    if(entry.zoneId===zoneId)return result(true);
    checkpoint();entry.zoneId=zoneId;return result(true);
  }
  function replace(instanceId,itemId){
    if(!editable())return result(false,'locked',text('rules.returnToPlan'));
    const entry=inventory.find(entry=>entry.id===instanceId);
    if(!entry)return result(false,'unknown-instance',text('rules.instanceMissing'));
    const error=itemError(itemId,instanceId);if(error)return result(false,...error);
    const oldItem=items.get(entry.itemId),newItem=items.get(itemId);
    if(newItem.role==='helper')return result(false,'helper-not-prop',text('rules.helperNeedsMatch'));
    if(entry.helperId&&!items.get(entry.helperId).boosts[itemId])return result(false,'helper-incompatible',text('rules.moveHelperFirst'));
    if(oldItem.category!==newItem.category&&!(oldItem.role==='helper'&&newItem.role==='helper'))return result(false,'category-mismatch',text('rules.sameCategory'));
    const moneyError=budgetError(spent()-oldItem.price+newItem.price);if(moneyError)return result(false,...moneyError);
    if(entry.itemId===itemId)return result(true);
    checkpoint();entry.itemId=itemId;return result(true);
  }
  function assignHelper(helperId,zoneId){
    if(!editable())return result(false,'locked',text('rules.returnToPlan'));
    const helper=items.get(helperId);
    if(!helper||helper.role!=='helper')return result(false,'unknown-helper',text('rules.helperMissing'));
    if(!scenario().unlockedItems.includes(helperId))return result(false,'item-locked',text('rules.helperLocked'));
    if(!scenario().zoneIds.includes(zoneId))return result(false,'invalid-zone',text('rules.pickHost'));
    const host=inventory.find(entry=>entry.zoneId===zoneId);
    if(!host)return result(false,'helper-needs-prop',text('rules.hostNeeded'));
    if(!helper.boosts[host.itemId])return result(false,'helper-incompatible',text('rules.helperIncompatible'));
    if(host.helperId===helperId)return result(true);
    if(host.helperId)return result(false,'helper-occupied',text('rules.helperOccupied'));
    const previous=inventory.find(entry=>entry.helperId===helperId),error=budgetError(spent()+(previous?0:helper.price));if(error)return result(false,...error);
    checkpoint();if(previous)delete previous.helperId;host.helperId=helperId;return result(true);
  }
  function removeHelper(zoneId){
    if(!editable())return result(false,'locked',text('rules.returnToPlan'));
    const host=inventory.find(entry=>entry.zoneId===zoneId||entry.id===zoneId);
    if(!host?.helperId)return result(false,'no-helper',text('rules.noHelper'));
    checkpoint();delete host.helperId;return result(true);
  }
  function remove(instanceId){
    if(!editable())return result(false,'locked',text('rules.returnToPlan'));
    if(!inventory.some(entry=>entry.id===instanceId))return result(false,'unknown-instance',text('rules.alreadyReturned'));
    checkpoint();inventory=inventory.filter(entry=>entry.id!==instanceId);return result(true);
  }
  function undo(){
    if(!editable())return result(false,'locked',text('rules.returnToPlan'));
    if(!history.length)return result(false,'no-history',text('rules.noUndo'));
    inventory=history.pop();lastEvaluation=null;nextGenerated=null;return result(true);
  }
  function evaluate(){
    const current=scenario(),crew=crewCount(),attendees=current.guests+crew,requirements={music:current.guests,food:attendees,shelter:current.rainIntensity>0?attendees:0};
    const counts={music:0,food:0,shelter:0},baseCounts={music:0,food:0,shelter:0},helperBonuses={music:0,food:0,shelter:0},invalidShelterIds=[],categoryIds={music:[],food:[],shelter:[]};
    for(const entry of inventory){
      const item=items.get(entry.itemId);if(item.category==='decoration')continue;
      categoryIds[item.category].push(entry.id);
      if(item.category==='shelter'&&item.protection<current.rainIntensity){invalidShelterIds.push(entry.id);continue;}
      baseCounts[item.category]+=item.capacity;const boost=entry.helperId?items.get(entry.helperId).boosts[item.id]:0;helperBonuses[item.category]+=boost;counts[item.category]+=item.capacity+boost;
    }
    const deficits=Object.fromEntries(Object.keys(requirements).map(key=>[key,Math.max(0,requirements[key]-counts[key])]));
    const needs=Object.fromEntries(Object.keys(requirements).map(key=>[key,deficits[key]===0]));
    const issues=[];
    if(!needs.music)issues.push({code:'music',deficit:deficits.music,affectedInstanceIds:categoryIds.music,message:text('rules.musicShort',{count:counts.music,need:requirements.music,amount:deficits.music})});
    if(!needs.food)issues.push({code:'food',deficit:deficits.food,affectedInstanceIds:categoryIds.food,message:text('rules.foodShort',{count:counts.food,need:requirements.food,amount:deficits.food})});
    if(!needs.shelter){
      const weakness=invalidShelterIds.length?text('rules.shelterWeak',{details:invalidShelterIds.map(id=>{const item=items.get(inventory.find(entry=>entry.id===id).itemId);const weatherNames=data.weatherNames||['sunny','drizzle','rain','storm'].map(key=>text('rules.weather.'+key));return text('rules.weatherMismatch',{name:item.name,weather:weatherNames[item.protection],current:weatherNames[current.rainIntensity]});}).join('; ')} ):'';
      issues.push({code:'shelter',deficit:deficits.shelter,affectedInstanceIds:invalidShelterIds.length?invalidShelterIds:categoryIds.shelter,message:text('rules.shelterShort',{count:counts.shelter,need:requirements.shelter,amount:deficits.shelter,weather:weakness})});
    }
    const valid=Object.values(needs).every(Boolean),rating=planner.rate(current,inventory,valid);
    return clone({valid,rating,counts,baseCounts,helperBonuses,crewAssignments:crewAssignments(),requirements,deficits,needs,issues,crewCount:crew,totalAttendees:attendees,dryGuests:current.rainIntensity===0?attendees:Math.min(attendees,counts.shelter),invalidShelterIds,spent:spent(),remaining:current.budget-spent()});
  }
  function rehearse(){if(!editable())return result(false,'locked',text('rules.rehearsing'));lastEvaluation=evaluate();attempts++;stage='rehearsal';return result(true);}
  function resumeBuild(){if(stage!=='rehearsal')return result(false,'stage',text('rules.canBuild'));stage=scenarioIndex===0?'build':'transfer';return result(true);}
  function reviseCurrent(){
    if(!['rehearsal','checkpoint','finale'].includes(stage))return result(false,'stage',text('rules.canChange'));
    stage=scenarioIndex===0?'build':'transfer';history=[];lastEvaluation=null;nextGenerated=null;return result(true);
  }
  function nextScenario(){
    if(stage==='checkpoint'||stage==='finale'){advance();return result(true);}
    if(stage!=='rehearsal'||!lastEvaluation?.valid)return result(false,'incomplete',text('rules.incomplete'));
    const record={rating:clone(lastEvaluation.rating),id:scenario().id,location:scenario().location,checkpoint:!!scenario().checkpoint,bonus:!!scenario().bonus,spent:spent(),remaining:scenario().budget-spent(),attempts,independent:scenarioIndex>0&&attempts===1,firstTrySuccess:attempts===1,hadFeedback:attempts>1,inventory:clone(inventory)};
    const existing=completedScenarios.findIndex(entry=>entry.id===record.id);
    if(existing>=0)completedScenarios[existing]=record;else{completedCount++;completedScenarios.push(record);}
    if(completedScenarios.length>32)completedScenarios.splice(6,1);
    history=[];
    if(scenario().checkpoint)stage='checkpoint';
    else if(scenarioIndex+1<data.scenarios.length){advance();}
    else stage='finale';
    return result(true);
  }
  function reset(){scenarioIndex=0;stage='build';inventory=[];history=[];serial=0;attempts=0;lastEvaluation=null;completedScenarios=[];completedCount=0;generated=null;nextGenerated=null;return result(true);}
  return {getState,buy,place,replace,assignHelper,removeHelper,remove,undo,evaluate,rehearse,resumeBuild,nextScenario,getNextScenario,reviseCurrent,reset};
}
function clone(value){return JSON.parse(JSON.stringify(value));}
function validateAndClone(content){
  const fail=()=>{throw new TypeError(copyText(content?.copy,RULE_COPY,'rules.invalidContent'));};
  if(!content||!Array.isArray(content.items)||!content.items.length||!Array.isArray(content.zones)||!content.zones.length||!Array.isArray(content.scenarios)||!content.scenarios.length)fail();
  const data=clone(content),ids=data.items.map(item=>item.id),zoneIds=data.zones.map(zone=>zone.id),categories=['music','food','shelter','decoration'];
  const integer=(value,min)=>Number.isInteger(value)&&value>=min;
  if(new Set(ids).size!==ids.length||new Set(zoneIds).size!==zoneIds.length||[...ids,...zoneIds].some(id=>typeof id!=='string'||!id))fail();
  if(data.items.some(item=>!categories.includes(item.category)||!integer(item.price,0)||!integer(item.maxCount,1)||(item.role!=='helper'&&item.category!=='decoration'&&!integer(item.capacity,1))||(item.role==='helper'&&(!item.boosts||!Object.keys(item.boosts).length||Object.entries(item.boosts).some(([id,boost])=>!integer(boost,1)||!ids.includes(id)||data.items.find(it=>it.id===id).role==='helper'||data.items.find(it=>it.id===id).category!==item.category)))||(item.category==='shelter'&&!integer(item.protection,1))))fail();
  for(let index=0;index<data.scenarios.length;index++){
    const scene=data.scenarios[index],previous=data.scenarios[index-1];
    if(!integer(scene.budget,0)||!integer(scene.guests,1)||!integer(scene.rainIntensity,0)||scene.rainIntensity>3||!Array.isArray(scene.zoneIds)||!scene.zoneIds.length||new Set(scene.zoneIds).size!==scene.zoneIds.length||scene.zoneIds.some(id=>!zoneIds.includes(id))||!Array.isArray(scene.unlockedItems)||!scene.unlockedItems.length||new Set(scene.unlockedItems).size!==scene.unlockedItems.length||scene.unlockedItems.some(id=>!ids.includes(id)))fail();
    if(previous&&(scene.budget<previous.budget||previous.zoneIds.some(id=>!scene.zoneIds.includes(id))||previous.unlockedItems.some(id=>!scene.unlockedItems.includes(id))))fail();
  }
  return data;
}

const RULE_COPY={
  "rules.placeFree": "Давай выберем свободное место.",
  "rules.placeOccupied": "Здесь уже что-то стоит. Можно выбрать другое место или заменить покупку.",
  "rules.itemMissing": "Не вижу эту покупку. Давай выберем другую.",
  "rules.itemLocked": "Эта покупка будет на следующей площадке.",
  "rules.returnToPlan": "Давай сначала вернёмся к плану.",
  "rules.instanceMissing": "Не вижу эту покупку. Давай выберем другую.",
  "rules.helperNeedsMatch": "Давай выберем покупку, с которой поможет этот друг.",
  "rules.moveHelperFirst": "Этот друг с такой покупкой не поможет. Сначала позови его к другой или отпусти.",
  "rules.sameCategory": "Давай выберем замену из того же раздела.",
  "rules.helperMissing": "Не вижу этого друга. Давай выберем другого.",
  "rules.helperLocked": "Этот друг присоединится на следующей площадке.",
  "rules.pickHost": "Давай выберем, с какой покупкой поможет друг.",
  "rules.hostNeeded": "Сначала поставь покупку, а потом позови к ней друга.",
  "rules.helperIncompatible": "Этот друг с такой покупкой не поможет. Давай выберем другую.",
  "rules.helperOccupied": "Здесь уже помогает другой друг.",
  "rules.noHelper": "Здесь пока никто не помогает.",
  "rules.alreadyReturned": "Эту покупку уже вернули.",
  "rules.noUndo": "Пока нечего отменять.",
  "rules.rehearsing": "Друзья уже пробуют твой план.",
  "rules.canBuild": "Уже можно собирать праздник.",
  "rules.canChange": "Уже можно менять план.",
  "rules.incomplete": "Давай сначала устроим праздник, где всем хватит музыки, еды и места от дождя.",
  "rules.itemLimit": "Таких покупок можно взять не больше {count}.",
  "rules.budget": "Не хватает {amount} монет. Можно вернуть покупку или выбрать что-то дешевле.",
  "rules.musicShort": "Музыки хватит для {count} из {need} друзей. Ещё {amount} ждут. Давай добавим музыку или выберем вариант побольше.",
  "rules.foodShort": "Есть {count} порций, а друзей {need}. Ещё нужно {amount}. Можно добавить еду или выбрать угощение побольше.",
  "rules.weatherMismatch": "«{name}» — на погоду «{weather}», а сейчас «{current}»",
  "rules.shelterWeak": " {details}. От такого дождя они не укроют.",
  "rules.shelterShort": "Сухо будет {count} из {need} друзей. Ещё {amount} нужен навес.{weather} Давай найдём укрытие побольше, которое выдержит этот дождь.",
  "rules.invalidContent": "Праздник не загрузился. Давай попробуем ещё раз.",
  "rules.weather.sunny": "Солнечно",
  "rules.weather.drizzle": "Морось",
  "rules.weather.rain": "Дождь",
  "rules.weather.storm": "Ливень"
};

function copyText(copy,fallback,key,params={}){
 const template=typeof copy?.[key]==='string'?copy[key]:fallback[key]||key;
 return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,(token,name)=>Object.prototype.hasOwnProperty.call(params,name)?String(params[name]):token);
}
