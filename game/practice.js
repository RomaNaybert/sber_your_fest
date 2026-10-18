/** Hands-on introduction. Its sandbox inventory is discarded when training ends. */
export function createPractice({snapshot,text,finish}){
 let active=false,index=0,raf=0,last=0;
 const node=document.createElement('section');node.id='practice';node.hidden=true;node.setAttribute('aria-label','Пробуем играть');node.innerHTML='<div class="practice-veil top"></div><div class="practice-veil left"></div><div class="practice-veil right"></div><div class="practice-veil bottom"></div><div id="practice-ring"></div><div id="practice-card" role="status" aria-live="polite"><p id="practice-count"></p><h2 id="practice-title"></h2><p id="practice-copy"></p><div><button id="practice-skip"></button><button id="practice-done" hidden></button></div></div>';document.body.append(node);
 const $=id=>document.getElementById(id),steps=[
  {key:'food',target:'[data-category="food"]'},
  {key:'pickFood',target:'[data-item-id="snacks"]'},
  {key:'placeFood',target:'[data-zone="west"]'},
  {key:'move',target:'[data-instance-id], [data-zone="center"]',state:s=>s.inventory.some(e=>e.itemId==='snacks'&&e.zoneId==='center')},
  {key:'refund',target:'[data-instance-id],#shop-grid',state:s=>s.inventory.length===0},
  {key:'music',target:'[data-category="music"]'},
  {key:'pickMusic',target:'[data-item-id="speaker"]'},
  {key:'placeMusic',target:'[data-zone="west"]'},
  {key:'shelter',target:'[data-category="shelter"]'},
  {key:'decor',target:'[data-category="decoration"]'},
  {key:'crew',target:'[data-category="crew"]'},
  {key:'pickCrew',target:'[data-item-id="helper-musician"]'},
  {key:'assign',target:'[data-zone="west"]',state:s=>s.inventory.some(e=>e.helperId==='helper-musician')},
  {key:'undo',target:'#undo-button'},
  {key:'sound',target:'#sound-button'},
  {key:'soundDone',target:'.sound-controls,.sound-tools,#sound-done',advanceTarget:'#sound-done'},
  {key:'finish',target:'#rehearse-button',done:true}
 ];
 function current(){return steps[index];}
 function sync(){if(!active)return;const step=current(),r=[...document.querySelectorAll(step.target)].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);if(!r.length)return;const x=Math.max(5,Math.min(...r.map(a=>a.left))-5),y=Math.max(5,Math.min(...r.map(a=>a.top))-5),right=Math.min(innerWidth-5,Math.max(...r.map(a=>a.right))+5),bottom=Math.min(innerHeight-5,Math.max(...r.map(a=>a.bottom))+5),w=right-x,h=bottom-y;
 const rect=(selector,left,top,width,height)=>Object.assign(node.querySelector(selector).style,{left:left+'px',top:top+'px',width:Math.max(0,width)+'px',height:Math.max(0,height)+'px'});
 rect('.top',0,0,innerWidth,y);rect('.left',0,y,x,h);rect('.right',right,y,innerWidth-right,h);rect('.bottom',0,bottom,innerWidth,innerHeight-bottom);rect('#practice-ring',x,y,w,h);
 const card=$('practice-card'),cw=Math.min(340,innerWidth-24),ch=card.offsetHeight;let cx=(innerWidth-cw)/2,cy;
 if(innerWidth>innerHeight){const drawer=document.getElementById('drawer').getBoundingClientRect();cx=Math.max(12,drawer.left-cw-12);cy=(step.key==='move'||step.key==='refund')?innerHeight-ch-12:Math.min(innerHeight-ch-12,Math.max(12,y));if(x<drawer.left&&right<drawer.left){cx=drawer.left+12;card.style.width=Math.max(240,drawer.width-24)+'px';}else card.style.width=cw+'px';if(step.key==='soundDone'){cx=12;cy=12;card.style.width='190px';}}
 else{card.style.width=cw+'px';cy=y-ch-18>=12?y-ch-18:bottom+18;if(cy+ch>innerHeight-12){cy=12;const mission=document.getElementById('mission').getBoundingClientRect();if(mission.bottom+ch+12<y)cy=mission.bottom+8;}}
 card.style.left=Math.max(12,Math.min(innerWidth-card.offsetWidth-12,cx))+'px';card.style.top=Math.max(12,Math.min(innerHeight-ch-12,cy))+'px';
 }
 function show(){const s=current();$('practice-count').textContent=text('practice.count',{count:index+1,total:steps.length});$('practice-title').textContent=text('practice.'+s.key+'.title');$('practice-copy').textContent=text('practice.'+s.key+'.copy');$('practice-skip').textContent=text('practice.skip');$('practice-done').textContent=text('practice.done');$('practice-done').hidden=!s.done;sync();}
 function advance(){if(!active||index===steps.length-1)return;index++;show();}
 function stop(completed){active=false;node.hidden=true;cancelAnimationFrame(raf);finish(completed);}
 function loop(time){if(!active)return;if(time-last>100){last=time;const s=current();if(s.state&&s.state(snapshot()))advance();sync();}raf=requestAnimationFrame(loop);}
 document.addEventListener('click',event=>{if(!active||node.contains(event.target))return;const s=current();if(!event.target.closest?.(s.target)){event.preventDefault();event.stopImmediatePropagation();return;}if(!s.state&&!s.done&&(!s.advanceTarget||event.target.closest(s.advanceTarget)))requestAnimationFrame(advance);},true);
 $('practice-skip').onclick=()=>stop(false);$('practice-done').onclick=()=>stop(true);window.addEventListener('resize',sync);
 return{start(){index=0;active=true;node.hidden=false;show();raf=requestAnimationFrame(loop);},stop,get active(){return active;},get step(){return active?{index,total:steps.length,key:current().key}:null;}};
}
