(function(){
 if(document.getElementById("crt-access-gate")||!document.getElementById("app"))return;
 if(window.crtTVInstalled)return;window.crtTVInstalled=true;
 window.crtTvVersion='0.7';
 const style=document.createElement('style');style.textContent=`
 .desktop-player .preview-actions,#ctl-theater,#ctl-full{display:none!important}
 .desktop-player .osd-rows .tbtn:focus{outline:3px solid #f7e8cd;outline-offset:2px;background:#534b3b}
 .epg-row.focused .chan-cell{outline:3px solid #f7e8cd!important;outline-offset:-2px;background:#534b3b!important}
 .epg-row.focused{outline:2px solid #a2894e!important;outline-offset:-2px}
 /* Fire OS WebView: keep video composited in-page. Hardware overlay promotion
    on inline <video> inside clipped/rounded/overlayed containers is what
    renders black with playing audio. */
 #video,.hero-screen video{will-change:transform!important}
 .hero-screen{overflow:visible!important;border-radius:0!important}
 .hero-screen::after{display:none!important}
 /* TV light mode: the guide ships ~9k nodes / 2k tiles; Fire Stick WebView
    stalls on transitions and offscreen-row rendering. */
 *,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}
 .epg-row,.tile,.sports-row,.wo-card,.hero-screen,#player,.chan-cell{box-shadow:none!important;text-shadow:none!important;backdrop-filter:none!important}
 .epg-row{content-visibility:auto!important;contain-intrinsic-size:auto 112px!important}
 /* tester debug line: distinguishes loading/seek stalls from compositing
    bugs. Kept inside the TV safe area (~4% overscan margin), wraps to two
    lines when narrow, large enough to read at 10 feet, dark backing. */
 #crt-debug-line{position:fixed;left:4vw;right:4vw;bottom:4vh;z-index:2147483647;background:rgba(0,0,0,.9);color:#9fe870;font:20px/1.4 monospace;padding:10px 14px;border-radius:6px;white-space:pre-wrap;overflow-wrap:break-word;pointer-events:none}
 `;document.head.appendChild(style);
 const watching=()=>document.querySelector('#player.on');
 const key=k=>document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
 const reveal=()=>key('Shift');
 function buttons(){return [...document.querySelectorAll('#player button')].filter(b=>!b.disabled&&b.getClientRects().length&&getComputedStyle(b).visibility!=='hidden')}
 let lastInteraction=Date.now();
 let lastKeyAt=0,keyPaintMs=0;
 const whatsonOpen=()=>!!document.querySelector('#whatson.on');

 // D-pad keys now arrive as native TRUSTED keydown events straight from the
 // WebView: zero bridge latency, single handling point. Menus/guide pass
 // through to the site's own key handlers. While the player is up, manage
 // OSD button focus here (trusted arrows only; synthetic keys from crtRemote
 // below keep reaching the site's handlers, e.g. rewind = seek).
 //
 // Guide key coalescing (tester: presses queue up, then jump ~15s later):
 // a long main-thread block makes every queued press land at once. During a
 // busy window after a nav key, extra presses are absorbed and collapsed into
 // at most ONE repeat of the latest direction once the thread settles.
 const NAV={ArrowUp:1,ArrowDown:1,ArrowLeft:1,ArrowRight:1};
 let busyUntil=0,pendingNav=null,pendingTimer=0;
 function settle(){pendingTimer=0;if(pendingNav){const k2=pendingNav;pendingNav=null;(document.activeElement||document).dispatchEvent(new KeyboardEvent('keydown',{key:k2,bubbles:true,cancelable:true}))}}
 document.addEventListener('keydown',function(e){
  lastInteraction=Date.now();lastKeyAt=performance.now();
  requestAnimationFrame(function(){requestAnimationFrame(function(){keyPaintMs=Math.round(performance.now()-lastKeyAt)})});
  if(whatsonOpen())return; // what's-on cards are native buttons: let the site/remote work untouched
  if(!watching()){
   if(NAV[e.key]&&e.isTrusted){
    const now=Date.now();
    if(now<busyUntil){
     e.preventDefault();e.stopImmediatePropagation();
     pendingNav=e.key;
     if(!pendingTimer)pendingTimer=setTimeout(settle,Math.max(50,busyUntil-now));
    }else{
     busyUntil=now+400;
    }
   }
   return;
  }
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
  if(k==='MenuLong'){if(typeof dbgToggle==='function')dbgToggle();return}
  if(k==='MediaPlayPause'){if(watching())document.querySelector('#ctl-play').click();else document.querySelector('#hero-screen')?.click();return}
  if(k==='MediaRewind'||k==='MediaFastForward'){if(watching())key(k==='MediaRewind'?'ArrowLeft':'ArrowRight');return}
  if(k==='Menu'){
   if(watching()){reveal();(buttons()[0]||document.querySelector('#ctl-play'))?.focus();return}
   const inSports=!!(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('.sports-section, #sports-player'));
   if(inSports){document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return}
   const row=document.querySelector('.sports-row:not(:disabled)')||document.querySelector('.sports-row');
   if(row){row.focus();row.scrollIntoView({block:'center'})}
   return;
  }
  key(k);
 };
 window.crtBack=function(){
  const ae=document.activeElement;
  if(ae&&ae.closest&&ae.closest('.sports-section, #sports-player')){ae.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true}
  if(whatsonOpen()){document.querySelector('#ctl-whatson').click();return true}let player=watching();if(player?.classList.contains('show-more')){document.querySelector('#ctl-more').click();return true}if(document.fullscreenElement){document.exitFullscreen();return true}if(watching()){document.querySelector('#ctl-guide').click();return true}return false};
 window.crtSuspend=function(){document.querySelectorAll('video').forEach(v=>v.pause())};

 // Auto-open the TV-friendly mode on launch: start playback, then open the
 // what's-on channel browser (the path the tester found usable). Once per load.
 let autoOpened=false;
 const autoOpen=setInterval(function(){
  if(autoOpened){clearInterval(autoOpen);return}
  if(!document.querySelector('#app'))return;
  if(!watching()){document.querySelector('#hero-screen')?.click();return}
  const wo=document.querySelector('#ctl-whatson');
  if(wo){autoOpened=true;clearInterval(autoOpen);wo.click()}
 },800);
 setTimeout(function(){clearInterval(autoOpen)},20000);

 // Preview-stall guard: a stalled preview video pegs the Fire Stick main
 // thread (that is the guide lag). While browsing (not watching), if the
 // preview sits below HAVE_CURRENT_DATA for >8s, pause it; each channel
 // change gets a fresh 8s to prove it can play.
 let stallSince=0,stallChan='';
 setInterval(function(){
  if(watching()){stallSince=0;return}
  const p=document.querySelector('#preview');
  if(!p){stallSince=0;return}
  const chan=p.dataset.channelId||'';
  if(chan!==stallChan){stallChan=chan;stallSince=0;p.style.display=''}
  if(p.paused)return;
  if(p.readyState<3){
   if(!stallSince)stallSince=Date.now();
   else if(Date.now()-stallSince>8000){p.pause();p.style.display='none';stallSince=0}
  }else stallSince=0;
 },1000);

 // ---- tester debug overlay (0.7): one line, updates 2x/s ----------------
 // Tells the next test WHICH failure it is:
 //  - rs<3 / ns=LOADING for a long time  -> loading/bandwidth/seek stall
 //    ("Tuning..." with no picture is this, NOT the compositing bug)
 //  - rs>=3, t advancing, black picture   -> compositing/overlay bug
 //  - err=...                             -> media decode/network error
 //  - key->paint N ms                     -> main-thread congestion on keys
 const RSN=['HAVE_NOTHING','HAVE_METADATA','HAVE_CURRENT_DATA','HAVE_FUTURE_DATA','HAVE_ENOUGH_DATA'];
 const NSN=['EMPTY','IDLE','LOADING','NO_SOURCE'];
 const ERRN={1:'ABORTED',2:'NETWORK',3:'DECODE',4:'SRC_NOT_SUPPORTED'};
 const dbg=document.createElement('div');dbg.id='crt-debug-line';dbg.textContent='CRT 0.7 debug: waiting for video...';document.body.appendChild(dbg);
 // Visibility: hidden by default (0.7). Shows for 3s at launch so the build
 // version is confirmable, auto-shows only while playback is stalled
 // (readyState<3 for >8s, or a media error) and for 5s after recovery, and
 // toggles on demand with long-press Menu (bridged as 'MenuLong').
 let dbgPinned=false,dbgStallAt=0,dbgLastBadAt=0;
 const dbgLaunchUntil=Date.now()+3000;
 function dbgToggle(){dbgPinned=!dbgPinned;dbg.style.display=dbgPinned?'':'none'}
 dbg.style.display='';
 let lastSrc='',lastErrAt=0;
 setInterval(function(){
  let v=(!watching()&&document.querySelector('#preview'))||document.querySelector('#video')||document.querySelector('.hero-screen video')||document.querySelector('video');
  if(!v){dbg.textContent='CRT 0.7 debug: no <video> element on page';dbg.style.display=(dbgPinned||Date.now()<dbgLaunchUntil)?'':'none';return}
  let err=v.error?(' err='+ (ERRN[v.error.code]||v.error.code)):'';
  if(err&&Date.now()-lastErrAt>1000){lastErrAt=Date.now();console.log('CRT-DEBUG media error',v.error.code,v.error.message||'')}
  let src=v.currentSrc||v.src||'';if(src!==lastSrc){lastSrc=src;console.log('CRT-DEBUG src',src)}
  let buf='-';try{if(v.buffered.length)buf=v.buffered.end(v.buffered.length-1).toFixed(1)}catch(e){}
  dbg.textContent='CRT 0.7 | rs='+v.readyState+' '+(RSN[v.readyState]||'')+' | ns='+v.networkState+' '+(NSN[v.networkState]||'')+
   ' | t='+v.currentTime.toFixed(1)+'/'+((v.duration&&isFinite(v.duration))?v.duration.toFixed(0):'?')+
   ' | buf='+buf+'s'+(v.paused?' | paused':' | playing')+' | key->paint '+keyPaintMs+'ms'+err;
  const now=Date.now();
  if(v.readyState<3){if(!dbgStallAt)dbgStallAt=now}else dbgStallAt=0;
  const bad=!!err||(dbgStallAt&&now-dbgStallAt>8000);
  if(bad)dbgLastBadAt=now;
  dbg.style.display=(dbgPinned||now<dbgLaunchUntil||bad||now-dbgLastBadAt<5000)?'':'none';
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

 // APK self-update: at load and hourly, check the latest crt-tv-get release
 // (public API, no cookie). A newer tag shows an on-screen prompt; Install
 // hands the asset URL to the native bridge, which downloads via
 // DownloadManager and fires the Fire OS system installer (the tester
 // confirms the install prompt; first time, Fire OS asks to allow
 // "install unknown apps" for CRT TV once).
 function cmpVer(a,b){const p=String(a).split('.'),q=String(b).split('.');for(let i=0;i<3;i++){const x=parseInt(p[i]||'0',10),y=parseInt(q[i]||'0',10);if(x!==y)return x>y?1:-1}return 0}
 function showUpdatePrompt(ver,url){
  if(document.getElementById('crt-update-prompt'))return;
  const d=document.createElement('div');
  d.id='crt-update-prompt';
  d.style.cssText='position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:2147483647;background:#25231F;color:#F7E8CD;padding:14px 18px;border-radius:8px;border:2px solid #B89037;font:14px/1.4 sans-serif;max-width:80vw';
  const b=document.createElement('button');b.textContent='Install update v'+ver;b.style.cssText='margin-left:10px;padding:8px 14px;font:600 14px sans-serif;cursor:pointer';
  const l=document.createElement('button');l.textContent='Later';l.style.cssText='margin-left:8px;padding:8px 14px;font:14px sans-serif;cursor:pointer';
  d.append('CRT TV v'+ver+' is available.',b,l);
  b.onclick=()=>{window.CrtNative.installUpdate(url);d.remove()};
  l.onclick=()=>d.remove();
  document.body.appendChild(d);b.focus();
 }
 async function checkApkUpdate(){
  if(!(window.CrtNative&&window.CrtNative.installUpdate))return;
  try{
   const r=await fetch('https://api.github.com/repos/falconRUBIO/crt-tv-get/releases/latest',{cache:'no-store'});
   if(!r.ok)return;
   const rel=await r.json();
   const latest=String(rel.tag_name||'').replace(/^v/,'');
   const apk=(rel.assets||[]).find(a=>/\.apk$/i.test(a.name||''));
   if(!latest||!apk||!apk.browser_download_url)return;
   if(cmpVer(latest,window.crtTvVersion)>0)showUpdatePrompt(latest,apk.browser_download_url);
  }catch(e){}
 }
 window.crtCheckApkUpdate=checkApkUpdate;
 checkApkUpdate();setInterval(checkApkUpdate,60*60000);
})();
