const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(f)=>fs.readFileSync(path.join(root,f),'utf8');
test('Public app is isolated from Personal Edition and has no hardcoded FTMO account',()=>{
 const pkg=JSON.parse(read('package.json'));
 const main=read('src/main.js');
 assert.equal(pkg.build.appId,'com.shelld.statistics.publicbeta');
 assert.equal(pkg.build.productName,'Shelld Statistics Public Beta');
 assert.match(main,/\['Мой счёт','Manual','','','','',0,'EUR'\]/);
 for(const secret of ['531411020','FTMO-Server3','C:\\\\Users\\\\SHELLD'])assert.ok(!main.includes(secret),'Sensitive preset found');
 assert.equal(fs.existsSync(path.join(root,'FTMO_PRESET.txt')),false);
 assert.equal(fs.existsSync(path.join(root,'PRIVATE_BUILD_NOTICE.txt')),false);
});
test('Only the GER40 pill is blue, including light theme',()=>{
 const css=read('src/styles.css');
 assert.match(css,/\.pill\.GER40\{background:#142f70/);
 assert.match(css,/:root\.light \.pill\.GER40\{background:#dceaff/);
 assert.match(css,/\.pill\.GER40,\.pill\.US100,\.pill\.NAS100/);
});
