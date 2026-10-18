import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.__events=[];window.addEventListener('message',event=>{if(event.data?.type)window.__events.push(event.data.type)});});
 await page.goto(process.env.FESTIVAL_TEST_URL||'http://127.0.0.1:8899/',{waitUntil:'networkidle',timeout:90000});await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).phase==='play');
 await page.locator('[data-item-id="acoustic"]').tap();await page.locator('[data-zone="west"]').tap();
 assert.equal(await page.evaluate(()=>JSON.parse(window.render_game_to_text()).remaining),380);
 await page.locator('#exit-button').tap();await page.locator('#confirm-exit-button').tap();
 await page.waitForFunction(()=>window.__events.includes('CLOSE_EVENT'));
 const events=await page.evaluate(()=>window.__events);
 const counts=Object.fromEntries(['FINISH_EVENT','CLOSE_EVENT','COMPLETED_EVENT'].map(name=>[name,events.filter(value=>value===name).length]));
 assert.deepEqual(counts,{FINISH_EVENT:1,CLOSE_EVENT:1,COMPLETED_EVENT:0});
 assert.ok(events.indexOf('FINISH_EVENT')<events.indexOf('CLOSE_EVENT'));
 const exited=JSON.parse(await page.evaluate(()=>window.render_game_to_text()));assert.equal(exited.remaining,500);assert.equal(exited.inventory.length,0);
 if(exited.phase==='intro')await page.locator('#start-button').tap();
 const restarted=JSON.parse(await page.evaluate(()=>window.render_game_to_text()));assert.equal(restarted.phase,'play');assert.equal(restarted.remaining,500);assert.equal(restarted.inventory.length,0);assert.deepEqual(errors,[]);
 const result={status:'passed',counts,finishBeforeClose:true,restart:{phase:restarted.phase,remaining:restarted.remaining,inventory:restarted.inventory.length},errors};
 await writeFile('output/playwright/early-exit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
