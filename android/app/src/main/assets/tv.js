(function(){
 if(document.getElementById("crt-access-gate")||!document.getElementById("app"))return;
 if(window.crtTVInstalled)return;window.crtTVInstalled=true;
 window.crtTvVersion='0.6';
 const style=document.createElement('style');style.textContent=`
 .desktop-player .preview-actions,#ctl-theater,#ctl-full{display:none!important}
 .desktop-player .osd-rows .tbtn:focus{outline:3px solid #f7e8cd;outline-offset:2px;background:#534b3b}
 .epg-row.focused .chan-cell{outline:2px solid #a2894e;outline-offset:-2px}
 /* Fire OS WebView: keep video composited in-page. Hardware overlay promotion
    on inline <video> inside clipped/rounded/overlayed containers is what
    renders black with playing audio. */
 #video,.hero-screen video{will-change:transform!important}
 .hero-screen{overflow:visible!important;border-radius:0!important}
 .hero-screen::after{display:none!important}
 /* tester debug line: distinguishes loading/seek stalls from compositing bugs */
 #crt-debug-line{position:fixed;left:8px;bottom:8px;z-index:2147483647;background:rgba(0,0,0,.82);color:#9fe870;font:14px/1.35 monospace;padding:6px 10px;border-radius:4px;max-width:94vw;white-space:pre-wrap;pointer-events:none}
 `;document.head.appendChild(style);
 const watching=()=>document.querySelector('#player.on');
 const key=k=>document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
 const reveal=()=>key('Shift');
 function buttons(){return [...document.querySelectorAll('#player button')].filter(b=>!b.disabled&&b.getClientRects().length&&getComputedStyle(b).visibility!=='hidden')}
 let lastInteraction=Date.now();

 // D-pad keys now arrive as native TRUSTED keydown events straight from the
 // WebView: zero bridge latency, single handling point. Menus/guide pass
 // through to the site's own key handlers untouched. While the player is up,
 // manage OSD button focus here (trusted arrows only; synthetic keys from
 // crtRemote below keep reaching the site's handlers, e.g. rewind = seek).
 document.addEventListener('keydown',function(e){
  lastInteraction=Date.now();
  if(!watching())return;
  reveal();
  let bs=buttons(),at=bs.indexOf(document.activeElement);
  if(e.key==='Enter'){
   if(at<0){e.preventDefault();e.stopPropagation();(bs[0]||document.querySelector('#ctl-play'))?.focus()}
   return;
  }
  if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&e.isTrusted){
   e.preventDefault();e.stopPropagation();
   if(at<0){document.querySelector('#ctl-play')?.focus();return}
   bs[(at+(e.key==='ArrowRight'?1:bs.length-1))%bs.length]?.focus();
  }
 },true);

 // Special remote keys bridged from MainActivity (media keys + Menu).
 window.crtRemote=function(k){lastInteraction=Date.now();
  if(k==='MediaPlayPause'){if(watching())document.querySelector('#ctl-play').click();else document.querySelector('#hero-screen')?.click();return}
  if(k==='MediaRewind'||k==='MediaFastForward'){if(watching())key(k==='MediaRewind'?'ArrowLeft':'ArrowRight');return}
  if(k==='Menu'){if(watching()){reveal();(buttons()[0]||document.querySelector('#ctl-play'))?.focus()}return}
  key(k);
 };
 window.crtBack=function(){let player=watching();if(player?.classList.contains('show-more')){document.querySelector('#ctl-more').click();return true}if(document.fullscreenElement){document.exitFullscreen();return true}if(watching()){document.querySelector('#ctl-guide').click();return true}return false};
 window.crtSuspend=function(){document.querySelectorAll('video').forEach(v=>v.pause())};

 // ---- tester debug overlay (0.6): one line, updates 2x/s ----------------
 // Tells the next test WHICH failure it is:
 //  - rs<3 / ns=LOADING for a long time  -> loading/bandwidth/seek stall
 //    ("Tuning..." with no picture is this, NOT the compositing bug)
 //  - rs>=3, t advancing, black picture   -> compositing/overlay bug
 //  - err=...                             -> media decode/network error
 const RSN=['HAVE_NOTHING','HAVE_METADATA','HAVE_CURRENT_DATA','HAVE_FUTURE_DATA','HAVE_ENOUGH_DATA'];
 const NSN=['EMPTY','IDLE','LOADING','NO_SOURCE'];
 const ERRN={1:'ABORTED',2:'NETWORK',3:'DECODE',4:'SRC_NOT_SUPPORTED'};
 const dbg=document.createElement('div');dbg.id='crt-debug-line';dbg.textContent='CRT 0.6 debug: waiting for video...';document.body.appendChild(dbg);
 let lastSrc='',lastErrAt=0;
 setInterval(function(){
  let v=document.querySelector('#video')||document.querySelector('.hero-screen video')||document.querySelector('video');
  if(!v){dbg.textContent='CRT 0.6 debug: no <video> element on page';return}
  let err=v.error?(' err='+ (ERRN[v.error.code]||v.error.code)):'';
  if(err&&Date.now()-lastErrAt>1000){lastErrAt=Date.now();console.log('CRT-DEBUG media error',v.error.code,v.error.message||'')}
  let src=v.currentSrc||v.src||'';if(src!==lastSrc){lastSrc=src;console.log('CRT-DEBUG src',src)}
  let buf='-';try{if(v.buffered.length)buf=v.buffered.end(v.buffered.length-1).toFixed(1)}catch(e){}
  dbg.textContent='CRT 0.6 | rs='+v.readyState+' '+(RSN[v.readyState]||'')+' | ns='+v.networkState+' '+(NSN[v.networkState]||'')+
   ' | t='+v.currentTime.toFixed(1)+'/'+((v.duration&&isFinite(v.duration))?v.duration.toFixed(0):'?')+
   ' | buf='+buf+'s'+(v.paused?' | paused':' | playing')+err;
 },500);

 // Hosted updates, not APK self-installation. Public endpoints only, hourly.
 // File list repointed at the bundle.js architecture (v0.5 listed /js/app.js
 // etc., which no longer exist, so the check could never succeed).
 const files=['/','/js/bundle.js','/data/channels-meta.json','/data/catalog-fallback.json','https://gist.githubusercontent.com/falconRUBIO/dff41fde94c848995176b51829fca12f/raw/custom-lineups.json'];
 let fingerprints=null,pendingAt=0,pendingProgram='',checking=false;
 async function fingerprint(url){
  const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('update source unavailable');
  const text=await response.text();if(!text.length||text.length>2500000)throw Error('invalid update size');
  if(url.endsWith('.json')){const doc=JSON.parse(text);if(url.includes('custom-lineups')&&(doc.schema!==1||typeof doc.revision!=='number'||!doc.channels))throw Error('invalid feed');}
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 }
 async function checkUpdates(){if(checking||document.hidden)return false;checking=true;try{
  const current=[];for(const url of files)current.push(await fingerprint(url));
  if(fingerprints&&current.some((x,i)=>x!==fingerprints[i])){if(!pendingAt){pendingAt=Date.now();pendingProgram=document.querySelector('#video')?.dataset.itemKey||'';}window.crtUpdateStatus='pending';}
  else if(!fingerprints){fingerprints=current;window.crtUpdateStatus='current';}
  return !!pendingAt;
 }catch(e){window.crtUpdateStatus='check failed - retry next hour';return false;}finally{checking=false;}}
 function applyPendingUpdate(){if(!pendingAt||document.hidden)return false;
  const player=watching(),video=document.querySelector('#video');
  if(player&&!pendingProgram&&video?.dataset.itemKey)pendingProgram=video.dataset.itemKey;
  const idle=Date.now()-lastInteraction>10000;
  const boundary=!player||video?.ended||(video?.dataset.itemKey&&video.dataset.itemKey!==pendingProgram);
  if(idle&&(boundary||Date.now()-pendingAt>=15*60000)){location.reload();return true}return false;
 }
 window.crtCheckUpdates=checkUpdates;
 window.crtUpdateStatus='checking';
 checkUpdates();setInterval(checkUpdates,60*60000);setInterval(applyPendingUpdate,15000);
})();
