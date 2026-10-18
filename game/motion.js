import {FESTIVAL_BPM} from './tempo.js?v=festival13';
/** Small deterministic motion score. No timers, DOM, dependencies or persistent state. */
export function createMotionTimeline(){
 let enteredAt=-10,phaseAt=-10,phase='build',cues=[];
 return {
  enter(time){enteredAt=time;phaseAt=time;phase='build';cues=[];},
  setPhase(next,time){if(next!==phase){phase=next;phaseAt=time;}},
  add(type,time,fields={}){cues.push({...fields,type,at:time});if(cues.length>12)cues.splice(0,cues.length-12);},
  clearActions(){cues=[];},
  snapshot(time){cues=cues.filter(c=>time-c.at<=1.6&&time>=c.at);return {enteredAt,phaseAt,phase,cues:cues.map(c=>({...c}))};}
 };
}
const clamp=n=>Math.max(0,Math.min(1,n));
/** Composite crew art already contains its own motion; keep the shared canvas anchored. */
export function crewFrame(time=0,reducedMotion=false){
 return reducedMotion||!Number.isFinite(time)?0:Math.floor(Math.max(0,time)/.4)%2;
}
function latest(cues,match){for(let i=(cues?.length||0)-1;i>=0;i--)if(match(cues[i]))return cues[i];return null;}
export function guestMotion({time=0,index=0,size=40,mode='build',mood='',celebrate=false,reducedMotion=false,motion={}}={}){
 const still={x:0,y:0,angle:0,scaleX:1,scaleY:1,alpha:1,pose:celebrate&&mode!=='build'&&!mood?'dance':'base'};
 if(reducedMotion)return still;
 const beat=time*Math.PI*2*FESTIVAL_BPM/60+index*.83,breathe=Math.sin(time*2.1+index*1.3);
 const out={...still,x:Math.sin(time*.8+index)*1.2,y:-breathe*.7,angle:Math.sin(time*.9+index)*.014,scaleX:1+breathe*.012,scaleY:1-breathe*.012};
 if(mood==='wet'){out.x=Math.sin(time*17+index)*.55;out.y=1.3-breathe*.4;out.angle=Math.sin(time*13+index)*.009;}
 else if(celebrate&&mode!=='build'){
  const hop=Math.max(0,Math.sin(beat));out.x=Math.sin(beat)*size*.045;out.y=-hop*hop*size*(mood==='sheltered'?.045:.13);
  out.angle=Math.sin(beat)* (mood==='sheltered'?.026:.07);out.scaleX=1-Math.cos(beat)*.025;out.scaleY=1+Math.cos(beat)*.03;
 }
 const cue=latest(motion.cues,c=>['place','upgrade','greet'].includes(c.type));
 if(cue&&mode==='build'){
  const age=time-cue.at-index*.025;
  if(age>=0&&age<.8){const arc=Math.sin(age/.8*Math.PI);out.y-=arc*size*.075;out.angle+=Math.sin(age*9+index)*arc*.045;if(!mood&&age>.12&&age<.65)out.pose='dance';}
 }
 const progress=clamp((time-(motion.enteredAt??-10)-Math.min(index*.035,.28))/.65),ease=1-Math.pow(1-progress,3);
 out.alpha=clamp(progress*2);out.x+=(1-ease)*(index%2?-15:15);out.y+=(1-ease)*16;out.angle+=(1-ease)*(index%2?.06:-.06);
 return out;
}
export function propMotion({time=0,entry,item,mode='build',reducedMotion=false,motion={}}={}){
 const out={x:0,y:0,angle:0,scaleX:1,scaleY:1,alpha:1};if(reducedMotion)return out;
 const last=latest(motion.cues,c=>c.instanceId===entry?.id&&['place','move','upgrade','greet'].includes(c.type));
 if(last){const age=time-last.at;if(age>=0&&age<.65){const greet=last.type==='greet',settle=greet?1+Math.sin(age/.65*Math.PI)*.035:1-.22*Math.exp(-age*9)*Math.cos(age*14);out.scaleX=settle;out.scaleY=settle;out.alpha=greet?1:clamp(age/.1);}}
 if(entry?.helperId)return out;
 if(item?.role==='helper'){
  const beat=time*Math.PI*2*FESTIVAL_BPM/60+(item.category==='music'?0:1.1),performing=mode!=='build';
  if(item.category==='music'){out.y-=Math.abs(Math.sin(beat))*(performing?4:2.8);out.angle=Math.sin(beat)*(performing?.08:.06);out.scaleY*=1+Math.cos(beat)*.015;}else{const serve=Math.pow(Math.max(0,Math.sin(time*1.6+1)),4);out.x=serve*2.5;out.y=-serve*2;out.angle=serve*.09;out.scaleY*=1-serve*.025;}
 }else if(item?.category==='music'&&mode!=='build'){
  const pulse=Math.max(0,Math.sin(time*Math.PI*2*FESTIVAL_BPM/60));out.scaleX*=1+pulse*.018;out.scaleY*=1+pulse*.025;
 }
 return out;
}
