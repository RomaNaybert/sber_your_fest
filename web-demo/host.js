/* Website-only adapter. Excluded from the game package delivered to the sandbox. */
(()=>{
 if(new URLSearchParams(location.search).has('native')||window.__hackathonBridgeInstalled||window.webkit?.messageHandlers?.hackathonBridge||/; wv\)|Version\/4\.0.*Chrome\/.*Mobile Safari/i.test(navigator.userAgent))return;
 let busy=false;
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.type!=='SHARING_EVENT'||busy)return;
  const payload=event.data;busy=true;
  const fallback=()=>{
   let layer=document.getElementById('web-share-fallback');if(layer)layer.remove();layer=document.createElement('dialog');layer.id='web-share-fallback';layer.style.cssText='max-width:340px;border:0;border-radius:20px;background:#352842;color:#fff5df;padding:22px;font:14px/1.6 system-ui';
   const title=document.createElement('h3');title.textContent='Покажем друзьям?';const text=document.createElement('p');text.textContent='Здесь меню не открылось. Можно сохранить открытку и отправить её самому.';const save=document.createElement('a');save.textContent='Сохранить открытку';save.href=payload.image;save.download='my-festival.png';save.style.cssText='display:block;color:#d2f86a;margin:12px 0';const close=document.createElement('button');close.textContent='Понятно';close.onclick=()=>layer.close();layer.append(title,text,save,close);document.body.append(layer);layer.showModal();layer.addEventListener('close',()=>layer.remove());
  };
  if(navigator.share){
   const data={title:document.title,text:payload.text||'',url:location.origin+location.pathname};
   try{const bytes=Uint8Array.from(atob(payload.image.split(',')[1]),c=>c.charCodeAt(0));const file=new File([bytes],'my-festival.png',{type:'image/png'});if(navigator.canShare?.({files:[file]})){data.files=[file];delete data.url;}}
   catch{}
   try{navigator.share(data).catch(e=>{if(e.name!=='AbortError')fallback();}).finally(()=>busy=false);}catch{busy=false;fallback();}
  }else{busy=false;fallback();}
 });
})();
