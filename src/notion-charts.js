/* Shelld Statistics interactive equity chart: consistent SVG geometry and truthful data. */
(function(root,factory){
  const result=factory();
  if(typeof module==='object'&&module.exports)module.exports=result;
  root.ShelldCurve=result;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const W=960,H=425,L=74,R=22,T=22,B=361;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const numeric=x=>Number.isFinite(Number(x))?Number(x):0;
  const priceKnown=t=>t.percent_known!==0&&t.percent_known!=='0';
  function cumulative(rows){
    const closed=(rows||[]).filter(t=>['WIN','LOSS','BE'].includes(String(t.result||'').toUpperCase())&&priceKnown(t));
    const values=[0];let running=0;
    for(const trade of closed){running+=numeric(trade.gain_pct);values.push(Number(running.toFixed(10)));}
    return {closed,values,total:running};
  }
  function niceStep(value){
    if(!value||value<=0)return 1;
    const order=Math.pow(10,Math.floor(Math.log10(value)));
    return ([1,2,2.5,5,10].find(m=>m*order>=value)||10)*order;
  }
  function rangeFor(values){
    const lo=Math.min(0,...values),hi=Math.max(0,...values),span=Math.max(1,hi-lo);
    const padding=Math.max(0.45,span*.17);
    const min=lo-padding,max=hi+padding,step=niceStep((max-min)/5);
    return {ymin:Math.floor(min/step)*step,ymax:Math.ceil(max/step)*step,step};
  }
  // Monotone cubic interpolation: gentle rounded corners without invented extrema.
  function curvePath(points){
    if(!points.length)return '';
    let result=`M ${points[0].x.toFixed(3)} ${points[0].y.toFixed(3)}`;
    if(points.length===1)return result;
    const slopes=[];
    for(let i=0;i<points.length-1;i++)slopes.push((points[i+1].y-points[i].y)/Math.max(.001,points[i+1].x-points[i].x));
    const tangents=[];
    for(let i=0;i<points.length;i++){
      if(i===0)tangents.push(slopes[0]);
      else if(i===points.length-1)tangents.push(slopes.at(-1));
      else if(slopes[i-1]*slopes[i]<=0)tangents.push(0);
      else tangents.push(2*slopes[i-1]*slopes[i]/(slopes[i-1]+slopes[i]));
    }
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],handle=(b.x-a.x)/3;
      result+=` C ${(a.x+handle).toFixed(3)} ${(a.y+tangents[i]*handle).toFixed(3)} ${(b.x-handle).toFixed(3)} ${(b.y-tangents[i+1]*handle).toFixed(3)} ${b.x.toFixed(3)} ${b.y.toFixed(3)}`;
    }
    return result;
  }
  function fmt(n){return (Math.abs(n)<1e-8?0:n).toFixed(1)+'%';}
  const cache=new WeakMap();
  function draw({svg,tooltip,rows=[],mode='journal',open=()=>{}}){
    if(!svg||!tooltip)return;
    const {closed,values,total}=cumulative(rows),n=closed.length;
    const ranges=rangeFor(values);
    const {ymin,ymax,step}=ranges;
    const y=v=>B-(v-ymin)/(ymax-ymin)*(B-T);
    const x=i=>L+(n?i/n:0)*(W-L-R);
    const points=values.map((v,i)=>({x:x(i),y:y(v)}));
    const finalPath=curvePath(points);
    const svgId=(svg.id||'curve').replace(/[^a-z0-9_-]/gi,'');
    const gid='fade_'+svgId;
    const countStep=Math.max(1,Math.ceil(n/12));
    const xTicks=[];
    for(let i=0;i<=n;i+=countStep)xTicks.push(i);
    if(n&&!xTicks.includes(n))xTicks.push(n);
    const yTicks=[];
    for(let v=Math.ceil(ymin/step)*step;v<=ymax+step*.01;v+=step){
      const vv=Math.abs(v)<step/10?0:v;
      yTicks.push(`<text x="${L-13}" y="${(y(vv)+4).toFixed(2)}" class="chart-axis" text-anchor="end">${fmt(vv)}</text>`);
    }
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio','xMidYMid meet');
    const area=d=>`${d} L ${x(n).toFixed(2)} ${B} L ${L} ${B} Z`;
    svg.innerHTML=`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--curve-line)" stop-opacity=".20"/><stop offset="100%" stop-color="var(--curve-line)" stop-opacity="0"/></linearGradient></defs>
      ${yTicks.join('')}
      <line x1="${L}" x2="${W-R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--curve-zero)" stroke-width="1"/>
      ${xTicks.map(v=>`<text x="${x(v)}" y="${B+24}" text-anchor="middle" class="chart-axis">${v}</text>`).join('')}
      ${n?`<path data-curve-fill d="${area(finalPath)}" fill="url(#${gid})"/><path data-curve-line d="${finalPath}" fill="none" stroke="var(--curve-line)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`:
        '<text x="470" y="190" text-anchor="middle" class="chart-empty">Нет закрытых сделок с известным результатом в процентах</text>'}
      <line data-hover-line x1="0" x2="0" y1="${T}" y2="${B}" stroke="var(--chart-crosshair)" stroke-width="1" visibility="hidden" pointer-events="none"/>
      <circle data-hover-dot cx="0" cy="0" r="4.5" stroke="var(--panel)" stroke-width="2" fill="var(--curve-line)" visibility="hidden" pointer-events="none"/>`;
    tooltip.hidden=true;
    const prior=cache.get(svg);
    if(prior?.frame&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(prior.frame);
    const state={values:values.slice(),frame:null};cache.set(svg,state);
    const stroke=svg.querySelector('[data-curve-line]'),fill=svg.querySelector('[data-curve-fill]');
    // Visual interpolation for period changes; data and tooltip always use final exact results.
    if(n&&stroke&&prior?.values&&typeof requestAnimationFrame==='function'&&
       (prior.values.length!==values.length||values.some((v,i)=>v!==prior.values[i]))&&
       !(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)){
      const old=prior.values;
      const sample=t=>{const f=clamp(t,0,1)*(old.length-1),i=Math.floor(f),j=Math.min(i+1,old.length-1);return old[i]*(1-(f-i))+old[j]*(f-i)};
      const start=performance.now(),duration=420;
      const stepFrame=now=>{
        if(!svg.isConnected||cache.get(svg)!==state)return;
        const f=clamp((now-start)/duration,0,1),e=f*f*(3-2*f);
        const d=curvePath(points.map((p,i)=>({x:p.x,y:y(sample(i/Math.max(n,1))*(1-e)+values[i]*e)})));
        stroke.setAttribute('d',d);fill.setAttribute('d',area(d));
        if(f<1)state.frame=requestAnimationFrame(stepFrame);
        else {stroke.setAttribute('d',finalPath);fill.setAttribute('d',area(finalPath));}
      };
      state.frame=requestAnimationFrame(stepFrame);
    }
    const hoverLine=svg.querySelector('[data-hover-line]'),dot=svg.querySelector('[data-hover-dot]');
    const hide=()=>{hoverLine?.setAttribute('visibility','hidden');dot?.setAttribute('visibility','hidden');tooltip.hidden=true;};
    const locate=evt=>{
      if(!n||!svg.getScreenCTM())return null;
      const p=svg.createSVGPoint();p.x=evt.clientX;p.y=evt.clientY;
      const point=p.matrixTransform(svg.getScreenCTM().inverse());
      if(point.x<L-8||point.x>W-R+8||point.y<T-15||point.y>B+22)return null;
      const index=clamp(Math.round((point.x-L)/(W-L-R)*n),1,n);
      return {index,trade:closed[index-1],px:x(index),py:y(values[index])};
    };
    svg.onpointerleave=hide;
    svg.onpointermove=evt=>{
      const hit=locate(evt);if(!hit){hide();return;}
      dot.setAttribute('cx',hit.px);dot.setAttribute('cy',hit.py);dot.setAttribute('visibility','visible');
      hoverLine.setAttribute('x1',hit.px);hoverLine.setAttribute('x2',hit.px);hoverLine.setAttribute('visibility','visible');
      const val=numeric(hit.trade.gain_pct),cumulativeVal=values[hit.index];
      tooltip.innerHTML=`<span>Сделка №${hit.trade.displayNumber||hit.index}</span><strong class="${val<0?'red':'green'}">${val>=0?'+':''}${val.toFixed(2)}%</strong><small>Итого ${cumulativeVal>=0?'+':''}${cumulativeVal.toFixed(2)}% · Открыть →</small>`;
      tooltip.hidden=false;
      const visual=svg.createSVGPoint();visual.x=hit.px;visual.y=hit.py;
      const screen=visual.matrixTransform(svg.getScreenCTM());
      const box=svg.closest('.interactive-chart').getBoundingClientRect();
      tooltip.style.left=clamp(screen.x-box.left+16,8,Math.max(8,box.width-190))+'px';
      tooltip.style.top=clamp(screen.y-box.top-47,8,Math.max(8,box.height-104))+'px';
      tooltip.onclick=e=>{e.stopPropagation();open(hit.trade);};
    };
    svg.onclick=e=>{const hit=locate(e);if(hit)open(hit.trade)};
    return {count:n,total,values,range:ranges};
  }
  return {draw,cumulative,curvePath,rangeFor};
});
