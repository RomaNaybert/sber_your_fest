/** Focused animation contract tests. No app/runtime edits or wall-clock sleeps. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createMotionTimeline,guestMotion} from '../game/motion.js';
import {drawScene} from '../game/renderer.js';

const content=JSON.parse(readFileSync(new URL('../game/content/scenarios.json',import.meta.url)));
const pictures=Object.fromEntries(readdirSync(new URL('../game/assets/',import.meta.url)).filter(name=>name.endsWith('.webp')).map(name=>[name.slice(0,-5),{id:name.slice(0,-5),naturalWidth:100,naturalHeight:100}]));
function commands(options){
 const calls=[];
 const ctx=new Proxy({}, {get:(_target,key)=>(...args)=>calls.push({method:String(key),args:args.map(arg=>arg?.id?{image:arg.id}:arg)}),set:(_target,key,value)=>{calls.push({property:String(key),value});return true;}});
 const canvas={width:390,height:550,getContext:()=>ctx,getBoundingClientRect:()=>({width:390,height:550})};
 drawScene(canvas,{pictures,...options});return calls;
}
function worstState(){const scenario=content.scenarios.at(-1),ids=['stage','cart','pavilion','flowers','basket','canopy','flowers'];return{scenario,availableItems:content.items,items:content.items,crewCount:2,inventory:ids.map((itemId,i)=>({id:`prop-${i}`,itemId,zoneId:scenario.zoneIds[i],...(i===0?{helperId:'helper-musician'}:i===1?{helperId:'helper-chef'}:{})}))};}
const good={valid:true,needs:{music:true,food:true,shelter:true},counts:{music:13,food:14,shelter:14},dryGuests:14,crewCount:2};

test('motion timeline preserves cue fields, expires short-lived actions, and stays capped',()=>{
 const timeline=createMotionTimeline();timeline.enter(10);timeline.setPhase('party',10.1);timeline.add('place',10.2,{instanceId:'prop-1',zoneId:'west',art:'basket',category:'food'});
 const snapshot=timeline.snapshot(10.3);assert.equal(snapshot.phase,'party');assert.equal(snapshot.enteredAt,10);assert.equal(snapshot.phaseAt,10.1);const cue=snapshot.cues.find(cue=>cue.type==='place');assert.ok(cue);assert.equal(cue.instanceId,'prop-1');assert.equal(cue.zoneId,'west');assert.equal(cue.art,'basket');assert.equal(cue.category,'food');
 assert.ok(timeline.snapshot(11.79).cues.some(cue=>cue.type==='place'));assert.equal(timeline.snapshot(11.81).cues.filter(cue=>cue.type==='place').length,0);
 for(let i=0;i<100;i++)timeline.add('move',20+i*.001,{instanceId:`prop-${i}`});assert.ok(timeline.snapshot(20.1).cues.length<=12);assert.ok(timeline.snapshot(20.1).cues.some(cue=>cue.instanceId==='prop-99'));
});

test('clearActions and a new entrance cannot replay previous celebration/purchase effects',()=>{
 const timeline=createMotionTimeline();timeline.enter(0);timeline.add('upgrade',.1,{instanceId:'old'});timeline.clearActions();assert.equal(timeline.snapshot(.2).cues.length,0);timeline.add('refund',.3,{art:'flowers'});timeline.enter(1);assert.equal(timeline.snapshot(1).enteredAt,1);assert.equal(timeline.snapshot(1).cues.length,0);
});

test('reduced-motion guest transforms and poses are static across time and mood',()=>{
 for(const mood of ['base','hungry','wet','sheltered'])for(const mode of ['build','preview','party','finale']){
  const common={index:4,size:45,mode,mood,celebrate:true,reducedMotion:true,motion:{enteredAt:0,phaseAt:0,phase:mode,cues:[{type:'greet',at:0}]}};
  assert.deepEqual(guestMotion({...common,time:0}),guestMotion({...common,time:5}),`${mode}/${mood}`);
 }
});

test('normal animation moves while all transforms stay finite and bounded',()=>{
 const timeline=createMotionTimeline();timeline.enter(0);timeline.setPhase('party',0);timeline.add('greet',0);
 const frames=[];
 for(const time of [0,.15,.3,.7,1.1,5])for(let index=0;index<12;index++){
  const value=guestMotion({time,index,size:38,mode:'party',mood:'base',celebrate:true,reducedMotion:false,motion:timeline.snapshot(time)});for(const key of ['x','y','angle','scaleX','scaleY','alpha'])assert.ok(Number.isFinite(value[key]),`${key}:${JSON.stringify(value)}`);assert.ok(value.scaleX>0&&value.scaleY>0&&value.scaleX<4&&value.scaleY<4);assert.ok(value.alpha>=0&&value.alpha<=1);if(index===0)frames.push(value);
 }
 assert.ok(frames.some(frame=>JSON.stringify(frame)!==JSON.stringify(frames[0])),'Animation must change actual transforms');
});

test('reduced-motion renderer produces identical complete Canvas commands at time0/time5',()=>{
 const state=worstState(),motion={enteredAt:0,phaseAt:0,phase:'party',cues:[{type:'place',at:0,instanceId:'prop-0',zoneId:'west',art:'stage',category:'music'},{type:'greet',at:0}]};
 const options={state,evaluation:good,mode:'party',reducedMotion:true,motion};assert.deepEqual(commands({...options,time:0}),commands({...options,time:5}));
});

// Real renderer image selection: each assigned host must animate its own pair.
test('all seven assigned hosts alternate real art keys, reduced motion is static and loading falls back',()=>{
 const pairs=['speaker','acoustic','stage','basket','snacks','feast','cart'];
 for(const id of pairs){const frame0={id:'crew-'+id+'-0',naturalWidth:256,naturalHeight:256},frame1={...frame0,id:'crew-'+id+'-1'},art={...pictures,[frame0.id]:frame0,[frame1.id]:frame1};const state={scenario:content.scenarios[3],items:content.items,inventory:[{id:'assigned',itemId:id,zoneId:'west',helperId:['speaker','acoustic','stage'].includes(id)?'helper-musician':'helper-chef'}]};const opts={state,pictures:art,evaluation:good,mode:'build'};
 const images=t=>commands({...opts,time:t}).filter(c=>c.method==='drawImage').map(c=>c.args[0].image);assert.ok(images(0).includes(frame0.id));assert.ok(images(.45).includes(frame1.id));
 assert.ok(commands({...opts,time:.45,reducedMotion:true}).some(c=>c.method==='drawImage'&&c.args[0].image===frame0.id));
 delete art[frame1.id];assert.ok(images(.45).includes(frame0.id));delete art[frame0.id];assert.ok(images(.45).includes(id));
 }
});
