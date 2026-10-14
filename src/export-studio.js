/* Export Studio: minimal, private, pixel-consistent Telegram and Square PNG output. */
(()=>{
 'use strict';
 const api=window.ShelldExportCore;
 const by=id=>document.getElementById(id);
 if(!api||!by('studioCanvas'))return;
 const defaults=Object.freeze({mode:'summary',period:'30',format:'telegram',template:'ember',
   title:'Мои результаты торговли',handle:'',style:'Swing',asset:'all',transparent:false});
 let state={...defaults},rows=[],account=null,tradeId='',busy=false,lastSummary=null,lastTrade=null;
 const canvas=by('studioCanvas'),ctx=canvas.getContext('2d');
 const q=sel=>[...document.querySelectorAll(sel)];
 const brand=new Image();let brandReady=false;
 const logoReady=new Promise(resolve=>{
   brand.onload=()=>{brandReady=true;schedule();resolve();};
   brand.onerror=()=>resolve();
 });
 brand.src='assets/logo.svg'; // The exact SVG used in the main application header.
 const colors={
   ember:{bg:'#0b0c11',panel:'#14161c',edge:'#343640',text:'#f2f4f7',muted:'#a0a6b0',accent:'#ef555f',positive:'#59d5aa',negative:'#f15a70',line:'#3d414c'},
   graphite:{bg:'#11151b',panel:'#1b2028',edge:'#414852',text:'#f0f3f7',muted:'#abb2be',accent:'#bec7d4',positive:'#69d9b3',negative:'#ed7286',line:'#485361'},
   paper:{bg:'#f3efe9',panel:'#fffaf4',edge:'#d5cdc3',text:'#292b31',muted:'#737b87',accent:'#b94c5e',positive:'#257e62',negative:'#b94354',line:'#d1c8bd'}
 };
 const safe=(s,max=100)=>api.safeText(s,max);
 const effective=(trade)=>window.ShelldBE?.effectiveResult(trade,window.shelldBeSettings?.()||{})||trade?.result||'OPEN';
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function label(x,y,value,size=26,color='#fff',weight=650,align='left',max=1000,mono=false){
   const str=safe(value,180);
   ctx.textAlign=align;ctx.textBaseline='alphabetic';
   const family=mono?'"JetBrains Mono", Consolas, monospace':'Inter, Arial, sans-serif';
   let fontSize=size;
   for(let i=0;i<30;i++){
     ctx.font=`${weight} ${fontSize}px ${family}`;
     if(ctx.measureText(str).width<=max||fontSize<=17)break;
     fontSize-=1;
   }
   ctx.fillStyle=color;
   ctx.fillText(str,x,y,max);
 }
 function rounded(x,y,w,h,color,stroke='',radius=22,lw=1.5){
   ctx.beginPath();ctx.roundRect(x,y,w,h,radius);
   ctx.fillStyle=color;ctx.fill();
   if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}
 }
 function rule(x1,y,x2,c){ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.strokeStyle=c;ctx.lineWidth=1.3;ctx.stroke();}
 function badgeColors(asset){
   const t=String(asset||'').toUpperCase();
   if(t.includes('EUR'))return ['#35224e','#8660b6','#e2c5ff'];
   if(t.includes('GBP'))return ['#3e3018','#ca963c','#ffe0a1'];
   if(t.includes('XAU')||t.includes('GOLD'))return ['#3d3217','#d3ad51','#ffe9a8'];
   if(t.includes('GER')||t.includes('US100')||t.includes('NAS'))return ['#182c43','#5488ce','#deebff'];
   if(t.includes('JPY'))return ['#16453f','#52b6ad','#cffff6'];
   return ['#242c3c','#647b9a','#eff3fa'];
 }
 function assetBadge(asset,y){
   const name=safe(asset,25);if(!name)return;
   ctx.font='750 25px Inter, Arial, sans-serif';
   const width=clamp(ctx.measureText(name).width+80,218,465),x=(1080-width)/2;
   const [bg,border,fg]=badgeColors(name);
   ctx.save();ctx.shadowColor=border;ctx.shadowBlur=15;
   rounded(x,y,width,57,bg,border,28,1.8);ctx.restore();
   label(540,y+37,name,26,fg,750,'center',width-32);
 }
 function backdrop(p,H){
   ctx.clearRect(0,0,1080,H);
   const edge=state.transparent?24:0;
   if(!state.transparent){ctx.fillStyle=p.bg;ctx.fillRect(0,0,1080,H);}
   rounded(edge,edge,1080-edge*2,H-edge*2,p.bg,p.edge,edge?31:0,1.5);
   // Intentionally subtle background — no diagonal stripes and no large glowing shapes.
   ctx.save();ctx.beginPath();ctx.roundRect(edge,edge,1080-edge*2,H-edge*2,edge?31:0);ctx.clip();
   const glow=ctx.createRadialGradient(1010,85,5,1010,85,500);
   glow.addColorStop(0,p.accent+'12');glow.addColorStop(1,p.accent+'00');
   ctx.fillStyle=glow;ctx.fillRect(400,edge,680,540);ctx.restore();
   if(brandReady)ctx.drawImage(brand,65,53,69,60);
   else { // The vectors below mirror src/assets/logo.svg if loading the file fails.
     ctx.save();ctx.translate(65,53);ctx.scale(69/150,60/130);ctx.translate(-25,-35);
     ctx.strokeStyle='#E24B4A';ctx.strokeWidth=10;ctx.lineWidth=10;ctx.lineCap='round';
     for(const pth of ['M60 70v82','M140 70v82','M48 70h104','M42 86h116'])ctx.stroke(new Path2D(pth));ctx.restore();
   }
   const title='Shelld Statistics';
   label(146,101,title,31,p.text,750,'left',540);
   rule(73,146,1007,p.edge);
 }
 function modelAndTitle(p,yModel,yTitle){
   label(540,yModel,state.style,28,p.accent,750,'center',700);
   label(540,yTitle,state.title||'Мои результаты торговли',48,p.text,780,'center',930);
 }
 function footer(p,H){
   const handle=safe(state.handle,44);
   if(handle)label(1005,H-48,handle,18,p.muted,580,'right',700);
 }
 function metric(p,x,y,w,h,heading,value,tone=null){
   rounded(x,y,w,h,p.panel,p.edge,20,1.4);
   label(x+w/2,y+47,heading.toUpperCase(),17,p.muted,650,'center',w-30);
   label(x+w/2,y+h-47,value,34,tone||p.text,780,'center',w-30,true);
 }
 function triple(p,y,values,h=175){
   const w=292,gap=14,left=74;
   values.forEach((item,i)=>metric(p,left+i*(w+gap),y,w,h,item[0],item[1],item[2]));
 }
 function resultValue(gain){return api.formatSigned(gain);}
 function tradeView(p,trade,H){
   const portrait=H>1200;
   const status=trade?effective(trade):'—';
   const gain=trade&&api.isKnown(trade,'pct')?Number(trade.gain_pct):null;
   const direction=trade?.direction||'—';
   const duration=window.ShelldDuration?.holdingTime(trade?.opened_at,trade?.closed_at)||'—';
   modelAndTitle(p,portrait?236:206,portrait?328:288);
   if(trade?.asset)assetBadge(trade.asset,portrait?386:344);
   label(540,portrait?551:469,'РЕЗУЛЬТАТ (%)',20,p.muted,690,'center',400);
   label(540,portrait?744:637,resultValue(gain),132,
     gain===null?p.text:gain<0?p.negative:p.positive,800,'center',880,true);
   triple(p,portrait?953:786,[
     ['Результат',status,status==='LOSS'?p.negative:status==='WIN'?p.positive:p.text],
     ['Направление',String(direction).toUpperCase(),null],
     ['Длительность',duration,null]
   ],portrait?202:176);
   footer(p,H);
 }
 function curve(p,stats,x,y,w,h){
   rounded(x,y,w,h,p.panel,p.edge,19,1.4);
   label(x+28,y+38,'Equity Curve',17,p.muted,650,'left',250);
   const data=stats.curve||[];
   const left=x+54,right=x+w-36,top=y+72,bottom=y+h-41;
   if(data.length<2){label(x+w/2,y+h/2,'Недостаточно данных',22,p.muted,500,'center',w-55);return;}
   const values=data.map(d=>Number(d.total));
   const min=Math.min(0,...values),max=Math.max(0,...values);
   const pad=Math.max(1,(max-min)*.14),lo=min-pad,hi=max+pad;
   const X=i=>left+(right-left)*i/(values.length-1);
   const Y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
   const zero=Y(0);rule(left,zero,right,p.line);
   const pts=values.map((v,i)=>[X(i),Y(v)]);
   ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
   ctx.beginPath();ctx.moveTo(left,bottom);ctx.lineTo(...pts[0]);
   for(let i=1;i<pts.length;i++)ctx.lineTo(...pts[i]);
   ctx.lineTo(right,bottom);ctx.closePath();
   const gradient=ctx.createLinearGradient(0,top,0,bottom);
   gradient.addColorStop(0,p.accent+'36');gradient.addColorStop(1,p.accent+'00');
   ctx.fillStyle=gradient;ctx.fill();
   ctx.beginPath();ctx.moveTo(...pts[0]);
   for(let i=1;i<pts.length;i++){
     const a=pts[i-1],b=pts[i],mx=(a[0]+b[0])/2;
     ctx.bezierCurveTo(mx,a[1],mx,b[1],b[0],b[1]);
   }
   ctx.strokeStyle=p.accent;ctx.lineWidth=3.5;ctx.lineJoin='round';ctx.stroke();
   ctx.restore();
 }
 function summaryView(p,summary,H){
   const portrait=H>1200;
   modelAndTitle(p,portrait?215:199,portrait?303:271);
   if(state.asset!=='all')assetBadge(state.asset,portrait?339:304);
   label(540,portrait?475:411,'TOTAL GAIN (%)',19,p.muted,700,'center',500);
   label(540,portrait?615:510,resultValue(summary.gain),100,
     summary.gain===null?p.text:summary.gain<0?p.negative:p.positive,780,'center',850,true);
   curve(p,summary,74,portrait?678:553,932,portrait?330:252);
   triple(p,portrait?1050:829,[
     ['Закрытые сделки',String(summary.closed),null],
     ['Win Rate',summary.winRate===null?'—':summary.winRate.toFixed(1)+'%',null],
     ['Avg Winning R',api.formatSigned(summary.avgWinningR,'R',2),null]
   ],portrait?181:151);
   footer(p,H);
 }
 function paint(){
   const conf=api.configs[state.format]||api.configs.telegram;
   canvas.width=conf.width;canvas.height=conf.height;
   ctx.setTransform(1,0,0,1,0,0);
   const p=colors[state.template]||colors.ember;
   backdrop(p,conf.height);
   if(state.mode==='trade')tradeView(p,lastTrade,conf.height);
   else summaryView(p,lastSummary||api.summarize([]),conf.height);
 }
 function setChoices(){
   q('[data-studio-mode]').forEach(b=>{const active=b.dataset.studioMode===state.mode;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
   q('[data-studio-format]').forEach(b=>{const active=b.dataset.studioFormat===state.format;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
   q('[data-studio-template]').forEach(b=>{const active=b.dataset.studioTemplate===state.template;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
   by('studioPeriodRow').classList.toggle('hidden',state.mode==='trade');
   by('studioAssetRow').classList.toggle('hidden',state.mode==='trade');
   by('studioTradeRow').classList.toggle('hidden',state.mode!=='trade');
   by('studioPeriod').value=state.period;
   by('studioTitle').value=state.title;
   by('studioHandle').value=state.handle;
   by('studioStyle').value=state.style;
   by('studioAsset').value=state.asset;
   by('studioTransparent').checked=Boolean(state.transparent);
 }
 function fillAssetOptions(){
   const select=by('studioAsset');
   const assets=[...new Set(rows.map(t=>String(t.asset||'').trim().toUpperCase()).filter(Boolean))].sort();
   select.innerHTML='';
   select.add(new Option('Все активы','all'));
   assets.forEach(a=>select.add(new Option(a,a)));
   if(!assets.includes(state.asset))state.asset='all';
   select.value=state.asset;
 }
 function fillTradeOptions(){
   const all=api.normalizeClosed(rows,effective).reverse();
   const previous=String(tradeId);
   by('studioTradeSelect').innerHTML='';
   all.forEach(t=>{
     const option=new Option(`#${t.id} · ${t.asset||'Актив'} · ${api.formatSigned(api.isKnown(t,'pct')?t.gain_pct:null)}`,String(t.id));
     by('studioTradeSelect').add(option);
   });
   tradeId=all.find(t=>String(t.id)===previous)?previous:(all[0]?String(all[0].id):'');
   by('studioTradeSelect').value=tradeId;
 }
 function redraw(){
   const selected=state.mode==='trade'?[...rows]:api.filterPeriod(rows,state.period,new Date()).filter(t=>state.asset==='all'||String(t.asset||'').toUpperCase()===state.asset);
   lastSummary=api.summarize(selected,effective);
   lastTrade=state.mode==='trade'?api.getTrade(rows,tradeId,effective):null;
   paint();
   const conf=api.configs[state.format];
   by('studioResolution').textContent=`${conf.width} × ${conf.height} PNG`;
   const usable=state.mode==='trade'?Boolean(lastTrade):lastSummary.closed>0;
   by('studioExportBtn').disabled=!usable||busy;
   by('studioCopyCaptionBtn').disabled=!usable;
   by('studioPreviewInfo').textContent=state.mode==='trade'
      ?lastTrade?'Одна закрытая сделка · без личных данных':'Закрытых сделок пока нет'
      :`${lastSummary.closed} закрытых · ${lastSummary.knownProfit} с подтверждённым результатом в %${lastSummary.missingProfit?` · ${lastSummary.missingProfit} без %`:''}`;
 }
 let pending=0;
 function schedule(){if(pending)cancelAnimationFrame(pending);pending=requestAnimationFrame(()=>{pending=0;redraw();});}
 // Save changes locally at once, then persist the same account-scoped draft to SQLite.
 // A pending debounce must not lose the title typed immediately before closing Electron.
 const prefsKey=id=>'export_studio_v1_account_'+id;
 const draftKey=id=>'shelld.export-studio.draft.'+id;
 const knownPrefs=new Set([...Object.keys(defaults),'selectedTradeId']);
 let saveTimer=0,saveQueue=Promise.resolve(),draftRevision=0;
 function snapshot(){return {...state,selectedTradeId:tradeId};}
 function saveLocal(id,value){
   if(id==null)return;
   try{localStorage.setItem(draftKey(id),JSON.stringify(value));}catch(error){console.warn('Local draft unavailable',error);}
 }
 function loadLocal(id){
   try{return JSON.parse(localStorage.getItem(draftKey(id))||'null');}catch{return null;}
 }
 async function persistPreferences(accountId,value){
   if(accountId==null)return;
   const serialized=JSON.stringify(value);
   // Serialize writes so the last edit always wins even if IPC calls are delayed.
   saveQueue=saveQueue.catch(()=>{}).then(()=>window.shelld.setSetting(prefsKey(accountId),serialized));
   try{await saveQueue;}catch(error){console.warn('Studio preferences not saved in SQLite',error);}
 }
 function flushChanges(){
   clearTimeout(saveTimer);saveTimer=0;
   const id=account?.profile?.id;
   if(id!=null)return persistPreferences(id,snapshot());
   return Promise.resolve();
 }
 function changed(){
   schedule();
   const id=account?.profile?.id,value=snapshot();
   if(id==null)return;
   saveLocal(id,value);clearTimeout(saveTimer);
   saveTimer=setTimeout(()=>{saveTimer=0;persistPreferences(id,value);},320);
 }
 async function load(){
   if(!by('studio'))return;
   try{
     const [current,items]=await Promise.all([window.shelld.activeAccount(),window.shelld.listTrades()]);
     if(!current?.profile?.id)return;
     const nextId=current.profile.id;
     const preferences=await window.shelld.getSetting(prefsKey(nextId));
     // An immediate local snapshot is preferred if the app was closed before the SQLite debounce.
     const parsedLocal=loadLocal(nextId);
     let parsedDb={};try{parsedDb=JSON.parse(preferences||'{}')||{};}catch{}
     const parsed=parsedLocal&&typeof parsedLocal==='object'?parsedLocal:parsedDb;
     account=current;rows=Array.isArray(items)?items:[];
     state={...defaults,...Object.fromEntries(Object.entries(parsed||{}).filter(([k])=>knownPrefs.has(k)&&Object.prototype.hasOwnProperty.call(defaults,k)))};
     if(!['telegram','square'].includes(state.format))state.format='telegram';
     if(!['Swing','Intraday','Scalping'].includes(state.style))state.style='Swing';
     tradeId=String(parsed?.selectedTradeId||'');
     fillAssetOptions();setChoices();fillTradeOptions();schedule();
   }catch(error){by('studioPreviewInfo').textContent='Ошибка загрузки данных: '+error.message;}
 }
 document.addEventListener('focusout',event=>{
   if(by('studio')?.contains(event.target)&&saveTimer)void flushChanges();
 });
 window.addEventListener('beforeunload',()=>{
   const id=account?.profile?.id;if(id!=null)saveLocal(id,snapshot());
   if(id!=null){
     try{window.shelld.flushStudioPreferences?.(id,JSON.stringify(snapshot()));}
     catch(error){console.warn('Final Studio draft flush unavailable',error);}
   }
 });
 const announce=message=>{if(by('toast')){by('toast').textContent=message;by('toast').classList.add('show');setTimeout(()=>by('toast')?.classList.remove('show'),3000);}else alert(message);};
 q('[data-studio-mode]').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.studioMode;setChoices();changed();}));
 q('[data-studio-format]').forEach(b=>b.addEventListener('click',()=>{state.format=b.dataset.studioFormat;setChoices();changed();}));
 q('[data-studio-template]').forEach(b=>b.addEventListener('click',()=>{state.template=b.dataset.studioTemplate;setChoices();changed();}));
 by('studioPeriod').addEventListener('change',e=>{state.period=e.target.value;changed();});
 by('studioTradeSelect').addEventListener('change',e=>{tradeId=e.target.value;changed();});
 by('studioTitle').addEventListener('input',e=>{state.title=e.target.value;changed();});
 by('studioHandle').addEventListener('input',e=>{state.handle=e.target.value;changed();});
 by('studioStyle').addEventListener('change',e=>{state.style=e.target.value;changed();});
 by('studioAsset').addEventListener('change',e=>{state.asset=e.target.value;changed();});
 by('studioTransparent').addEventListener('change',e=>{state.transparent=e.target.checked;changed();});
 by('studioResetBtn').addEventListener('click',()=>{state={...defaults};fillAssetOptions();setChoices();changed();});
 by('studioCopyCaptionBtn').addEventListener('click',async()=>{
   try{
     const summary=state.mode==='trade'&&lastTrade?api.summarize([lastTrade],effective):lastSummary;
     const caption=state.mode==='trade'&&lastTrade
       ?api.tradeCaption(lastTrade,state)
       :api.buildCaption(summary||api.summarize([]),state,null);
     await window.shelld.copyText(caption);
     announce('Подпись скопирована в буфер');
   }catch(e){announce('Ошибка копирования: '+e.message);}
 });
 by('studioExportBtn').addEventListener('click',async()=>{
   if(busy||by('studioExportBtn').disabled)return;
   busy=true;redraw();
   try{
     if(document.fonts?.ready)await document.fonts.ready;
     if(!brandReady)await logoReady;
     paint();
     const file=`Shelld-${state.format}-${state.mode}-${new Date().toISOString().slice(0,10)}.png`;
     const result=await window.shelld.saveImageExport(canvas.toDataURL('image/png'),file);
     if(result&&!result.canceled)announce('PNG сохранён — готово для Telegram');
   }catch(e){announce('Ошибка экспорта: '+e.message);}
   finally{busy=false;redraw();}
 });
 const nav=by('studio')?document.querySelector('[data-page="studio"]'):null;
 nav?.addEventListener('click',()=>{load();});
 window.addEventListener('shelld-account-changed',()=>{load();});
 window.shelld?.onMt5Synced?.(()=>{if(by('studio').classList.contains('active'))load();});
 if(document.fonts?.ready)document.fonts.ready.then(()=>schedule());
 load();
})();
