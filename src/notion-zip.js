/* Safe, dependency-free reader for Notion's Markdown & CSV ZIP exports.
 * Reads CSV in memory. Never extracts paths or executes files from the archive.
 */
'use strict';
const zlib=require('node:zlib');
const {TextDecoder}=require('node:util');
const crypto=require('node:crypto');
const {analyzeNotionCSV,signedNumber}=require('./import-utils');
// ZIP exports may contain original screenshots as well as two duplicate CSV views.
// Enforce strict limits before inflating anything; never extract a ZIP member to disk.
const MAX_ARCHIVE_BYTES=220*1024*1024;
const MAX_CSV_BYTES=8*1024*1024;
const MAX_MARKDOWN_BYTES=3*1024*1024;
const MAX_IMAGE_BYTES=16*1024*1024;
const MAX_TOTAL_BYTES=320*1024*1024;
const MAX_FILES=1200;
function utf8(buffer){try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new Error('ZIP содержит текст с некорректной кодировкой UTF-8');}}
function crc32(bytes){
 let v=0xffffffff;
 for(const byte of bytes){v^=byte;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0);}
 return (v^0xffffffff)>>>0;
}
function safeRelativeName(name){
 const raw=String(name||'').replace(/\\/g,'/');
 let decoded=raw;
 try{decoded=decodeURIComponent(raw);}catch{} // Notion sometimes emits literal % in filenames.
 if(!decoded||decoded.startsWith('/')||decoded.includes('\0')||/^[A-Za-z]:/.test(decoded)||
   decoded.split('/').some(segment=>segment==='..'||segment==='.')||decoded.includes('\\'))
   throw new Error('ZIP содержит небезопасный путь к вложению');
 return decoded.replace(/\/+$/, '');
}
function imageMime(filename,bytes){
 const lower=String(filename).toLowerCase();
 if(lower.endsWith('.png')&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(/\.jpe?g$/.test(lower)&&bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 if(lower.endsWith('.webp')&&bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return null;
}
function notionZipContents(input,{media=true}={}){
 const data=Buffer.isBuffer(input)?input:Buffer.from(input||[]);
 if(data.length>MAX_ARCHIVE_BYTES)throw new Error('ZIP слишком большой (максимум 220 МБ)');
 if(data.length<22)throw new Error('ZIP повреждён или пуст');
 let eocd=-1;
 for(let i=data.length-22;i>=Math.max(0,data.length-22-65535);i--){
   if(data.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 }
 if(eocd<0)throw new Error('Не найден список файлов ZIP');
 const count=data.readUInt16LE(eocd+10),centralLength=data.readUInt32LE(eocd+12),centralOffset=data.readUInt32LE(eocd+16);
 if(count>MAX_FILES||count===0)throw new Error('ZIP содержит слишком много файлов или пуст');
 if(count===65535||centralOffset===0xffffffff||centralLength===0xffffffff)throw new Error('ZIP64 пока не поддерживается; выгрузи обычный ZIP из Notion');
 if(centralOffset+centralLength>eocd)throw new Error('Повреждён центральный каталог ZIP');
 let cursor=centralOffset,totalBytes=0;
 const csvs=[],images=[],markdown=[];
 const seenPaths=new Set();
 for(let i=0;i<count;i++){
   if(cursor+46>data.length||data.readUInt32LE(cursor)!==0x02014b50)throw new Error('Повреждён список файлов ZIP');
   const flags=data.readUInt16LE(cursor+8),method=data.readUInt16LE(cursor+10),expectedCrc=data.readUInt32LE(cursor+16);
   const compressed=data.readUInt32LE(cursor+20),expanded=data.readUInt32LE(cursor+24),nameLen=data.readUInt16LE(cursor+28);
   const extraLen=data.readUInt16LE(cursor+30),commentLen=data.readUInt16LE(cursor+32),localOffset=data.readUInt32LE(cursor+42);
   if(cursor+46+nameLen+extraLen+commentLen>data.length)throw new Error('Неверная длина имени файла в ZIP');
   const name=safeRelativeName(utf8(data.subarray(cursor+46,cursor+46+nameLen)));
   cursor+=46+nameLen+extraLen+commentLen;
   if(!name||name.endsWith('/'))continue;
   const key=name.toLowerCase();
   if(seenPaths.has(key))throw new Error('ZIP содержит несколько файлов с одинаковым путём');
   seenPaths.add(key);
   const csv=/\.csv$/i.test(name),md=media&&/\.md$/i.test(name),image=media&&/\.(?:png|jpe?g|webp)$/i.test(name);
   if(!csv&&!md&&!image)continue;
   if(flags&1)throw new Error('ZIP содержит зашифрованные вложения, экспортируй без пароля');
   if(method!==0&&method!==8)throw new Error('ZIP имеет неподдерживаемый способ сжатия');
   const max=csv?MAX_CSV_BYTES:md?MAX_MARKDOWN_BYTES:MAX_IMAGE_BYTES;
   if(expanded>max||compressed>MAX_ARCHIVE_BYTES||totalBytes+expanded>MAX_TOTAL_BYTES)
      throw new Error('Вложения Notion слишком большие для безопасного импорта (до 16 МБ на скриншот)');
   if(localOffset+30>data.length||data.readUInt32LE(localOffset)!==0x04034b50)throw new Error('Некорректный файл в ZIP');
   const localName=data.readUInt16LE(localOffset+26),localExtra=data.readUInt16LE(localOffset+28);
   const start=localOffset+30+localName+localExtra;
   if(start+compressed>data.length)throw new Error('Обрезанные данные ZIP');
   const blob=data.subarray(start,start+compressed);
   let contents;
   try{contents=method===0?blob:zlib.inflateRawSync(blob,{maxOutputLength:max+1});}
   catch(error){throw new Error(`Не удалось распаковать «${name}»: ${error.message}`);}
   if(contents.length!==expanded||crc32(contents)!==expectedCrc)throw new Error(`Не прошла проверка целостности «${name}»`);
   totalBytes+=expanded;
   if(csv)csvs.push({filename:name,text:utf8(contents).replace(/^\uFEFF/,'')});
   if(md)markdown.push({filename:name,text:utf8(contents)});
   if(image){
     const mime=imageMime(name,contents);
     if(mime)images.push({filename:name,mime,bytes:Buffer.from(contents)});
     // Unsupported/renamed pictures remain unlinked; never guess the binary format.
   }
 }
 if(!csvs.length)throw new Error('В ZIP не найдены CSV-таблицы');
 return {csvs,images,markdown};
}
function notionZipCSVs(input){return notionZipContents(input,{media:false}).csvs;}
function normalizeTitle(raw){
 return String(raw||'').normalize('NFKC').toLowerCase()
  .replace(/(?:\s+[a-f\d]{32})(?=\.(?:md|csv)$|$)/i,'')
  .replace(/\.md$/i,'').replace(/[^a-zа-яё\d]+/gi,' ').replace(/\s+/g,' ').trim();
}
function rawIds(row){
 const vals=Object.entries(row).filter(([k])=>/^(?:id|page id|notion id|url|link|name|title|заголовок)$/i.test(k.trim()));
 const ids=new Set();
 for(const [,v] of vals){
   const matches=String(v||'').match(/\b[a-f0-9]{32}\b|\b[a-f0-9]{8}-[a-f0-9-]{27,}\b/gi)||[];
   for(const id of matches)ids.add(id.toLowerCase().replace(/-/g,''));
 }
 return ids;
}
function markdownReferencedPaths(md){
 // Notion Markdown exports keep local attachments in relative markdown links.
 const urls=[];
 for(const m of md.text.matchAll(/!?\[[^\]\r\n]*\]\(([^)]+)\)/g)){
   const raw=m[1].replace(/\s+\"[^\"]*\"$/,'').replace(/^<|>$/g,'').trim();
   if(!/\.(?:png|jpe?g|webp)(?:[?#].*)?$/i.test(raw)||/^https?:\/\//i.test(raw))continue;
   try{
     const parts=[...md.filename.split('/').slice(0,-1),...decodeURIComponent(raw).split('/')];
     const out=[];
     for(const part of parts){if(part==='..')out.pop();else if(part&&part!=='.')out.push(part);}
     urls.push(out.join('/'));
   }catch{}
 }
 return urls;
}
// Notion sometimes exports all database pages as "Untitled <short-id>".
// A title or the row order is not evidence that a screenshot belongs to a trade.
function canonicalValue(value){return String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');}
function csvField(row,aliases){
 for(const [k,v] of Object.entries(row||{}))if(aliases.includes(canonicalValue(k)))return String(v??'').trim();
 return '';
}
function pageProperties(markdown){
 const result={};
 // Notion page properties commonly precede the page content, either as
 // "Number: 4", "- **Number:** 4" or "| Number | 4 |".
 for(const line of String(markdown||'').split(/\r?\n/).slice(0,90)){
  const text=line.trim();
  let pair=/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|?\s*$/.exec(text);
  if(!pair){
    const plain=text.replace(/\*\*/g,'').replace(/^(?:[-*]\s+)/,'');
    pair=/^([\w\s№#-]{1,35}?)\s*:\s*(.*)$/.exec(plain);
  }
  if(!pair)continue;
  const key=canonicalValue(pair[1].replace(/\*/g,''));
  if(['number','№','#','trade #','opened','date','ticker','asset','direct','direction','rr','result'].includes(key)){
    const val=String(pair[2]??'').replace(/\*\*/g,'').replace(/\|\s*$/,'').trim();
    if(val&&val!=='---')result[key]=val;
  }
 }
 return result;
}
function pageRowOwners(md,rows,titleMap,idMap){
 const props=pageProperties(md.text);
 const number=props.number||props['№']||props['#']||props['trade #'];
 const normNumber=value=>{
   const v=String(value??'').trim();
   return /^\d+$/.test(v)?String(Number(v)):canonicalValue(v);
 };
 const sameOptional=(row,keys,expected)=>{
   if(!expected)return true;
   const actual=csvField(row,keys);
   // A conflicting explicit property means this cannot be the owner.
   return !actual||canonicalValue(actual)===canonicalValue(expected);
 };
 if(number){
   const candidates=rows.filter(({row})=>normNumber(csvField(row,['number','№','#','trade #']))===normNumber(number)
      &&sameOptional(row,['ticker','pair','asset'],props.ticker||props.asset)
      &&sameOptional(row,['direct','direction'],props.direct||props.direction)
      &&sameOptional(row,['rr'],props.rr));
   // Never fall back to "Untitled" matching if a page has a contradictory number.
   return candidates.length===1?[candidates[0].index]:[];
 }
 const pageId=md.filename.match(/[a-f\d]{32}(?=\.md$)/i)?.[0];
 const ids=pageId?idMap.get(pageId.toLowerCase())||[]:[];
 if(ids.length===1)return ids;
 const base=md.filename.split('/').pop().replace(/\s+[a-f0-9]{32}\.md$/i,'').replace(/\.md$/i,'');
 const title=normalizeTitle(base);
 // Generic titles do not identify one row.
 if(!title||/^untitled(?:\s+[a-z0-9-]+)?$/.test(title))return [];
 const matches=titleMap.get(title)||[];
 return matches.length===1?matches:[];
}
function matchNotionImages(valid,rawRows,contents){
 const images=contents.images||[];
 const metadata={imagesInZip:images.length,matchedImages:0,unmatchedImages:0,
   unmatchedFiles:[],unmatchedPictures:[]};
 if(!images.length)return metadata;
 const rows=valid.map((trade,index)=>({trade,row:rawRows[index]||{},index}));
 const titleMap=new Map(),idMap=new Map();
 for(const {row,index} of rows){
   const title=normalizeTitle(csvField(row,['name','title','trade','название']));
   if(title){const entries=titleMap.get(title)||[];entries.push(index);titleMap.set(title,entries);}
   for(const id of rawIds(row)){const entries=idMap.get(id)||[];entries.push(index);idMap.set(id,entries);}
 }
 const byName=new Map(images.map(im=>[im.filename.toLowerCase(),im]));
 const leaf=filename=>String(filename||'').split('/').pop().toLowerCase();
 const counts=new Map();for(const image of images)counts.set(leaf(image.filename),(counts.get(leaf(image.filename))||0)+1);
 // Evidence is not counted by "votes": two equally strong contradictory claims
 // mean "unmatched", not attachment to an arbitrary row.
 const claims=new Map();
 function claim(owner,filename,priority){
   const key=filename.toLowerCase();
   const old=claims.get(key);
   if(!old||priority>old.priority)claims.set(key,{priority,owners:new Set([owner])});
   else if(priority===old.priority)old.owners.add(owner);
 }
 for(const img of images){
   const needle=img.filename.toLowerCase(),base=leaf(needle);
   for(const {row,index} of rows){
     const raw=Object.values(row).map(v=>String(v??'')).join('\n').toLowerCase();
     let decoded=raw;try{decoded=decodeURIComponent(raw);}catch{}
     if(decoded.includes(needle)||raw.includes(encodeURI(needle).toLowerCase()))claim(index,img.filename,5);
     else if(counts.get(base)===1&&new RegExp('(?:^|[^a-z0-9])'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])').test(decoded))
       claim(index,img.filename,4);
   }
   for(const match of needle.matchAll(/[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9-]{27,}/g)){
     const owners=idMap.get(match[0].replace(/-/g,''));
     if(owners?.length===1)claim(owners[0],img.filename,5);
   }
 }
 for(const md of contents.markdown||[]){
   const owners=pageRowOwners(md,rows,titleMap,idMap);
   if(owners.length!==1)continue;
   const owner=owners[0];
   for(const filepath of markdownReferencedPaths(md)){
     const img=byName.get(filepath.toLowerCase());
     if(img)claim(owner,img.filename,5);
   }
   // Images and screenshots often live in an identically-named sibling
   // directory even when there are no explicit ![]() links in the Markdown.
   const sibling=md.filename.replace(/\.md$/i,'/').toLowerCase();
   for(const img of images)if(img.filename.toLowerCase().startsWith(sibling))claim(owner,img.filename,5);
 }
 for(const img of images){
   const found=claims.get(img.filename.toLowerCase());
   if(found?.owners.size===1){
     const index=[...found.owners][0];
     const target=rows[index].trade.notionImages||(rows[index].trade.notionImages=[]);
     target.push(img);metadata.matchedImages++;
   }else{
     metadata.unmatchedImages++;
     metadata.unmatchedFiles.push(img.filename);
     metadata.unmatchedPictures.push(img);
   }
 }
 return metadata;
}
function assignNotionImages(analysis,assignments){
 if(!analysis||!Array.isArray(analysis.valid))throw new Error('Нет подготовленного импорта');
 if(!Array.isArray(assignments)||assignments.length>analysis.unmatchedImages)
   throw new Error('Неверное количество ручных привязок');
 const unmatched=new Map((analysis.unmatchedPictures||[]).map(pic=>[pic.filename,pic]));
 const owners=new Map(analysis.valid.map(trade=>[trade.external_key,trade]));
 const seen=new Set(),staged=[];
 for(const item of assignments){
   const filename=String(item?.filename||''),key=String(item?.key||'');
   const image=unmatched.get(filename),trade=owners.get(key);
   if(!image||!trade||seen.has(filename))throw new Error('Недопустимая ручная привязка фотографии');
   seen.add(filename);staged.push({image,trade});
 }
 // Apply only after validating every assignment: a failed batch is a no-op.
 for(const {image,trade} of staged){
   const attached=trade.notionImages||(trade.notionImages=[]);
   if(!attached.some(old=>old.filename===image.filename))attached.push(image);
 }
 return staged.length;
}
function sourceTableId(filename){
 const base=String(filename||'').split(/[\\/]/).pop().replace(/_all(?=\.csv$)/i,'');
 const uid=(base.match(/\b([a-f0-9]{32})\b/i)||[])[1];
 return uid?uid.toLowerCase():base.replace(/\.csv$/i,'').trim().toLowerCase();
}
function canonicalKey(row,filename,accountId,index){
 const norm=s=>String(s??'').trim().toLowerCase().replace(/\s+/g,' ');
 const nameMap={};
 for(const [key,v] of Object.entries(row))nameMap[key.toLowerCase()]=norm(v);
 const n=nameMap.number||nameMap['№']||nameMap['#']||nameMap.trade||'';
 const source=sourceTableId(filename);
 const identity=n?`number:${n}`:JSON.stringify({date:nameMap.opened||nameMap.date||'',ticker:nameMap.ticker||nameMap.pair||'',direct:nameMap.direct||nameMap.direction||'',rr:nameMap.rr||'',result:nameMap.result||'',model:nameMap.model||'',index});
 return 'NOTION:'+accountId+':'+crypto.createHash('sha256').update(source+'|'+identity).digest('hex');
}
function validateRisk(risk){if(risk===null||risk===undefined||risk==='')return;const n=signedNumber(risk);if(n===null||n<=0||n>100)throw new Error('Неверный риск в процентах — укажи число больше 0 и не больше 100');}
function analyzeNotionExportCsv(text,accountId,{riskPct=null,filename='Notion.csv'}={}){
 validateRisk(riskPct);
 const analyzed=analyzeNotionCSV(text,accountId,{riskPct});
 const {parseCSV}=require('./import-utils');
 const rows=parseCSV(text).rows;
 const unique=new Set();let duplicates=0;
 analyzed.valid=analyzed.valid.filter((record,i)=>{
   const external_key=canonicalKey(rows[i],filename,accountId,i);
   if(unique.has(external_key)){duplicates++;return false;}
   unique.add(external_key);record.external_key=external_key;return true;
 });
 analyzed.duplicateRows=duplicates;
 analyzed.files=[filename];
 analyzed.total=analyzed.valid.length;
 analyzed.incomplete=analyzed.valid.filter(t=>t.missing?.length).length;
 return analyzed;
}
function analyzeNotionExportZip(bytes,accountId,{riskPct=null}={}){
 validateRisk(riskPct);
 const contents=notionZipContents(bytes);
 const files=contents.csvs.sort((a,b)=>Number(/_all\.csv$/i.test(b.filename))-Number(/_all\.csv$/i.test(a.filename)));
 const valids=[],rawRows=[],invalid=[],seen=new Map();
 let duplicateRows=0,ignoredFiles=0;
 for(const file of files){
  let analyzed;
  try{analyzed=analyzeNotionCSV(file.text,accountId,{riskPct});}
  catch(err){ignoredFiles++;invalid.push({filename:file.filename,reason:err.message});continue;}
  const col=analyzed.columns.map(c=>c.toLowerCase());
  const score=['number','opened','date','direct','direction','ticker','pair','result','rr'].filter(k=>col.includes(k)).length;
  if(score<2){ignoredFiles++;continue;}
  const {parseCSV}=require('./import-utils');
  const raw=parseCSV(file.text).rows;
  analyzed.valid.forEach((entry,index)=>{
   const external_key=canonicalKey(raw[index],file.filename,accountId,index);
   if(seen.has(external_key)){
     duplicateRows++;
     // The duplicate CSV view may be the one that contains attachment URLs.
     const saved=rawRows[seen.get(external_key)];
     for(const [key,val] of Object.entries(raw[index]))if(!saved[key]&&val)saved[key]=val;
     return;
   }
   seen.set(external_key,valids.length);
   valids.push({...entry,external_key});rawRows.push({...raw[index]});
  });
 }
 if(!valids.length)throw new Error('В ZIP не обнаружено таблиц торговых сделок');
 const media=matchNotionImages(valids,rawRows,contents);
 const previewTrades=valids.map((trade,index)=>({key:trade.external_key,number:csvField(rawRows[index],['number','№','#','trade #']),opened_at:trade.opened_at,asset:trade.asset,direction:trade.direction,rr:trade.r_known?trade.r_multiple:null}));
 return {previewTrades,valid:valids,total:valids.length,duplicateRows,invalid,ignoredFiles,
   files:files.map(x=>x.filename),incomplete:valids.filter(x=>x.missing?.length).length,...media};
}
module.exports={notionZipCSVs,notionZipContents,analyzeNotionExportZip,analyzeNotionExportCsv,sourceTableId,canonicalKey,matchNotionImages,assignNotionImages,pageProperties};
