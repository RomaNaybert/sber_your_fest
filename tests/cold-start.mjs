import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);const {chromium}=require('playwright');
const target=process.env.FESTIVAL_TEST_URL||'http://127.0.0.1:8899/';
const browser=await chromium.launch({channel:'chrome',headless:true});const runs=[];
try{
 for(let attempt=1;attempt<=3;attempt++){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'});const page=await context.newPage();const cdp=await context.newCDPSession(page);let loadedBytes=0;let requests=0;const errors=[];
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:500000,uploadThroughput:125000,connectionType:'cellular4g'});
  cdp.on('Network.requestWillBeSent',()=>requests++);cdp.on('Network.loadingFinished',event=>loadedBytes+=event.encodedDataLength);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:90000});
  const firstPlay=await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).phase==='play'?{ms:performance.now(),state:JSON.parse(window.render_game_to_text())}:false,{},{timeout:90000});
  const sample=await firstPlay.jsonValue();const result={attempt,phasePlayMs:Math.round(sample.ms),requestsAtPlay:requests,completedEncodedBytesAtPlay:loadedBytes,remaining:sample.state.remaining,inventory:sample.state.inventory.length,errors};runs.push(result);console.log(JSON.stringify(result));
  if(attempt===1)await page.screenshot({path:'output/playwright/cold-start-at-play.png'});
  await context.close();
 }
 const sorted=runs.map(r=>r.phasePlayMs).sort((a,b)=>a-b);const report={target,viewport:{width:390,height:844},browser:'headless installed Chrome through Playwright/CDP',cache:'disabled, fresh isolated context per run, service workers blocked',network:{downloadBitsPerSecond:4000000,uploadBitsPerSecond:1000000,latencyMs:80},milestone:'first observed render_game_to_text().phase === play, from navigation performance.timeOrigin; animation-frame polling',runs,medianMs:sorted[1],minMs:sorted[0],maxMs:sorted[2],limits:'localhost origin under emulated network; no remote TLS/server latency, CPU throttling, or physical mobile device'};
 await mkdir('output/playwright',{recursive:true});await writeFile('output/playwright/cold-start.json',JSON.stringify(report,null,2));console.log(JSON.stringify({medianMs:report.medianMs,minMs:report.minMs,maxMs:report.maxMs}));
}finally{await browser.close();}
