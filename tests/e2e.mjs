/** Development-only browser acceptance checks. Playwright is never shipped with game/. */
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let chromium;
try { ({chromium} = require('playwright')); }
catch { ({chromium} = require('playwright')); }
const url = process.env.FESTIVAL_TEST_URL || 'http://127.0.0.1:8899/';
const artifactDir = new URL('../output/playwright/', import.meta.url);
await mkdir(artifactDir, {recursive:true});
const browser = await chromium.launch({headless:true,channel:'chrome'});
const results = [];
/** Final selectors are intentionally kept together for the UI contract. */
const hooks = {
  start:'#start-button', rehearse:'#rehearse-button', resume:'#resume-button', next:'#next-button', undo:'#undo-button',
  share:'#share-button', close:'#exit-button', item:id=>`[data-item-id="${id}"]`,
  zone:id=>`[data-zone="${id}"]`, prop:id=>`[data-instance-id="${id}"]`
};
async function inspectLayout(page, name) {
  const layout = await page.evaluate(() => ({
    viewport:innerWidth, document:document.documentElement.scrollWidth,
    controls:[...document.querySelectorAll('button')].filter(element=>element.getBoundingClientRect().width && !element.disabled && !element.closest('#shop-grid, #placed-strip'))
      .map(element=>{const rect=element.getBoundingClientRect();return {text:element.textContent.trim(),x:rect.x,right:rect.right};})
  }));
  assert.ok(layout.document <= layout.viewport + 1, `${name}: horizontal overflow ${JSON.stringify(layout)}`);
  assert.ok(layout.controls.every(control=>control.x >= -1 && control.right <= layout.viewport+1), `${name}: control outside viewport`);
  await page.locator('#toast').waitFor({state:'hidden'});
  await page.screenshot({path:fileURLToPath(new URL(`${name}.png`,artifactDir)),fullPage:true});
  return layout;
}

const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
async function showItem(page,id) {
 const category={acoustic:'music',stage:'music',snacks:'food',feast:'food',umbrella:'shelter',canopy:'shelter',flowers:'decoration',lights:'decoration'}[id];
 const tab=page.locator(`[data-category="${category}"]`);
 if(await tab.count()) {await tab.click();await page.waitForTimeout(300);}
 await page.locator(hooks.item(id)).scrollIntoViewIfNeeded();
}
async function startIfNeeded(page) {
 if((await state(page)).phase==='intro') await page.locator(hooks.start).click();
}
async function buy(page,id,zone) {
 await showItem(page,id);
 await page.locator(hooks.item(id)).click();
 await page.locator(hooks.zone(zone)).click();
}
async function rehearse(page,valid) {
 await page.locator(hooks.rehearse).click();
 await page.evaluate(()=>window.advanceTime(5000));
 const value=await state(page);
 assert.equal(value.lastEvaluation.valid,valid);
 await page.locator(valid?hooks.next:hooks.resume).waitFor({state:'visible'});
}
async function fullPlaythrough(page,viewport) {
 await rehearse(page,false);
 await page.locator(hooks.resume).click();
 await buy(page,'acoustic','west');await buy(page,'snacks','east');await buy(page,'canopy','west');
 await rehearse(page,false);
 assert.equal((await state(page)).lastEvaluation.needs.shelter,false);
 await page.locator(hooks.resume).click();
 let canopy=(await state(page)).inventory.find(entry=>entry.itemId==='canopy');
 await page.locator(hooks.prop(canopy.id)).click();await page.locator(hooks.zone('center')).click();
 assert.equal((await state(page)).remaining,100);
 await buy(page,'lights','center');await buy(page,'flowers','west');
 assert.equal((await state(page)).remaining,0);
 const before=(await state(page)).inventory.length;
 await buy(page,'flowers','east');
 assert.equal((await state(page)).inventory.length,before);
 assert.equal((await state(page)).remaining,0);
 await page.getByRole('button',{name:'Вернуть Цветы',exact:true}).click();
 assert.equal((await state(page)).remaining,40);
 await page.locator(hooks.undo).click();assert.equal((await state(page)).remaining,0);
 await inspectLayout(page,`placed-${viewport.width}x${viewport.height}`);
 await rehearse(page,true);await page.locator(hooks.next).click();
 await page.locator('#transfer-start-button').click();
 assert.equal((await state(page)).scenario.guests,5);
 await buy(page,'acoustic','west');await buy(page,'snacks','east');await buy(page,'canopy','center');
 await rehearse(page,false);assert.equal((await state(page)).lastEvaluation.needs.food,false);
 await page.locator(hooks.resume).click();
 await page.getByRole('button',{name:'Вернуть Пикник',exact:true}).click();
 await buy(page,'feast','east');
 await rehearse(page,true);await page.locator(hooks.next).click();
 assert.equal((await state(page)).phase,'finale');
 assert.equal((await state(page)).completedScenarios[1].independent,false);
 await inspectLayout(page,`finale-${viewport.width}x${viewport.height}`);
 await page.locator(hooks.share).click();
 await page.waitForTimeout(150);
 const events=await page.evaluate(()=>window.__nativeEvents);
 for(const name of ['COMPLETED_EVENT','FINISH_EVENT','SHARING_EVENT']) assert.equal(events.filter(event=>event.type===name).length,1,`${name} sent once`);
 assert.ok(events.filter(event=>event.type==='VIBRATION_EVENT').length>0);
 const share=events.find(event=>event.type==='SHARING_EVENT');assert.ok(share.text.length>10);assert.ok(share.image.startsWith('data:image/png;base64,'));
 await page.locator(hooks.close).click();await page.locator('#confirm-exit-button').click();
 await page.waitForTimeout(50);assert.equal((await state(page)).phase,'intro');
 assert.equal((await page.evaluate(()=>window.__nativeEvents)).filter(event=>event.type==='CLOSE_EVENT').length,1);
 await startIfNeeded(page);
 assert.equal((await state(page)).remaining,500);assert.equal((await state(page)).inventory.length,0);
 // Drag-to-place uses the scene coordinates and exercises the pointer path.
 await showItem(page,'acoustic');
 const card=await page.locator(hooks.item('acoustic')).boundingBox();
 const scene=await page.locator('#scene').boundingBox();
 await page.mouse.move(card.x+card.width/2,card.y+card.height/2);
 await page.mouse.down();await page.mouse.move(scene.x+scene.width*.23,scene.y+scene.height*.65,{steps:16});await page.mouse.up();
 assert.ok((await state(page)).inventory.some(entry=>entry.itemId==='acoustic'&&entry.zoneId==='west'),'drag placed music');
}

