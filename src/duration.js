/* Shared duration formatter for live Trading Journal and Backtests.
 * Works entirely in the UI: stored dates and imported trades remain untouched.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  root.ShelldDuration=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function formatMinutes(value){
    if(!Number.isFinite(value)||value<0)return 'Дата?';
    const minutes=Math.floor(value);
    const days=Math.floor(minutes/1440);
    const hours=Math.floor((minutes%1440)/60);
    const mins=minutes%60;
    const parts=[];
    if(days)parts.push(`${days}д`);
    if(hours)parts.push(`${hours}ч`);
    if(mins||parts.length===0)parts.push(`${mins}м`);
    return parts.join(' ');
  }
  function holdingTime(opened,closed){
    if(!opened||!closed)return '—';
    const start=new Date(opened).getTime();
    const end=new Date(closed).getTime();
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return 'Дата?';
    return formatMinutes(Math.floor((end-start)/60000));
  }
  return {formatMinutes,holdingTime};
});
