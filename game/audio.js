import {FESTIVAL_BPM} from './tempo.js?v=festival13';
/** Original procedural score and effects. Creating the controller never starts audio. */
export function createFestivalAudio(){
  let context=null,master=null,musicBus=null,effectsBus=null,compressor=null,enabled=false,pageSuspended=false,destroyed=false,timer=null,pauseTimer=null,epoch=0,lastError=null;
  const volumes={music:.55,effects:.7},pendingResumes=new Set();
  let step=0,nextBeat=0,rain=null,rainBuffer=null,scene={rainIntensity:0,phase:'build'};
  const voices=new Set(),lastEffects=new Map();
  const beat=60/FESTIVAL_BPM/4,chords=[[60,64,67,71],[57,60,64,67],[53,57,60,64],[55,59,62,64]];
  const layers={speaker:0,acoustic:0,stage:0,'helper-musician':0},layerBuses=new Map();
  let percussionBuffer=null;
  const now=()=>context?.currentTime||0;
  const active=()=>enabled&&!pageSuspended&&!destroyed&&context?.state==='running';
  const frequency=midi=>440*Math.pow(2,(midi-69)/12);
  function stopVoice(voice,when=now()+.035){
    try{voice.gain.gain.cancelScheduledValues(now());voice.gain.gain.setTargetAtTime(0,now(),.008);voice.source.stop(when);}catch{}
    voices.delete(voice);
  }
  function note(midi,at,duration,volume=.16,type='sine',bus='music',layer='base'){
    if(!context||!master)return;
    while(voices.size>=48)stopVoice(voices.values().next().value);
    const source=context.createOscillator(),gain=context.createGain(),voice={source,gain,layer};
    source.type=type;source.frequency.setValueAtTime(frequency(midi),at);
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+.018);gain.gain.exponentialRampToValueAtTime(.0001,at+Math.max(.045,duration));
    source.connect(gain);gain.connect(bus==='effects'?effectsBus:layerBuses.get(layer)||musicBus);voices.add(voice);
    source.onended=()=>{voices.delete(voice);source.disconnect();gain.disconnect();};
    source.start(at);source.stop(at+duration+.035);
  }
  function drum(kind,at,volume,layer='base'){
    if(!context)return;
    while(voices.size>=48)stopVoice(voices.values().next().value);
    const gain=context.createGain(),source=kind==='kick'?context.createOscillator():context.createBufferSource(),filter=context.createBiquadFilter();
    const duration=kind==='kick'?.19:kind==='hat'?.045:.13;
    if(kind==='kick'){source.type='sine';source.frequency.setValueAtTime(135,at);source.frequency.exponentialRampToValueAtTime(46,at+.13);filter.type='lowpass';filter.frequency.value=650;}
    else{if(!percussionBuffer){percussionBuffer=context.createBuffer(1,Math.ceil(context.sampleRate*.22),context.sampleRate);const values=percussionBuffer.getChannelData(0);let seed=73;for(let i=0;i<values.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;values[i]=seed/2147483648-1;}}source.buffer=percussionBuffer;filter.type='bandpass';filter.frequency.value=kind==='hat'?6100:1700;filter.Q.value=kind==='hat'?.65:.8;}
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+.003);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    source.connect(filter);filter.connect(gain);gain.connect(layerBuses.get(layer)||musicBus);
    const voice={source,gain,layer};voices.add(voice);source.onended=()=>{voices.delete(voice);source.disconnect();filter.disconnect();gain.disconnect();};source.start(at);source.stop(at+duration+.015);
  }
  function vocal(midi,at){
    // A little invented "wa-oh" timbre: oscillators and vowel formants, no speech recording.
    if(!context)return;while(voices.size>=48)stopVoice(voices.values().next().value);
    const source=context.createOscillator(),gain=context.createGain(),formants=[context.createBiquadFilter(),context.createBiquadFilter()];
    source.type='sawtooth';source.frequency.setValueAtTime(frequency(midi),at);source.frequency.exponentialRampToValueAtTime(frequency(midi-1),at+.23);
    formants.forEach((f,i)=>{f.type='bandpass';f.Q.value=i?5:3;f.frequency.setValueAtTime(i?1350:480,at);f.frequency.exponentialRampToValueAtTime(i?1000:700,at+.22);source.connect(f);f.connect(gain);});
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.11,at+.025);gain.gain.exponentialRampToValueAtTime(.0001,at+.3);gain.connect(layerBuses.get('helper-musician'));
    const voice={source,gain,layer:'helper-musician'};voices.add(voice);source.onended=()=>{voices.delete(voice);source.disconnect();gain.disconnect();formants.forEach(f=>f.disconnect());};source.start(at);source.stop(at+.33);
  }
  function setInstruments(ids){
    const counts={speaker:0,acoustic:0,stage:0,'helper-musician':0};for(const id of ids||[])if(Object.prototype.hasOwnProperty.call(counts,id))counts[id]++;
    for(const id of Object.keys(layers)){const count=Math.min(2,counts[id]);if(count===layers[id])continue;layers[id]=count;const bus=layerBuses.get(id);if(bus){bus.gain.cancelScheduledValues(now());bus.gain.setTargetAtTime(count?1+(count-1)*.12:0,now(),.055);}if(!count)for(const voice of [...voices])if(voice.layer===id)stopVoice(voice);}
  }
  function schedule(){
    if(!active())return;
    const time=now();if(nextBeat<time-.2)nextBeat=time+.04;
    while(nextBeat<time+.18){
      const s=step%16,bar=Math.floor(step/16),chord=chords[Math.floor(bar/2)%4],t=nextBeat,soft=scene.phase==='build'?.9:1;
      // A warm 104 BPM groove is present even before the first instrument is bought.
      if(s%4===0)drum('kick',t,.13*soft);
      if(s===4||s===12)drum('snare',t,.065*soft);
      if(s%2===0)drum('hat',t,s%4===2?.025:.012);
      if(s===0||s===10)chord.forEach((pitch,i)=>note(pitch,t+i*.009,s===0?.6:.28,.021*soft,'triangle'));
      if(bar%2===1&&(s===7||s===14))note(chord[s===7?2:1]+12,t,.17,.04,'sine');
      if(layers.speaker&&[0,3,6,8,11,14].includes(s)){const pitch=chord[0]-24+(s===6?7:s===14?12:0);note(pitch,t,s===0||s===8?.28:.17,.17,'triangle','music','speaker');note(pitch+12,t,.13,.05,'sine','music','speaker');}
      if(layers.acoustic&&[0,3,6,10,12,15].includes(s)){const pitch=chord[[0,2,1,3][Math.floor(s/4)]]+12;note(pitch,t,.19,.075,'triangle','music','acoustic');note(pitch,t+.105,.12,.022,'sine','music','acoustic');}
      if(layers.stage){if(s===4||s===12)drum('snare',t+.018,.045,'stage');if(s===3||s===11)drum('hat',t,.025,'stage');if([2,5,9,14].includes(s)){const pattern=bar%2?[2,1,3,2]:[1,2,3,1],pitch=chord[pattern[[2,5,9,14].indexOf(s)]]+12;note(pitch,t,.23,.073,'sine','music','stage');}}
      if(layers['helper-musician']&&(s===6||(bar%2===1&&s===13)))vocal(chord[s===6?1:2],t);
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
      // Soft isolated patter, with quiet gaps: no continuous white-noise bed.
      if(!rainBuffer){
        rainBuffer=context.createBuffer(1,context.sampleRate*8,context.sampleRate);
        const samples=rainBuffer.getChannelData(0),rate=context.sampleRate;
        let seed=814713;
        const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
        for(let at=.08;at<7.78;at+=.025+random()*.09){
          const start=Math.floor(at*rate),duration=.07+random()*.09,decay=.013+random()*.023;
          const pitch=260+random()*510,volume=.35+random()*.35;
          let soft=0,angle=0;
          for(let n=0;n<duration*rate&&start+n<samples.length;n++){
            const age=n/rate;
            soft=soft*.8+(random()*2-1)*.2;
            angle+=2*Math.PI*pitch*Math.exp(-age*9)/rate;
            const envelope=Math.min(1,age/.0025)*Math.exp(-age/decay);
            samples[start+n]+=volume*envelope*(soft*.8+Math.sin(angle)*.2);
          }
        }
      }
      const buffer=rainBuffer;
      source.buffer=buffer;source.loop=true;filter.type='lowpass';filter.Q.value=.45;gain.gain.value=0;
      source.connect(filter);filter.connect(gain);gain.connect(effectsBus);
      const nodes={source,filter,gain};source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};rain=nodes;source.start();
    }
    rain.filter.frequency.setTargetAtTime([0,850,1050,1250][intensity],now(),.3);
    rain.source.playbackRate.setTargetAtTime([1,.65,.85,1.1][intensity],now(),.3);
    rain.gain.gain.cancelScheduledValues(now());rain.gain.gain.setTargetAtTime([0,.07,.10,.13][intensity],now(),.3);
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
        for(const id of Object.keys(layers)){const bus=context.createGain();bus.gain.value=layers[id]?1+(layers[id]-1)*.12:0;bus.connect(musicBus);layerBuses.set(id,bus);}
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
    if(Array.isArray(next.musicItems))setInstruments(next.musicItems);
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
    if(context){try{musicBus.disconnect();effectsBus.disconnect();master.disconnect();compressor.disconnect();}catch{}context.close().catch(()=>{});}context=null;master=null;musicBus=null;effectsBus=null;compressor=null;rainBuffer=null;percussionBuffer=null;layerBuses.forEach(bus=>{try{bus.disconnect();}catch{}});layerBuses.clear();lastEffects.clear();
  }
  function getState(){return{enabled,audible:!!(active()&&(volumes.music>0||volumes.effects>0)),volumes:{...volumes},lastError,pageSuspended,destroyed,contextState:context?.state||'uncreated',activeVoices:voices.size,rainActive:!!rain,scene:{...scene},arrangement:{bpm:FESTIVAL_BPM,layers:{...layers},step,voices:Object.fromEntries(['base',...Object.keys(layers)].map(id=>[id,[...voices].filter(v=>v.layer===id).length]))},schedulerActive:timer!==null};}
  return{enable,setVolumes,setScene,play,suspend,resume,destroy,getState};
}
