import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const base=process.env.FESTIVAL_TEST_URL||'http://127.0.0.1:8899/';
const output='output/playwright/small';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
try{
 for(const viewport of [{width:375,height:667},{width:360,height:640},{width:430,height:932}]){
  console.log(`Small touch ${viewport.width}×${viewport.height}`);
  const context=await browser.newContext({viewport,hasTouch:true,isMobile:true,deviceScaleFactor:1});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.goto(base,{waitUntil:'networkidle',timeout:90000});await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).phase==='play');
  const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
  const snapshot=async name=>{await page.locator('#toast').waitFor({state:'hidden'});const shape=await page.evaluate(()=>({w:innerWidth,h:innerHeight,scroll:document.documentElement.scrollWidth,cta:(()=>{const r=document.querySelector('#rehearse-button').getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom}})()}));assert.ok(shape.scroll<=shape.w+1);assert.ok(shape.cta.x>=0&&shape.cta.right<=shape.w+1&&shape.cta.y>=0&&shape.cta.bottom<=shape.h+1,JSON.stringify(shape));await page.screenshot({path:`${output}/${viewport.width}x${viewport.height}-${name}.png`});return shape;};
  await snapshot('initial');
  await page.setViewportSize({width:viewport.height,height:viewport.width});await page.waitForTimeout(150);await snapshot('landscape-initial');assert.equal((await state()).remaining,500);
  await page.setViewportSize(viewport);await page.waitForTimeout(150);
  await page.locator('#rehearse-button').tap();await page.evaluate(()=>window.advanceTime(5000));await page.locator('#resume-button').tap();
  const cdp=await context.newCDPSession(page);
  async function gesture(points){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:points[0].x,y:points[0].y,radiusX:2,radiusY:2,force:1,id:1}]});for(const point of points.slice(1)){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,radiusX:2,radiusY:2,force:1,id:1}]});await page.waitForTimeout(20)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(350);}
  const shelf=await page.locator('#shop-grid').boundingBox();const startX=shelf.x+shelf.width*.86,endX=shelf.x+shelf.width*.16,swipeY=shelf.y+shelf.height*.43;
  const scrollBefore=await page.locator('#shop-grid').evaluate(el=>el.scrollLeft);
  await gesture(Array.from({length:12},(_,i)=>({x:startX+(endX-startX)*i/11,y:swipeY})));
  const scrollAfter=await page.locator('#shop-grid').evaluate(el=>el.scrollLeft);
  assert.ok(scrollAfter>scrollBefore+25,`Horizontal swipe did not scroll (${scrollBefore}→${scrollAfter})`);
  assert.equal((await state()).inventory.length,0,'Swipe must not buy');assert.equal((await state()).selectedItem,null,'Swipe must not select');assert.equal(await page.locator('#drag-ghost').isVisible(),false);
  await page.locator('[data-category="music"]').tap();await page.waitForTimeout(400);await page.locator('[data-item-id="acoustic"]').scrollIntoViewIfNeeded();
  const card=await page.locator('[data-item-id="acoustic"]').boundingBox(),scene=await page.locator('#scene').boundingBox();
  const from={x:card.x+card.width/2,y:card.y+card.height*.4},to={x:scene.x+scene.width*.26,y:scene.y+scene.height*.65};
  await gesture(Array.from({length:14},(_,i)=>({x:from.x+(to.x-from.x)*i/13,y:from.y+(to.y-from.y)*i/13})));
  assert.ok((await state()).inventory.some(e=>e.itemId==='acoustic'&&e.zoneId==='west'),'Vertical touch drag must place item');
  async function buy(category,item,zone){await page.locator(`[data-category="${category}"]`).tap();await page.waitForTimeout(350);await page.locator(`[data-item-id="${item}"]`).tap();await page.locator(`[data-zone="${zone}"]`).tap();}
  await buy('food','snacks','east');await buy('shelter','canopy','center');await snapshot('placed');
  await page.setViewportSize({width:viewport.height,height:viewport.width});await page.waitForTimeout(150);await snapshot('landscape-placed');assert.equal((await state()).inventory.length,3);
  await page.locator('#rehearse-button').tap();await page.evaluate(()=>window.advanceTime(5000));assert.equal((await state()).lastEvaluation.valid,true);await page.screenshot({path:`${output}/${viewport.width}x${viewport.height}-landscape-result.png`});await page.locator('#next-button').tap();await page.locator('#transfer-start-button').tap();assert.equal((await state()).budget,460);
  assert.deepEqual(errors,[]);results.push({viewport,swipe:{scrollBefore,scrollAfter},touchDrag:'passed',orientations:'passed',rehearsal:'passed',errors});await context.close();
 }
 await writeFile(`${output}/acceptance.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
