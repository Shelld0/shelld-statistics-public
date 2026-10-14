/* Shelld Statistics Analytics 2.0: pure, offline calculations.
 * Trade results are additive percentage points, not compounded account equity.
 * Heatmap attributes realized results to the LOCAL/recorded OPEN time, not close time.
 * Never infer an R multiple or percent when its explicit known flag is false.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ShelldAnalyticsV2=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CLOSED=new Set(['WIN','LOSS','BE']);
  const WEEKDAYS=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const isKnown=(row,type)=>{
    const flag=type==='r'?'r_known':'percent_known';
    const field=type==='r'?'r_multiple':'gain_pct';
    const str=String(row?.[field]??'').trim().replace(',','.');
    return row?.[flag]!==0&&row?.[flag]!=='0'&&str!==''&&Number.isFinite(Number(str));
  };
  const amount=(row,type)=>Number(String(row[type==='r'?'r_multiple':'gain_pct']).replace(',','.'));
  const result=t=>String(t?.result||'').toUpperCase();
  const closed=t=>CLOSED.has(result(t));
  // Preserve the wall-clock hour saved in the journal, including MT5's broker-local time.
  // We do not silently convert offsets or browser time zones in the heatmap.
  function wallClock(value){
    if(typeof value!=='string')return null;
    const m=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
    if(!m)return null;
    const [y,mo,d,h,mi]=m.slice(1).map(Number);
    const date=new Date(y,mo-1,d,h,mi,0);
    if(date.getFullYear()!==y||date.getMonth()!==mo-1||date.getDate()!==d||date.getHours()!==h||date.getMinutes()!==mi)return null;
    return {weekday:(date.getDay()+6)%7,hour:h,date:value.slice(0,10)};
  }
  function eventTime(value){
    if(typeof value!=='string'||!value.trim())return 0;
    const t=Date.parse(value);
    return Number.isFinite(t)?t:0;
  }
  function chronological(rows){
    return [...rows].sort((a,b)=>eventTime(a.closed_at||a.opened_at)-eventTime(b.closed_at||b.opened_at)||Number(a.id||0)-Number(b.id||0));
  }
  function bucketLabel(hour,size){return `${String(hour).padStart(2,'0')}:00–${String(hour+size).padStart(2,'0')}:00`;}
  function heatmapKey(row,size=2){
    const clock=wallClock(row?.opened_at);
    if(!clock)return '';
    return `${clock.weekday}:${Math.floor(clock.hour/size)*size}`;
  }
  function statsFor(rows){
    let gain=0,wins=0,losses=0,be=0,knownPct=0,sumR=0,knownR=0;
    rows.forEach(t=>{
      if(result(t)==='WIN')wins++; else if(result(t)==='LOSS')losses++; else if(result(t)==='BE')be++;
      if(isKnown(t,'pct')){gain+=amount(t,'pct');knownPct++;}
      if(isKnown(t,'r')){sumR+=amount(t,'r');knownR++;}
    });
    return {count:rows.length,wins,losses,be,knownPct,knownR,gain,avgR:knownR?sumR/knownR:null,
      winRate:wins+losses?100*wins/(wins+losses):null};
  }
  function heatmap(rows,size=2){
    if(![1,2,4].includes(size))throw new RangeError('Размер интервала: 1, 2 или 4 часа');
    const entries=new Map();let unknownTime=0;
    chronological(rows.filter(closed)).forEach(t=>{
      const key=heatmapKey(t,size);
      if(!key){unknownTime++;return;}
      if(!entries.has(key))entries.set(key,[]);
      entries.get(key).push(t);
    });
    const cells=[];
    for(let day=0;day<7;day++)for(let hour=0;hour<24;hour+=size){
      const key=`${day}:${hour}`;
      cells.push({key,weekday:day,hour,label:bucketLabel(hour,size),...statsFor(entries.get(key)||[])});
    }
    return {size,days:WEEKDAYS,columns:24/size,cells,unknownTime,totalIncluded:rows.filter(closed).length-unknownTime};
  }
  const R_BANDS=Object.freeze([
    {key:'lt3',label:'≤ −3R'},
    {key:'neg3',label:'−3…−2R'},
    {key:'neg2',label:'−2…−1R'},
    {key:'neg1',label:'−1…0R'},
    {key:'zero',label:'0R'},
    {key:'pos1',label:'0…1R'},
    {key:'pos2',label:'1…2R'},
    {key:'pos3',label:'2…3R'},
    {key:'gt3',label:'≥ 3R'}
  ]);
  function rBand(row){
    if(!isKnown(row,'r'))return null;
    const r=amount(row,'r');
    if(r<=-3)return 'lt3';
    if(r<=-2)return 'neg3';
    if(r<=-1)return 'neg2';
    if(r<0)return 'neg1';
    if(r===0)return 'zero';
    if(r<1)return 'pos1';
    if(r<2)return 'pos2';
    if(r<3)return 'pos3';
    return 'gt3';
  }
  function histogram(rows){
    const settled=rows.filter(closed);
    const bands=R_BANDS.map(b=>({...b,count:0,ids:[]}));
    const byKey=Object.fromEntries(bands.map(x=>[x.key,x]));
    for(const row of settled){
      const key=rBand(row);
      if(key){byKey[key].count++;byKey[key].ids.push(row.id);}
    }
    const known=settled.filter(t=>isKnown(t,'r'));
    const sorted=known.map(t=>amount(t,'r')).sort((a,b)=>a-b);
    const mid=Math.floor(sorted.length/2);
    const median=sorted.length?(sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2):null;
    return {bands,known:known.length,unknown:settled.length-known.length,coverage:settled.length?100*known.length/settled.length:null,median};
  }
  function drawdowns(rows){
    const priced=chronological(rows.filter(t=>closed(t)&&isKnown(t,'pct')));
    let total=0,peak=0,episode=null;
    const episodes=[];
    priced.forEach((trade,i)=>{
      total+=amount(trade,'pct');
      if(total<peak-1e-9){
        if(!episode)episode={startIndex:i+1,startTradeId:trade.id,startAt:trade.closed_at||trade.opened_at,peak,depth:0,tradeIds:[]};
        episode.depth=Math.max(episode.depth,peak-total);
        episode.tradeIds.push(trade.id);
      }else{
        if(episode){
          episode.recovered=true;
          episode.endAt=trade.closed_at||trade.opened_at;
          episode.endTradeId=trade.id;
          episode.tradeIds.push(trade.id);
          episode.tradeCount=episode.tradeIds.length;
          episodes.push(episode);episode=null;
        }
        if(total>peak)peak=total;
      }
    });
    if(episode){episode.recovered=false;episode.endAt=priced.at(-1)?.closed_at||priced.at(-1)?.opened_at||'';episode.tradeCount=episode.tradeIds.length;episodes.push(episode);}
    const worst=[...episodes].sort((a,b)=>b.depth-a.depth||b.tradeCount-a.tradeCount)[0]||null;
    const longest=[...episodes].sort((a,b)=>b.tradeCount-a.tradeCount||b.depth-a.depth)[0]||null;
    return {episodes,worst,longest,currentDrawdown:Math.max(0,peak-total),maxDrawdown:worst?worst.depth:0,pricedCount:priced.length,unknown:rows.filter(closed).length-priced.length};
  }
  function groupDirection(rows){
    const settled=rows.filter(closed);
    const groups=['LONG','SHORT'].map(direction=>({direction,...statsFor(settled.filter(t=>String(t.direction||'').toUpperCase()===direction))}));
    const other=settled.filter(t=>!['LONG','SHORT'].includes(String(t.direction||'').toUpperCase()));
    if(other.length)groups.push({direction:'НЕ УКАЗАНО',...statsFor(other)});
    return groups;
  }
  function groupModels(rows){
    const groups=new Map();
    for(const t of rows.filter(closed)){
      const key=String(t.model||'').trim()||'Без модели';
      const list=groups.get(key)||[];list.push(t);groups.set(key,list);
    }
    return [...groups].map(([name,items])=>({name,...statsFor(items)})).sort((a,b)=>(b.knownPct?b.gain:-Infinity)-(a.knownPct?a.gain:-Infinity)||b.count-a.count);
  }
  function calculate(rows,options={}){
    const normalized=(Array.isArray(rows)?rows:[]).map(t=>({...t,result:options.effectiveResult?.(t)||t.result}));
    const settled=normalized.filter(closed);
    const buckets=Number(options.bucketSize||2);
    return {closedCount:settled.length,heatmap:heatmap(settled,buckets),histogram:histogram(settled),drawdowns:drawdowns(settled),directions:groupDirection(settled),models:groupModels(settled)};
  }
  return {calculate,wallClock,isKnown,heatmap,heatmapKey,histogram,rBand,drawdowns,groupDirection,groupModels,statsFor,R_BANDS,WEEKDAYS};
});
