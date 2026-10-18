/** Focused V7 controls regression: actual UI actions; hook is read-only except advanceTime. */
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const url=process.env.FESTIVAL_TEST_URL||'http://127.0.0.1:8899/',out=process.env.FESTIVAL_TEST_OUT||'output/playwright/v7-controls';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
const read=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
const cat={snacks:'food',speaker:'music',flowers:'decoration',umbrella:'shelter'};
async function buy(p,id,zone){await p.locator(`[data-category="${cat[id]}"]`).tap();await p.locator(`[data-item-id="${id}"]`).tap();await p.locator(`[data-zone="${zone}"]`).tap();}
async function replace(p,old,id){const entry=(await read(p)).inventory.find(e=>e.itemId===old);await p.locator(`[data-instance-id="${entry.id}"]`).tap();await p.locator(`[data-item-id="${id}"]`).tap();}
async function invite(p){await p.locator('#rehearse-button').tap();await p.evaluate(()=>window.advanceTime(3000));}
async function next(p,index){await p.locator('#next-button').tap();await p.waitForFunction(i=>JSON.parse(window.render_game_to_text()).scenarioIndex===i,index);}
async function shot(p,name){await p.screenshot({path:`${out}/${name}.png`});}
async function inside(p,selector){const b=await p.locator(selector).boundingBox(),v=p.viewportSize();assert.ok(b&&b.x>=0&&b.y>=0&&b.x+b.width<=v.width+1&&b.y+b.height<=v.height+1,`${selector} outside viewport: ${JSON.stringify(b)}`);}
async function drag(p,source,target){const cdp=await p.context().newCDPSession(p),a=await source.boundingBox(),b=target;assert.ok(a&&b);const x=a.x+a.width/2,y=a.y+a.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=1;i<=15;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(b.x-x)*i/15,y:y+(b.y-y)*i/15,id:1}]});await p.waitForTimeout(18);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(350);await cdp.detach();}
try{
for(const viewport of [{width:360,height:640},{width:844,height:390}]){
 const context=await browser.newContext({viewport,hasTouch:true,isMobile:true}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{document.cookie="festival_intro_v1=done; Path=/";window.__shareCalls=[];window.__clipboardWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__clipboardWrites.push(text)}});window.__shareBehavior='resolve';Object.defineProperty(navigator,'share',{configurable:true,value:data=>{window.__shareCalls.push({data,active:navigator.userActivation.isActive});if(window.__shareBehavior==='abort')return Promise.reject(new DOMException('Cancelled','AbortError'));return Promise.resolve();}});});
 await p.goto(url,{waitUntil:'networkidle',timeout:90000});await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).phase==='build');
 await p.evaluate(()=>document.fonts.ready);assert.equal(await p.evaluate(()=>document.fonts.status),'loaded');const label=`${viewport.width}x${viewport.height}`;
 await p.locator('#help-button').tap();await inside(p,'#modal-close');await inside(p,'#help-ok');
 const help=await p.locator('#modal-body').evaluate(e=>({scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,text:e.innerText}));assert.match(help.text,/монеты/);assert.match(help.text,/звезды/);
 await shot(p,`${label}-help-top`);await p.locator('#modal-body').hover();await p.mouse.wheel(0,2000);await p.waitForTimeout(150);
 const end=await p.locator('#modal-body').evaluate(e=>({scrollTop:e.scrollTop,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight}));assert.ok(end.scrollTop+end.clientHeight>=end.scrollHeight-3,'Help final paragraph unreachable');await shot(p,`${label}-help-end`);await p.locator('#help-ok').tap();assert.equal((await read(p)).dialog,null);
 await p.locator('#sound-button').tap();await inside(p,'#sound-done');await inside(p,'#music-volume');await inside(p,'#effects-volume');
 // Keyboard operates the real range control and dispatches its native input event.
 for(const [id,keys]of [['music',['Home',...Array(23).fill('ArrowRight')]],['effects',['Home',...Array(81).fill('ArrowRight')]]]){await p.locator(`#${id}-volume`).focus();for(const key of keys)await p.keyboard.press(key);}
 assert.equal((await read(p)).sound.volumes.music,.23);assert.equal((await read(p)).sound.volumes.effects,.81);await shot(p,`${label}-sound-settings`);
 await p.locator('#sound-toggle').tap();await p.waitForTimeout(100);assert.equal((await read(p)).sound.enabled,false);await p.locator('#sound-done').tap();
 await buy(p,'snacks','west');assert.equal((await read(p)).sound.enabled,false,'Explicit mute must survive later game gesture');assert.equal((await read(p)).sound.schedulerActive,false);
 const before=await read(p),entry=before.inventory[0],drawer=await p.locator('#shop-grid').boundingBox();await drag(p,p.locator(`[data-instance-id="${entry.id}"]`),{x:drawer.x+drawer.width/2,y:drawer.y+drawer.height/2});
 assert.equal((await read(p)).inventory.length,0);assert.equal((await read(p)).remaining,before.remaining+110);await shot(p,`${label}-drag-refunded`);await p.locator('#undo-button').tap();assert.deepEqual((await read(p)).inventory,before.inventory);
 // Cancel an actual active drag outside the map/drawer; purchases and money stay intact.
 await drag(p,p.locator(`[data-instance-id="${entry.id}"]`),{x:1,y:1});assert.deepEqual((await read(p)).inventory,before.inventory);assert.equal((await read(p)).remaining,before.remaining);assert.equal((await read(p)).moving,false);
 if(viewport.width===360){
  await buy(p,'speaker','center');await invite(p);await next(p,1);await buy(p,'umbrella','nook');await invite(p);await next(p,2);await replace(p,'speaker','acoustic');await replace(p,'snacks','feast');await replace(p,'umbrella','canopy');await invite(p);await next(p,3);await replace(p,'acoustic','stage');await replace(p,'feast','cart');await replace(p,'canopy','pavilion');await invite(p);assert.equal((await read(p)).phase,'finale');
  await p.locator('#share-button').tap();let calls=await p.evaluate(()=>window.__shareCalls);assert.equal(calls.length,1);assert.equal(calls[0].active,true,'Web Share must be invoked in original activation');assert.equal(calls[0].data.url,'https://hpfs.ru/sber/');assert.equal((await read(p)).dialog,null);
  await p.evaluate(()=>window.__shareBehavior='abort');await p.locator('#share-button').tap();await p.waitForTimeout(80);assert.equal((await p.evaluate(()=>window.__shareCalls)).length,2);assert.equal((await read(p)).phase,'finale');assert.equal((await read(p)).dialog,null,'AbortError must leave finale unchanged');
  await p.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));await p.locator('#share-button').tap();assert.equal((await read(p)).dialog,'Твой фестиваль — друзьям');assert.equal(await p.locator('#share-url').inputValue(),'https://hpfs.ru/sber/');await inside(p,'#copy-link');await inside(p,'#download-card');await shot(p,`${label}-browser-share-fallback`);
  await p.locator('#copy-link').tap();assert.deepEqual(await p.evaluate(()=>window.__clipboardWrites),['https://hpfs.ru/sber/']);assert.equal(await p.locator('#copy-link').innerText(),'Ссылка скопирована');
  const downloadPromise=p.waitForEvent('download');await p.locator('#download-card').tap();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'my-festival.png');assert.equal(await download.failure(),null);await download.saveAs(`${out}/my-festival.png`);const png=await readFile(`${out}/my-festival.png`);assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1620);
  await p.locator('#modal-close').tap();
 }
 assert.deepEqual(errors,[]);results.push({viewport,status:'passed',help:{...help,...end},volume:{music:.23,effects:.81},muteSurvivesGesture:true,touchRefundUndo:true,cancelDrag:true,webShare:viewport.width===360?'activation/resolve/AbortError/copy/download PNG1080x1620 passed':'covered portrait',errors});await context.close();
}
await writeFile(`${out}/acceptance.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}catch(e){await writeFile(`${out}/failure.txt`,e.stack);throw e;}finally{await browser.close();}
