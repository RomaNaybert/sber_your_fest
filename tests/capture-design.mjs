import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 await page.addInitScript(()=>{window.__sharing=[];window.addEventListener('message',event=>{if(event.data?.type==='SHARING_EVENT')window.__sharing.push(event.data);});});
 await page.goto(process.env.FESTIVAL_TEST_URL||'http://127.0.0.1:8899/',{waitUntil:'networkidle',timeout:90000});
 await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).phase==='play');
 await page.locator('#toast').waitFor({state:'hidden'});
 await page.screenshot({path:'output/playwright/qa-initial-390x844.png'});
 async function buy(category,id,zone){await page.locator(`[data-category="${category}"]`).click();await page.waitForTimeout(300);await page.locator(`[data-item-id="${id}"]`).click();await page.locator(`[data-zone="${zone}"]`).click();}
 async function pass(){await page.locator('#rehearse-button').click();await page.evaluate(()=>window.advanceTime(5000));await page.locator('#next-button').click();}
 await buy('music','acoustic','west');await buy('food','snacks','east');await buy('shelter','canopy','center');await buy('decoration','flowers','west');
 await page.screenshot({path:'output/playwright/qa-placed-390x844.png'});
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(150);await page.screenshot({path:'output/playwright/qa-placed-844x390.png'});
 await page.setViewportSize({width:390,height:844});await pass();await page.locator('#transfer-start-button').click();
 await buy('music','acoustic','west');await buy('food','feast','east');await buy('shelter','canopy','center');await pass();
 await page.screenshot({path:'output/playwright/qa-finale-390x844.png'});
 await page.locator('#share-button').click();
 await page.waitForFunction(()=>window.__sharing.length===1);
 const shared=await page.evaluate(()=>window.__sharing[0]);assert.ok(shared.image.startsWith('data:image/png;base64,'));assert.ok(shared.text.length>10);
 await writeFile('output/playwright/share-card.png',Buffer.from(shared.image.split(',')[1],'base64'));
 console.log('Design evidence captured: initial, placed, landscape, finale, share-card.png. SHARING_EVENT carries one PNG + text.');
}finally{await browser.close();}
