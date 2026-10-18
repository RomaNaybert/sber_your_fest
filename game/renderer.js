import {guestMotion,propMotion,crewFrame} from './motion.js?v=festival13';
/** Canvas presentation only. Coordinates are ground anchors, normalized to the world. */
export function getLayout(zoneIds,width,height){
  const w=Math.max(1,width),h=Math.max(1,height),portrait=h>w;
  const expanded=zoneIds.length>5;
  const header=Math.min(portrait?175:145,h*(expanded?.375:.42));
  const field=Math.min(650,Math.max(1,w-36)),left=(w-field)/2;
  let top=Math.max(0,Math.min(h-100,Math.max(header+(expanded&&h<450?64:80),h*.47)));
  let bottom=Math.max(top,Math.min(h-(expanded?112:70),Math.max(top+82,h*.72)));
  if(expanded&&bottom===top)bottom=Math.min(h,top+h*.2);
  // Short landscape fields can otherwise collapse the two prop rows into one another.
  if(expanded&&bottom-top<36)top=Math.max(0,bottom-36);
  const count=zoneIds.length;
  const points=count<=3?[[.26,top],[.74,top],[.5,bottom]]:
    count===4?[[.27,top],[.73,top],[.27,bottom],[.73,bottom]]:
    count===5?[[.17,top],[.5,top],[.83,top],[.31,bottom],[.69,bottom]]:
    count===6?[[.15,top],[.5,top],[.85,top],[.15,bottom],[.5,bottom],[.85,bottom]]:
    [[.1,top],[.365,top],[.635,top],[.9,top],[.17,bottom],[.5,bottom],[.83,bottom]];
  return zoneIds.map((id,index)=>{const [x,y]=points[index]||[.5,bottom];return{id,x:(left+x*field)/w,y:y/h};});
}

