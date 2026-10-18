import test from 'node:test';
import assert from 'node:assert/strict';
import {getLayout,drawScene} from '../game/renderer.js';
function fixture(){
 const calls=[];
 const ctx=new Proxy({drawImage:(im,...args)=>calls.push({type:'image',id:im.id,args}),lineTo:(...args)=>calls.push({type:'line',args})},{get:(target,key)=>target[key]||(()=>{})});
 const canvas={width:390,height:550,getContext:()=>ctx,getBoundingClientRect:()=>({width:390,height:550})};
 const pictures={};for(const name of ['scene-meadow','scene-garden','speaker','snacks','canopy',...['boom','lumi','pix'].flatMap(base=>[base,...['hungry','wet','sheltered','dance'].map(mood=>`${base}-${mood}`)])])pictures[name]={id:name,naturalWidth:100,naturalHeight:100};
 const state={scenario:{zoneIds:['west','center','east','nook','deck'],background:'garden',rainIntensity:1,guests:3},availableItems:[{id:'speaker',category:'music'},{id:'snacks',category:'food'},{id:'canopy',category:'shelter'}],inventory:[]};
 return {calls,canvas,pictures,state};
}
test('layout anchors are finite, unique and normalized at phone/landscape/desktop/share sizes',()=>{
 for(const [w,h]of [[360,400],[390,550],[540,390],[1440,700],[1010,1230],[80,80]])for(const count of [3,4,5,6,7]){
  const layout=getLayout(['west','center','east','nook','deck','hill','pier'].slice(0,count),w,h);assert.equal(layout.length,count);for(const p of layout)assert.ok(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1,JSON.stringify({w,h,p}));assert.equal(new Set(layout.map(p=>`${p.x},${p.y}`)).size,count);
 }
 const desktop=getLayout(['west','center','east','nook','deck'],1440,700);assert.ok(Math.max(...desktop.map(p=>p.x*1440))-Math.min(...desktop.map(p=>p.x*1440))<=650);
});
test('offscreen sizes avoid DOM access, background is top anchored, props sorted by depth',()=>{
 const f=fixture();f.canvas.getBoundingClientRect=()=>{throw Error('Offscreen must not access DOM')};f.state.inventory=[{id:'a',itemId:'snacks',zoneId:'deck'},{id:'b',itemId:'speaker',zoneId:'west'}];
 drawScene(f.canvas,{...f,width:390,height:550,evaluation:{valid:true,needs:{music:true},counts:{food:3},dryGuests:3},mode:'build'});
 assert.equal(f.calls[0].id,'scene-garden');assert.equal(f.calls[0].args[1],0);assert.deepEqual(f.calls.filter(c=>['speaker','snacks'].includes(c.id)).map(c=>c.id),['speaker','snacks']);
});
test('weather variants apply only after invitation; hungry guests and reduced motion are explicit',()=>{
 const f=fixture(),evaluation={valid:false,needs:{music:true},counts:{food:2},dryGuests:2};
 drawScene(f.canvas,{...f,evaluation,mode:'build'});assert.ok(f.calls.some(c=>c.id==='pix-hungry'));assert.ok(!f.calls.some(c=>c.id?.endsWith('wet')));
 f.calls.length=0;drawScene(f.canvas,{...f,evaluation,mode:'preview'});assert.ok(f.calls.some(c=>c.id==='boom-sheltered'));assert.ok(f.calls.some(c=>c.id==='lumi-sheltered'));assert.ok(f.calls.some(c=>c.id==='pix-wet'));assert.equal(f.calls.filter(c=>c.type==='line').length,12);
 f.calls.length=0;drawScene(f.canvas,{...f,evaluation,mode:'preview',reducedMotion:true});assert.equal(f.calls.filter(c=>c.type==='line').length,0);
});
test('missing variant and missing scene fall back to original character and meadow art',()=>{
 const f=fixture();f.state.scenario.background='missing';delete f.pictures['pix-hungry'];drawScene(f.canvas,{...f,evaluation:{valid:false,counts:{food:2}},mode:'build'});assert.equal(f.calls[0].id,'scene-meadow');assert.ok(f.calls.some(c=>c.id==='pix'));
});

test('large parties retain all twelve guests in two visible rows',()=>{
 const f=fixture(),positions=[];const ctx=f.canvas.getContext();ctx.translate=(x,y)=>positions.push({x,y});f.state.scenario.guests=12;f.state.scenario.zoneIds=['west','center','east','nook','deck','hill','pier'];
 drawScene(f.canvas,{...f,evaluation:{valid:true,needs:{music:true},counts:{food:14},dryGuests:14},mode:'build',reducedMotion:true});
 const guests=f.calls.filter(c=>['boom','lumi','pix'].includes(c.id));assert.equal(guests.length,12);assert.equal(new Set(positions.map(p=>p.y)).size,2);assert.ok(positions.every(p=>p.x>0&&p.x<390&&p.y>0&&p.y<550));
});
