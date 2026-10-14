/* Deterministic ordered image collections. No image pixel data is modified. */
'use strict';
const TYPES=Object.freeze(['trade-captures','backtest-captures','trade-results','backtest-results','weekly-asset']);
function validKeys(keys){return Array.isArray(keys)&&keys.length<=2000&&keys.every(x=>typeof x==='string'&&/^(?:legacy:[A-Za-z0-9._-]{1,16}|(?:extra:|id:)\d{1,16})$/.test(x))&&new Set(keys).size===keys.length;}
function sameImageSet(input,known){return validKeys(input)&&input.length===known.length&&input.every(x=>known.includes(x));}
function mergeSavedOrder(live,saved){
  const set=new Set(live);const ordered=[];
  for(const key of saved)if(set.has(key)&&!ordered.includes(key))ordered.push(key);
  for(const key of live)if(!ordered.includes(key))ordered.push(key);
  return ordered;
}
function moveKey(keys,from,to){const source=keys.indexOf(from),target=keys.indexOf(to);if(source<0||target<0)return [...keys];const next=[...keys];next.splice(source,1);next.splice(target,0,from);return next;}
module.exports={TYPES,validKeys,sameImageSet,mergeSavedOrder,moveKey};
