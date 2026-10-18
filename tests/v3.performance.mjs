/** Development-only instrumentation: wraps the renderer response in this browser only. */
import {createRequire} from 'node:module';import {writeFile,mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const base=process.env.FESTIVAL_TEST_URL||'http://127.0.0.1:8899/',out='output/playwright/v3';await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]||0;};
const summarize=values=>({samples:values.length,meanMs:+(values.reduce((a,b)=>a+b,0)/Math.max(1,values.length)).toFixed(3),medianMs:+percentile(values,.5).toFixed(3),p95Ms:+percentile(values,.95).toFixed(3),maxMs:+Math.max(0,...values).toFixed(3)});
try{for(const cpuRate of [1,4]){
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1}),page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});
 await page.route('**/renderer.js*',async route=>{const response=await route.fetch();let text=await response.text();text=text.replace('export function drawScene(','function __drawSceneMeasuredOriginal(');text+='\nexport function drawScene(...args){const started=performance.now();try{return __drawSceneMeasuredOriginal(...args);}finally{if(globalThis.__collectDraw)globalThis.__drawCosts.push(performance.now()-started);}}\n';await route.fulfill({response,body:text});});
 await page.goto(base,{waitUntil:'networkidle',timeout:90000});await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).phase==='build');
 const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
 async function clear(){if((await state()).selectedInstance)await page.locator('#cancel-selection').click();}
 async function buy(category,id,zone){await clear();await page.locator(`[data-category="${category}"]`).click();await page.locator(`[data-item-id="${id}"]`).click();await page.locator(`[data-zone="${zone}"]`).click();}
 async function replace(old,next){const prop=(await state()).inventory.find(e=>e.itemId===old);await page.locator(`[data-instance-id="${prop.id}"]`).click();await page.locator(`[data-item-id="${next}"]`).click();}
 await buy('food','snacks','west');await buy('music','speaker','center');await buy('decoration','flowers','east');
 for(let scene=0;scene<4;scene++){
  if(scene===1)await buy('shelter','umbrella','nook');
  if(scene===2){await replace('speaker','acoustic');await replace('snacks','feast');await replace('umbrella','canopy');}
  if(scene===3){await replace('acoustic','stage');await replace('feast','cart');await replace('canopy','pavilion');}
  const gaps=[],costs=[];
  for(let sample=0;sample<3;sample++){
   await page.locator('#rehearse-button').click();await page.waitForTimeout(80);
   const measurement=await page.evaluate(()=>new Promise(resolve=>{globalThis.__drawCosts=[];globalThis.__collectDraw=true;const gaps=[];let previous=null,start=null;function frame(time){if(start===null)start=time;if(previous!==null)gaps.push(time-previous);previous=time;if(time-start<1000)requestAnimationFrame(frame);else{globalThis.__collectDraw=false;resolve({gaps,costs:globalThis.__drawCosts,phase:JSON.parse(window.render_game_to_text()).phase});}}requestAnimationFrame(frame);}));
   if(measurement.phase!=='preview')throw Error('Preview finished during measurement; cannot compare same mode');gaps.push(...measurement.gaps);costs.push(...measurement.costs);await page.locator('#rehearse-button').click();
  }
  const current=await state(),frames=summarize(gaps),draw=summarize(costs),result={cpuThrottlingRate:cpuRate,scene:current.scenario.id,guests:current.scenario.guests,rainIntensity:current.scenario.rainIntensity,placedProps:current.inventory.length,mode:'preview',windows:3,windowMs:1000,raf:frames,observedMeanFPS:+(1000/frames.meanMs).toFixed(1),gapsOver20ms:gaps.filter(gap=>gap>20).length,gapsOver33ms:gaps.filter(gap=>gap>33.4).length,drawScene:draw};results.push(result);console.log(JSON.stringify(result));
  await page.locator('#rehearse-button').click();await page.evaluate(()=>window.advanceTime(3000));if(scene<3){await page.locator('#next-button').click();await page.waitForFunction(i=>JSON.parse(window.render_game_to_text()).scenarioIndex===i,scene+1);}
 }
 await context.close();
}const report={target:base,browser:'installed headless Chrome on desktop, viewport390x844@1x',instrumentation:'Dev-only response wrapper around drawScene, performance.now before/after; runtime files unchanged. rAF measured independently for3×1s preview windows per scene/CPUrate.',limits:'Desktop proxy only; CPU4x does not emulate phone GPU/thermal/WebView. DrawScene timing is JS Canvas submission cost, not GPU completion. No physical Android/iOS60FPS claim.',results};await writeFile(`${out}/performance.json`,JSON.stringify(report,null,2));}finally{await browser.close();}
