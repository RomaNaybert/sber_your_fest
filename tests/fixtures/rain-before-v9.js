/** Original procedural score and effects. Creating the controller never starts audio. */
export function createFestivalAudio(){
  let context=null,master=null,musicBus=null,effectsBus=null,compressor=null,enabled=false,pageSuspended=false,destroyed=false,timer=null,pauseTimer=null,epoch=0,lastError=null;
  const volumes={music:.55,effects:.7},pendingResumes=new Set();
  let step=0,nextBeat=0,rain=null,scene={rainIntensity:0,phase:'build'};
  const voices=new Set(),lastEffects=new Map();
  const melody=[72,null,76,79,81,null,79,76,74,null,79,76,72,null,74,null,76,79,null,84,81,79,null,76,74,76,79,null,74,null,72,null];
  const bass=[48,45,53,43],beat=60/84/2;
  const now=()=>context?.currentTime||0;
  const active=()=>enabled&&!pageSuspended&&!destroyed&&context?.state==='running';
  const frequency=midi=>440*Math.pow(2,(midi-69)/12);
  function stopVoice(voice,when=now()+.035){
    try{voice.gain.gain.cancelScheduledValues(now());voice.gain.gain.setTargetAtTime(0,now(),.008);voice.source.stop(when);}catch{}
    voices.delete(voice);
  }
  function note(midi,at,duration,volume=.16,type='sine',bus='music'){
    if(!context||!master)return;
    while(voices.size>=10)stopVoice(voices.values().next().value);
    const source=context.createOscillator(),gain=context.createGain(),voice={source,gain};
    source.type=type;source.frequency.setValueAtTime(frequency(midi),at);
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+.018);gain.gain.exponentialRampToValueAtTime(.0001,at+Math.max(.045,duration));
    source.connect(gain);gain.connect(bus==='effects'?effectsBus:musicBus);voices.add(voice);
    source.onended=()=>{voices.delete(voice);source.disconnect();gain.disconnect();};
    source.start(at);source.stop(at+duration+.035);
  }
  function schedule(){
    if(!active())return;
    const time=now();if(nextBeat<time-.2)nextBeat=time+.04;
    while(nextBeat<time+.18){
      const index=step%32,cycle=Math.floor(step/32),soft=scene.phase==='build'?1:.8;
      if(index%8===0){const root=bass[Math.floor(index/8)];note(root,nextBeat,.72,.1*soft);note(root+19,nextBeat+.025,.5,.045*soft);}
      let pitch=melody[index];
      // Two quiet alternate endings keep the same original tune from becoming insistent.
      if(cycle%3===1&&index===27)pitch=81;
      if(cycle%3===2&&index===23)pitch=72;
      if(pitch!==null)note(pitch,nextBeat,.38,.16*soft,'triangle');
      nextBeat+=beat;step++;
    }
  }
  function stopRain(){
    if(!rain)return;const old=rain;rain=null;
    try{old.gain.gain.cancelScheduledValues(now());old.gain.gain.setTargetAtTime(0,now(),.025);old.source.stop(now()+.12);}catch{}
  }
  function updateRain(){
    const intensity=scene.rainIntensity,wanted=enabled&&!pageSuspended&&intensity>0&&['preview','party','finale'].includes(scene.phase);
    if(!context||!wanted){stopRain();return;}
    if(!rain){
      const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
      const buffer=context.createBuffer(1,context.sampleRate*2,context.sampleRate),samples=buffer.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
      source.buffer=buffer;source.loop=true;filter.type='lowpass';filter.Q.value=.35;gain.gain.value=0;
      source.connect(filter);filter.connect(gain);gain.connect(effectsBus);
      const nodes={source,filter,gain};source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};rain=nodes;source.start();
    }
    rain.filter.frequency.setTargetAtTime([0,1300,1900,2600][intensity],now(),.12);
    rain.gain.gain.cancelScheduledValues(now());rain.gain.gain.setTargetAtTime([0,.055,.09,.14][intensity],now(),.12);
  }
  function setVolumes(next={}){
    for(const key of ['music','effects'])if(typeof next[key]==='number'&&Number.isFinite(next[key]))volumes[key]=Math.max(0,Math.min(1,next[key]));
    if(context&&musicBus&&effectsBus){musicBus.gain.setTargetAtTime(volumes.music,now(),.025);effectsBus.gain.setTargetAtTime(volumes.effects,now(),.025);}
    return{...volumes};
  }
  function cancelResumes(){for(const cancel of [...pendingResumes])cancel();}
  function requestRunning(){
    return new Promise(resolve=>{
      let finished=false;
      const finish=ok=>{if(finished)return;finished=true;clearTimeout(guard);pendingResumes.delete(cancel);resolve(ok);};
      const cancel=()=>finish(false),guard=setTimeout(()=>finish(false),1200);pendingResumes.add(cancel);
      try{Promise.resolve(context.resume()).then(()=>finish(context?.state==='running'),error=>{if(!finished)lastError=String(error?.name||error?.message||'Audio resume failed');finish(false);});}
      catch(error){lastError=String(error?.name||error?.message||'Audio resume failed');finish(false);}
    });
  }
  function cancelPause(){if(pauseTimer!==null){clearTimeout(pauseTimer);pauseTimer=null;}}
  function stopScheduling(){if(timer!==null){clearInterval(timer);timer=null;}}
  function quiet(){
    cancelPause();stopScheduling();stopRain();if(!context||!master)return;
    master.gain.cancelScheduledValues(now());master.gain.setTargetAtTime(0,now(),.012);
    for(const voice of [...voices])stopVoice(voice);
    pauseTimer=setTimeout(()=>{pauseTimer=null;if(!enabled||pageSuspended)context?.suspend().catch(()=>{});},90);
  }
  async function enable(value){
    if(value&&active()&&timer!==null)return true;
    if(destroyed)return false;const request=++epoch;cancelResumes();enabled=!!value;
    if(!enabled){quiet();return false;}
    pageSuspended=false;cancelPause();lastError=null;
    try{
      if(!context){
        const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
        if(!Audio){enabled=false;lastError='Web Audio unavailable';return false;}
        context=new Audio();master=context.createGain();musicBus=context.createGain();effectsBus=context.createGain();compressor=context.createDynamicsCompressor();
        master.gain.value=0;musicBus.gain.value=volumes.music;effectsBus.gain.value=volumes.effects;
        compressor.threshold.value=-10;compressor.knee.value=12;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.16;
        musicBus.connect(master);effectsBus.connect(master);master.connect(compressor);compressor.connect(context.destination);
      }
      const running=await requestRunning();if(request!==epoch)return !!active();
      if(!running){lastError=lastError||'Audio context did not start; retry from a user gesture';enabled=false;quiet();return false;}
      if(!enabled||pageSuspended||destroyed)return false;
      master.gain.cancelScheduledValues(now());master.gain.setTargetAtTime(1,now(),.035);
      nextBeat=now()+.06;stopScheduling();schedule();timer=setInterval(schedule,80);updateRain();return true;
    }catch(error){if(request===epoch){lastError=String(error?.name||error?.message||'Audio unavailable');enabled=false;quiet();}return !!active();}
  }
  function setScene(next={}){
    const intensity=Math.max(0,Math.min(3,Math.round(Number(next.rainIntensity)||0))),phase=next.phase||'build';
    if(scene.rainIntensity===intensity&&scene.phase===phase)return;
    scene={rainIntensity:intensity,phase};updateRain();
  }
  function play(event){
    if(!active())return false;
    const patterns={purchase:[79,84],move:[74],refund:[76,72,67],upgrade:[72,76,79],error:[62,60],success:[72,76,79,84],transition:[72,79,76,84]};
    const notes=patterns[event];if(!notes)return false;
    const time=now(),cooldown=event==='success'?.5:event==='error'?.2:.06;
    if(time-(lastEffects.get(event)??-Infinity)<cooldown)return false;lastEffects.set(event,time);
    const spacing=event==='transition'?.13:event==='success'?.1:.075;
    notes.forEach((pitch,index)=>note(pitch,time+.015+index*spacing,event==='move'?.09:event==='success'?.28:.17,event==='error'?.14:.22,'sine','effects'));
    return true;
  }
  function suspend(){epoch++;cancelResumes();pageSuspended=true;quiet();}
  function resume(){if(enabled&&!destroyed)return enable(true);return Promise.resolve(false);}
  function destroy(){
    if(destroyed)return;epoch++;cancelResumes();enabled=false;pageSuspended=true;quiet();cancelPause();destroyed=true;
    if(context){try{musicBus.disconnect();effectsBus.disconnect();master.disconnect();compressor.disconnect();}catch{}context.close().catch(()=>{});}context=null;master=null;musicBus=null;effectsBus=null;compressor=null;lastEffects.clear();
  }
  function getState(){return{enabled,audible:!!(active()&&(volumes.music>0||volumes.effects>0)),volumes:{...volumes},lastError,pageSuspended,destroyed,contextState:context?.state||'uncreated',activeVoices:voices.size,rainActive:!!rain,scene:{...scene},schedulerActive:timer!==null};}
  return{enable,setVolumes,setScene,play,suspend,resume,destroy,getState};
}