try {
  for (const viewport of [{width:360,height:780},{width:844,height:390},{width:1440,height:900}]) {
    console.log(`Testing ${viewport.width}×${viewport.height}`);
    const context = await browser.newContext({viewport,hasTouch:viewport.width<1000});
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
    page.on('request',request=>requests.push(request.url()));
    await page.addInitScript(() => {
      window.__nativeEvents=[];
      window.addEventListener('message', event => { if (event.data?.type) window.__nativeEvents.push(event.data); });
    });
    await page.goto(url,{waitUntil:'networkidle',timeout:90000});
    await page.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).budget === 500);
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await startIfNeeded(page);
    await inspectLayout(page,`festival-${viewport.width}x${viewport.height}`);
    const beforeResize=await state(page);
    await page.setViewportSize(viewport.width===360?{width:844,height:390}:{width:360,height:780});
    await page.waitForTimeout(150);
    assert.equal((await state(page)).remaining,beforeResize.remaining);
    await inspectLayout(page,`rotated-${viewport.width}x${viewport.height}`);
    await page.setViewportSize(viewport);
    await fullPlaythrough(page,viewport);
    if(viewport.width===360){
      await buy(page,'snacks','east');await buy(page,'canopy','center');await rehearse(page,true);await page.locator(hooks.next).click();await page.locator('#transfer-start-button').click();
      await buy(page,'acoustic','west');await buy(page,'feast','east');await buy(page,'canopy','center');await rehearse(page,true);await page.locator(hooks.next).click();
      assert.equal((await state(page)).completedScenarios[1].independent,true);
      const replayEvents=await page.evaluate(()=>window.__nativeEvents);
      for(const name of ['COMPLETED_EVENT','FINISH_EVENT'])assert.equal(replayEvents.filter(event=>event.type===name).length,1,`${name} once across replay`);
    }
    assert.deepEqual(errors,[],`${viewport.width}: browser errors`);
    assert.ok(requests.every(request=>new URL(request).origin===new URL(url).origin || request.startsWith('data:')), 'Unexpected external request');
    results.push({viewport,status:'layout and full playthrough passed',errors,requests:requests.length});
    await context.close();
  }
  await writeFile(new URL('acceptance.json',artifactDir),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally { await browser.close(); }