export function drawScene(canvas,{state,evaluation,pictures,time=0,mode='build',reducedMotion=false,selectedInstance=null,highlightedIds=[],width,height,motion={enteredAt:-10,phaseAt:-10,cues:[]}}){
  if(!canvas||!state?.scenario)return;
  const rect=width&&height?{width,height}:canvas.getBoundingClientRect();
  const w=width||rect.width,h=height||rect.height;
  if(!w||!h)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const scene=state.scenario,inventory=state.inventory||[],t=Number.isFinite(time)?time:0;
  const layout=getLayout(scene.zoneIds,w,h),positions=new Map(layout.map(zone=>[zone.id,{x:zone.x*w,y:zone.y*h}]));
  const definitions=new Map((state.availableItems||state.items||[]).map(item=>[item.id,item]));
  const highlighted=highlightedIds instanceof Set?highlightedIds:new Set(highlightedIds||[]);
  const image=name=>{const img=pictures?.[name];return img?.naturalWidth?img:null;};
  const still=mode==='build',celebrate=evaluation?.valid&&evaluation?.needs?.music;
  const rainy=!still&&scene.rainIntensity>0;
  const expanded=scene.zoneIds.length>5;
  const header=Math.min(h>w?175:145,h*(expanded?.375:.42));
  ctx.save();ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#243528';ctx.fillRect(0,0,w,h);
  const background=image(`scene-${scene.background}`)||image('scene-meadow');
  if(background){const scale=Math.max(w/background.naturalWidth,h/background.naturalHeight),bw=background.naturalWidth*scale,bh=background.naturalHeight*scale;ctx.drawImage(background,(w-bw)/2,0,bw,bh);}
  const rowValues=[...new Set(layout.map(zone=>Math.round(zone.y*h)))].sort((a,b)=>a-b);
  const columnCap=expanded?Math.max(45,(Math.min(650,w-36))/(scene.zoneIds.length===7?4:3)-8):Infinity;
  const propBase=Math.min(105,columnCap,Math.max(85,w*.235));
  for(const entry of [...inventory].sort((a,b)=>(positions.get(a.zoneId)?.y||0)-(positions.get(b.zoneId)?.y||0))){
    const point=positions.get(entry.zoneId);if(!point)continue;
    const item=definitions.get(entry.itemId),shelter=item?.category==='shelter'||['umbrella','canopy','pavilion'].includes(entry.itemId);
    const base=image(item?.art||entry.itemId);
    const crewBase=entry.helperId?image(`crew-${entry.itemId}-0`):null;
    // Both frames share a canvas and ground baseline. Frame zero is also a safe loading fallback.
    const img=entry.helperId?(image(`crew-${entry.itemId}-${crewFrame(t,reducedMotion)}`)||crewBase||base):base;
    if(!img)continue;
    const row=rowValues.findIndex(y=>Math.abs(y-point.y)<2);
    const maxHeight=Math.max(24,Math.min(105,row>0?point.y-rowValues[row-1]-12:point.y-header-12));
    let spriteW=Math.min(columnCap,shelter?110:propBase,shelter?w*.29:propBase),spriteH=spriteW*img.naturalHeight/img.naturalWidth;
    if(spriteH>maxHeight){spriteW*=maxHeight/spriteH;spriteH=maxHeight;}
    const selected=entry.id===selectedInstance;
    const warning=highlighted.has(entry.id);
    ctx.save();if(selected){ctx.shadowColor='#fff6a8';ctx.shadowBlur=12;}
    const pm=propMotion({time:t,entry,item,mode,reducedMotion,motion});
    ctx.globalAlpha=pm.alpha;ctx.translate(point.x+pm.x,point.y+pm.y);ctx.rotate(pm.angle);ctx.scale(pm.scaleX,pm.scaleY);
    ctx.drawImage(img,-spriteW/2,-spriteH,spriteW,spriteH);ctx.restore();
    if(selected||warning){ctx.save();ctx.strokeStyle=selected?'#fff8b2':'#ffbb82';ctx.lineWidth=selected?2.5:2;ctx.setLineDash(warning?[4,4]:[]);ctx.beginPath();ctx.ellipse(point.x,point.y+2,Math.max(20,spriteW*.49),7,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
  }
  if(!reducedMotion)drawActionEffects(ctx,{motion,time:t,positions,image});
  const count=scene.guests||3,multiRow=count>8,baseSize=count<=3?54:count<=5?45:multiRow?30:38;
  const size=Math.min(65,baseSize*Math.min(1.35,w/390));
  const rowCount=multiRow?Math.ceil(count/2):count;
  const spacing=Math.min(size*(rainy?1.27:.95),(w-48)/Math.max(1,rowCount-1));
  const groupWidth=(rowCount-1)*spacing;
  const friendBottom=h-(multiRow?7:18);
  const food=evaluation?.counts?.food??count;
  const dry=evaluation?.dryGuests??0;
  for(let index=0;index<count;index++){
    const base=['boom','lumi','pix'][index%3];
    const mood=rainy?(index<dry?'sheltered':'wet'):index>=food?'hungry':'';
    const gm=guestMotion({time:t,index,size,mode,mood,celebrate,reducedMotion,motion});
    const variant=mood||(gm.pose==='dance'?'dance':'');
    const img=image(variant?`${base}-${variant}`:base)||image(base);if(!img)continue;
    const guestRow=multiRow?Math.floor(index/rowCount):0,guestColumn=index%rowCount;
    const actualRowCount=multiRow&&guestRow===1?count-rowCount:rowCount;
    let x=w*.5-(actualRowCount-1)*spacing/2+guestColumn*spacing,y=friendBottom-(multiRow&&guestRow===0?size*1.45:0),angle=0;
    const groundY=y;x+=gm.x;y+=gm.y;angle=gm.angle;
    ctx.save();ctx.globalAlpha=gm.alpha*.12;ctx.fillStyle='#33354b';ctx.beginPath();ctx.ellipse(x,groundY+1,size*.32,size*.075,0,0,Math.PI*2);ctx.fill();ctx.restore();
    const wantedWidth=size*(variant==='sheltered'?1.3:variant==='dance'?1.14:1),maxHeight=size*(variant==='sheltered'?1.85:1.25);
    const spriteH=Math.min(maxHeight,wantedWidth*img.naturalHeight/img.naturalWidth),spriteW=spriteH*img.naturalWidth/img.naturalHeight;
    ctx.save();ctx.globalAlpha=gm.alpha;ctx.translate(x,y);ctx.rotate(angle);ctx.scale(gm.scaleX,gm.scaleY);ctx.drawImage(img,-spriteW/2,-spriteH,spriteW,spriteH);ctx.restore();
  }
  if(!reducedMotion)drawCelebration(ctx,{time:t,mode,motion,width:w,height:h,celebrate});
  if(rainy&&!reducedMotion&&(mode==='preview'||mode==='party')){
    const drops=[0,12,25,40][scene.rainIntensity]||0;
    ctx.save();ctx.strokeStyle='#b7cbdc8c';ctx.lineWidth=1.2;ctx.beginPath();
    for(let index=0;index<drops;index++){const x=(index*71+t*(13+scene.rainIntensity*4))%w,y=(index*97+t*(90+scene.rainIntensity*22))%h;ctx.moveTo(x,y);ctx.lineTo(x-2.5,y+7+scene.rainIntensity);}
    ctx.stroke();ctx.restore();
  }
  ctx.restore();
}

function drawActionEffects(ctx,{motion,time,positions,image}){
 const cues=motion.cues||[];
 for(let i=Math.max(0,cues.length-6);i<cues.length;i++){
  const cue=cues[i],age=time-cue.at;if(age<0||age>1.2)continue;
  const point=positions.get(cue.zoneId);if(!point)continue;
  const p=Math.min(1,age/1.1);ctx.save();
  if(['place','move','upgrade'].includes(cue.type)){
   ctx.globalAlpha=(1-p)*.65;ctx.strokeStyle='#efffc5';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(point.x,point.y+2,12+p*27,4+p*7,0,0,Math.PI*2);ctx.stroke();
   for(let n=0;n<4;n++){const a=n*Math.PI*.5+.4;ctx.globalAlpha=(1-p)*.65;ctx.fillStyle=n%2?'#f5e3b5':'#d9f995';ctx.beginPath();ctx.arc(point.x+Math.cos(a)*(8+p*24),point.y-12-Math.sin(a)*(8+p*12)-p*22,2*(1-p)+.4,0,Math.PI*2);ctx.fill();}
  }
  if(cue.type==='refund'){
   const ghost=image(cue.art),coin=image('coin');
   if(ghost&&age<.34){const k=1-age/.34,sw=58*(.7+.3*k),sh=sw*ghost.naturalHeight/ghost.naturalWidth;ctx.globalAlpha=k*.55;ctx.drawImage(ghost,point.x-sw/2,point.y-sh-age*35,sw,sh);}
   if(coin){ctx.globalAlpha=Math.sin(p*Math.PI)*.9;const k=12+Math.sin(p*Math.PI)*6;ctx.drawImage(coin,point.x-k/2,point.y-35-p*38,k,k);}
  }
  ctx.restore();
 }
}
function drawCelebration(ctx,{time,mode,motion,width,height,celebrate}){
 const age=time-(motion.phaseAt??-10);if(!celebrate||!['party','finale'].includes(mode)||age<0||age>1.5)return;
 ctx.save();for(let i=0;i<18;i++){const a=(i*2.39996),speed=35+(i%5)*16,x=width*.5+Math.cos(a)*speed*age,y=height*.35+Math.sin(a)*speed*age+45*age*age;ctx.globalAlpha=Math.max(0,1-age/1.5)*.8;ctx.fillStyle=['#d6f58c','#f7d9a8','#d8b8ef'][i%3];ctx.save();ctx.translate(x,y);ctx.rotate(a+age*2);ctx.fillRect(-2,-1,4,2.5);ctx.restore();}ctx.restore();
}
