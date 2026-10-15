const { app, BrowserWindow, ipcMain, dialog, screen, Menu, safeStorage, clipboard, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { percentFromCapital } = require('./mt5-profit');
const { newLocks, mt5Patch } = require('./mt5-merge');
const { spawn } = require('node:child_process');
const { selectMt5Bridge } = require('./mt5-runtime');
const initSqlJs = require('sql.js');
const {deletionSteps}=require('./account-removal');
const backupPolicy=require('./backup-policy');
const imageOrder=require('./image-order');
const {positiveCapital,analyzeNotionCSV}=require('./import-utils');
const {analyzeNotionExportZip,analyzeNotionExportCsv,assignNotionImages}=require('./notion-zip');
const {groupNotionBacktests}=require('./backtest-notion');
let pendingBacktestNotion=null;
const {emptyDuplicateIds}=require('./account-duplicates');
let pendingNotion=null;

// Public Beta uses its own Electron userData folder through the distinct productName.
// Do not load private profile presets or read data from the Personal Edition.

let SQL, db, dbPath;
let mt5Config = null;
let mt5Timer = null;
let mt5Busy = false;
let mt5Child = null;
let mt5Last = {connected:false, syncing:false, imported:0, updated:0, skipped:0, at:null, error:null};
function persist() {
  if (!db) return;
  const bytes = db.export();
  fs.writeFileSync(dbPath + '.tmp', Buffer.from(bytes));
  fs.renameSync(dbPath + '.tmp', dbPath);
}
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally { stmt.free(); }
}
function exec(sql, params = []) {
  db.run(sql, params);
  persist();
}
async function initDb() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, 'shelld-statistics.sqlite');
  const wasmPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    : path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  SQL = await initSqlJs({ locateFile: () => wasmPath });
  if (fs.existsSync(dbPath)) {
    const profileSnapshot=path.join(dir,'shelld-before-v070-accounts.sqlite');
    if(!fs.existsSync(profileSnapshot)) fs.copyFileSync(dbPath,profileSnapshot);
    const safetyPath=path.join(dir,'shelld-before-v05.sqlite');
    if(!fs.existsSync(safetyPath))fs.copyFileSync(dbPath,safetyPath);
    const migrationBackup=path.join(dir,'shelld-before-v061.sqlite');
    if(!fs.existsSync(migrationBackup))fs.copyFileSync(dbPath,migrationBackup);
    try { db = new SQL.Database(new Uint8Array(fs.readFileSync(dbPath))); }
    catch (err) { throw new Error(`Не удалось прочитать базу данных: ${err.message}. Исходный файл сохранён: ${dbPath}`); }
  } else db = new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opened_at TEXT NOT NULL, closed_at TEXT, asset TEXT NOT NULL,
      direction TEXT NOT NULL, model TEXT DEFAULT '', result TEXT NOT NULL DEFAULT 'OPEN',
      gain_pct REAL NOT NULL DEFAULT 0, r_multiple REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, asset TEXT DEFAULT '',
      risk_pct REAL DEFAULT 1, rules TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS trade_screenshots (
      trade_id INTEGER NOT NULL, timeframe TEXT NOT NULL, mime TEXT NOT NULL,
      image BLOB NOT NULL, PRIMARY KEY (trade_id, timeframe)
    );
    CREATE TABLE IF NOT EXISTS weekly_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, week_start TEXT NOT NULL,
      title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS weekly_plan_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL,
      asset TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      UNIQUE(plan_id, asset)
    );
    CREATE TABLE IF NOT EXISTS plan_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL,
      asset_id INTEGER, mime TEXT NOT NULL, image BLOB NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS backtests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT 'Swing', asset TEXT NOT NULL,
      year INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS backtest_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, backtest_id INTEGER NOT NULL,
      opened_at TEXT NOT NULL DEFAULT '', closed_at TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'LONG', model TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT 'OPEN', rr REAL NOT NULL DEFAULT 0,
      risk_pct REAL NOT NULL DEFAULT 1,
      gain_pct REAL NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS backtest_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT, backtest_trade_id INTEGER NOT NULL, timeframe TEXT NOT NULL DEFAULT '4H',
      mime TEXT NOT NULL, image BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  applyMigrations();
  migrateAccounts();
  db.run(`CREATE TABLE IF NOT EXISTS account_groups(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS account_group_members(group_id INTEGER NOT NULL,account_id INTEGER NOT NULL,PRIMARY KEY(group_id,account_id));`);
  const archiveCols=run('PRAGMA table_info(accounts)').map(c=>c.name);
  if(!archiveCols.includes('archived_at'))db.run('ALTER TABLE accounts ADD COLUMN archived_at TEXT');
  // No automatic reset in this maintenance release; preserve all user data.
  persist();
}
function applyMigrations() {
  // v0.8.3 result galleries: account scoped, with a separate album per trade
  // or one shared report album. Original PNG/JPEG/WEBP bytes remain in SQLite.
  db.run(`CREATE TABLE IF NOT EXISTS studio_result_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('summary','trade')),
    trade_id INTEGER,
    mime TEXT NOT NULL,
    image BLOB NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS ix_studio_result_images_owner
    ON studio_result_images(account_id,scope,trade_id,id)`);

  // Independent unlimited result albums for the journal editor and backtest analysis.
  // This migration is additive: previous screenshot galleries, notes and MT5 records stay intact.
  db.run(`CREATE TABLE IF NOT EXISTS trade_result_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT, trade_id INTEGER NOT NULL,
    mime TEXT NOT NULL, image BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS ix_trade_result_images_trade ON trade_result_images(trade_id,id);
  CREATE TABLE IF NOT EXISTS backtest_result_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT, backtest_trade_id INTEGER NOT NULL,
    mime TEXT NOT NULL, image BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS ix_backtest_result_images_trade ON backtest_result_images(backtest_trade_id,id);`);
  db.run(`CREATE TABLE IF NOT EXISTS image_orders (kind TEXT NOT NULL, owner_id INTEGER NOT NULL, image_key TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(kind,owner_id,image_key));`);
  db.run(`CREATE TABLE IF NOT EXISTS trade_extra_screenshots (id INTEGER PRIMARY KEY AUTOINCREMENT,trade_id INTEGER NOT NULL,timeframe TEXT NOT NULL DEFAULT '4H',mime TEXT NOT NULL,image BLOB NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const extraCols=run('PRAGMA table_info(trade_extra_screenshots)').map(c=>c.name);
  if(!extraCols.includes('timeframe'))db.run("ALTER TABLE trade_extra_screenshots ADD COLUMN timeframe TEXT NOT NULL DEFAULT '4H'");
  db.run(`CREATE TABLE IF NOT EXISTS trade_screenshots (
    trade_id INTEGER NOT NULL, timeframe TEXT NOT NULL, mime TEXT NOT NULL,
    image BLOB NOT NULL, PRIMARY KEY (trade_id, timeframe))`);
  const cols = run('PRAGMA table_info(trades)').map(c => c.name);
  if (!cols.includes('trade_type')) db.run("ALTER TABLE trades ADD COLUMN trade_type TEXT NOT NULL DEFAULT 'Swing'");
  if (!cols.includes('plan_id')) db.run('ALTER TABLE trades ADD COLUMN plan_id INTEGER');
  if (!cols.includes('plan_asset_id')) db.run('ALTER TABLE trades ADD COLUMN plan_asset_id INTEGER');
  // Backups created with earlier versions can be restored safely.
  db.run(`CREATE TABLE IF NOT EXISTS weekly_plans (id INTEGER PRIMARY KEY AUTOINCREMENT,week_start TEXT NOT NULL,title TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS weekly_plan_assets (id INTEGER PRIMARY KEY AUTOINCREMENT,plan_id INTEGER NOT NULL,asset TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',UNIQUE(plan_id,asset));
    CREATE TABLE IF NOT EXISTS plan_images (id INTEGER PRIMARY KEY AUTOINCREMENT,plan_id INTEGER NOT NULL,asset_id INTEGER,mime TEXT NOT NULL,image BLOB NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS backtests (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,style TEXT NOT NULL DEFAULT 'Swing',asset TEXT NOT NULL,year INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS backtest_trades (id INTEGER PRIMARY KEY AUTOINCREMENT,backtest_id INTEGER NOT NULL,opened_at TEXT NOT NULL DEFAULT '',closed_at TEXT NOT NULL DEFAULT '',direction TEXT NOT NULL DEFAULT 'LONG',model TEXT NOT NULL DEFAULT '',result TEXT NOT NULL DEFAULT 'OPEN',rr REAL NOT NULL DEFAULT 0,risk_pct REAL NOT NULL DEFAULT 1,gain_pct REAL NOT NULL DEFAULT 0,tags TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS backtest_images (id INTEGER PRIMARY KEY AUTOINCREMENT,backtest_trade_id INTEGER NOT NULL,mime TEXT NOT NULL,image BLOB NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const btCols=run('PRAGMA table_info(backtest_trades)').map(c=>c.name);
  if(!btCols.includes('risk_pct'))db.run('ALTER TABLE backtest_trades ADD COLUMN risk_pct REAL NOT NULL DEFAULT 1');
  // Imported Backtests carry stable keys so re-importing a Notion ZIP cannot duplicate rows.
  const projectCols=run('PRAGMA table_info(backtests)').map(c=>c.name);
  if(!projectCols.includes('import_collection_key'))db.run('ALTER TABLE backtests ADD COLUMN import_collection_key TEXT');
  if(!btCols.includes('source_key'))db.run('ALTER TABLE backtest_trades ADD COLUMN source_key TEXT');
  if(!btCols.includes('r_known'))db.run('ALTER TABLE backtest_trades ADD COLUMN r_known INTEGER NOT NULL DEFAULT 1');
  if(!btCols.includes('percent_known'))db.run('ALTER TABLE backtest_trades ADD COLUMN percent_known INTEGER NOT NULL DEFAULT 1');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS ux_backtest_source ON backtest_trades(backtest_id,source_key) WHERE source_key IS NOT NULL');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS ux_backtest_import_collection ON backtests(account_id,import_collection_key) WHERE import_collection_key IS NOT NULL');
  // MT5 metadata: imported percentages and R may be unknown; never misrepresent these as zero.
  const tradeCols=run('PRAGMA table_info(trades)').map(c=>c.name);
  const fields=[
    ['source',"TEXT NOT NULL DEFAULT 'manual'"],
    ['external_key','TEXT'],
    ['profit_money','REAL'],
    ['profit_currency','TEXT'],
    ['percent_known','INTEGER NOT NULL DEFAULT 1'],
    ['r_known','INTEGER NOT NULL DEFAULT 1'],
    ['mt5_volume','REAL'],
    ['mt5_open_price','REAL'],
    ['mt5_close_price','REAL'],
    ['mt5_position_id','INTEGER'],
    ['percent_basis','REAL'],
    ['mt5_manual_fields',"TEXT NOT NULL DEFAULT '[]'"]
  ];
  for(const [column,type] of fields){if(!tradeCols.includes(column))db.run(`ALTER TABLE trades ADD COLUMN ${column} ${type}`);}
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS ix_trades_mt5_external_key ON trades(external_key)');
  // v0.6 created timeframe in the new-table definition but did not migrate existing databases.
  // Preserve the original BLOB bytes and existing image rows when upgrading.
  const imageColumns=run('PRAGMA table_info(backtest_images)').map(c=>c.name);
  if(!imageColumns.includes('timeframe')){
    db.run("ALTER TABLE backtest_images ADD COLUMN timeframe TEXT NOT NULL DEFAULT '4H'");
  }
}

// Each account has its own SQLite records. A new public install starts with a generic empty profile.
// Login/server/paths are user-controlled metadata. Broker passwords never enter SQLite.
function migrateAccounts(){
  db.run(`CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, broker TEXT NOT NULL DEFAULT 'Manual',
    mt5_login TEXT NOT NULL DEFAULT '', mt5_server TEXT NOT NULL DEFAULT '',
    mt5_python TEXT NOT NULL DEFAULT '', mt5_terminal TEXT NOT NULL DEFAULT '',
    mt5_basis REAL NOT NULL DEFAULT 0, mt5_days INTEGER NOT NULL DEFAULT 365,
    mt5_auto INTEGER NOT NULL DEFAULT 1, currency TEXT NOT NULL DEFAULT 'EUR',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  let defaultAccount=run('SELECT id FROM accounts ORDER BY id LIMIT 1')[0]?.id;
  if(!defaultAccount){
    // Never ship a preset account with personal broker credentials.
    // Fresh public installs use a blank manual profile.
    db.run('INSERT INTO accounts(label,broker,mt5_login,mt5_server,mt5_python,mt5_terminal,mt5_basis,currency) VALUES(?,?,?,?,?,?,?,?)',
      ['Мой счёт','Manual','','','','',0,'EUR']);
    defaultAccount=run('SELECT id FROM accounts ORDER BY id LIMIT 1')[0].id;
  }
  for(const table of ['trades','backtests','plans','weekly_plans']){
    const cols=run(`PRAGMA table_info(${table})`).map(c=>c.name);
    if(!cols.includes('account_id')) db.run(`ALTER TABLE ${table} ADD COLUMN account_id INTEGER`);
    db.run(`UPDATE ${table} SET account_id=? WHERE account_id IS NULL`,[defaultAccount]);
  }
  db.run('CREATE INDEX IF NOT EXISTS ix_trades_account_id ON trades(account_id)');
  db.run('CREATE INDEX IF NOT EXISTS ix_backtests_account_id ON backtests(account_id)');
  const selected=Number(run("SELECT value FROM settings WHERE key='active_account_id'")[0]?.value);
  if(!run('SELECT id FROM accounts WHERE id=?',[selected]).length){
    db.run("INSERT INTO settings(key,value) VALUES('active_account_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[String(defaultAccount)]);
  }
}
function activeAccountId(){
  const id=Number(run("SELECT value FROM settings WHERE key='active_account_id'")[0]?.value);
  if(!run('SELECT id FROM accounts WHERE id=?',[id]).length)throw new Error('Выбери торговый счёт');
  return id;
}
function requireCurrentTrade(id){
  const row=run('SELECT * FROM trades WHERE id=? AND account_id=?',[Number(id),activeAccountId()])[0];
  if(!row)throw new Error('Сделка отсутствует на выбранном счёте');
  return row;
}
function accountProfile(id=activeAccountId()){
  const row=run('SELECT * FROM accounts WHERE id=?',[Number(id)])[0];
  if(!row)throw new Error('Торговый счёт не найден');
  return row;
}
function secretPath(accountId){
  return path.join(app.getPath('userData'),'mt5-secret-'+String(Number(accountId))+'.bin');
}
function hasStoredSecret(id){
  return process.platform==='win32' && safeStorage.isEncryptionAvailable() && fs.existsSync(secretPath(id));
}
function storedPassword(id){
  if(!hasStoredSecret(id))return '';
  try{return safeStorage.decryptString(fs.readFileSync(secretPath(id)));}
  catch{return '';}
}
function savePassword(id,password){
  if(process.platform!=='win32'||!safeStorage.isEncryptionAvailable())throw new Error('Защищённое хранение пароля Windows сейчас недоступно');
  const file=secretPath(id);
  fs.writeFileSync(file,safeStorage.encryptString(password),{mode:0o600});
}
const checkAccountText=(value,label,max=150)=>{const v=String(value||'').trim();if(!v||v.length>max)throw new Error(`Проверь поле ${label}`);return v;};
function updateProfile(id,p){
  const before=accountProfile(id);
  const label=checkAccountText(p.label??before.label,'Название счёта');
  const broker=String(p.broker??before.broker).trim().slice(0,70)||'Manual';
  const login=String(p.mt5_login??before.mt5_login).trim().slice(0,40);
  const server=String(p.mt5_server??before.mt5_server).trim().slice(0,140);
  const rows=run("SELECT COUNT(*) AS total FROM trades WHERE account_id=? AND source='mt5'",[id])[0].total;
  if(rows>0 && ((before.mt5_login && login!==before.mt5_login) || (before.mt5_server && server!==before.mt5_server)))
    throw new Error('Для другого логина или сервера MT5 создай отдельный счёт, чтобы история не смешалась');
  const nextCurrency=String(p.currency??before.currency).trim().toUpperCase();
  if(!/^[A-Z]{3,8}$/.test(nextCurrency))throw new Error('Валюта должна содержать 3–8 латинских букв, например EUR');
  if(nextCurrency!==before.currency && run("SELECT id FROM trades WHERE account_id=? AND source='mt5' LIMIT 1",[id]).length)
    throw new Error('У счёта уже есть MT5-сделки. Для смены валюты создай отдельный счёт, чтобы не исказить проценты');
  const basis=positiveCapital(p.mt5_basis??before.mt5_basis,{allowZero:false});
  const needsReprice=basis>0 && run(`SELECT COUNT(*) AS n FROM trades
    WHERE account_id=? AND source='mt5' AND profit_money IS NOT NULL
    AND (percent_known=0 OR (percent_basis>0 AND ABS(percent_basis-?)>0.000001))
    AND instr(COALESCE(mt5_manual_fields,'[]'),'gain_pct')=0`,[id,basis])[0].n>0;
  if(needsReprice)createAutoBackup(true);
  const days=Math.min(3650,Math.max(1,Number(p.mt5_days??before.mt5_days)||365));
  db.run(`UPDATE accounts SET label=?,broker=?,mt5_login=?,mt5_server=?,mt5_python=?,mt5_terminal=?,mt5_basis=?,mt5_days=?,mt5_auto=?,currency=? WHERE id=?`,
    [label,broker,login,server,
     String(p.mt5_python??before.mt5_python).trim().slice(0,600),
     String(p.mt5_terminal??before.mt5_terminal).trim().slice(0,600),basis,days,
     p.mt5_auto===undefined?before.mt5_auto:(p.mt5_auto?1:0),
     nextCurrency,id]);
  if((before.mt5_login!==login || before.mt5_server!==server) && fs.existsSync(secretPath(id)))fs.unlinkSync(secretPath(id));
  // Reprice imported MT5 P&L after capital is supplied or corrected, even if
  // the broker has disabled the old phase login. Manual overrides stay intact.
  if(needsReprice){
    db.run(`UPDATE trades SET gain_pct=ROUND(profit_money * 100.0 / ?, 8), percent_known=1, percent_basis=?
      WHERE account_id=? AND source='mt5' AND profit_money IS NOT NULL
      AND (percent_known=0 OR (percent_basis>0 AND ABS(percent_basis-?)>0.000001))
      AND instr(COALESCE(mt5_manual_fields,'[]'),'gain_pct')=0`,[basis,basis,id,basis]);
  }
  if(mt5Config?.accountId===Number(id))mt5Config.basis=basis;
  persist();return accountProfile(id);
}

// Explicitly requested clean start in v0.6.9. A backup is created before deleting anything.
function clearTestDataOnce(dir){
  const already=run("SELECT value FROM settings WHERE key='v069_clean_slate'")[0]?.value;
  if(already==='1')return;
  if(fs.existsSync(dbPath)){
    const snapshot=path.join(dir,'shelld-before-v069-clean-slate.sqlite');
    if(!fs.existsSync(snapshot))fs.copyFileSync(dbPath,snapshot);
  }
  db.run('BEGIN TRANSACTION');
  try{
    for(const table of ['trade_screenshots','trades','plan_images','weekly_plan_assets','weekly_plans','plans','backtest_images','backtest_trades','backtests']){
      db.run('DELETE FROM '+table);
    }
    db.run("DELETE FROM sqlite_sequence WHERE name IN ('trades','plans','weekly_plans','weekly_plan_assets','plan_images','backtests','backtest_trades','backtest_images')");
    db.run("INSERT INTO settings(key,value) VALUES('v069_clean_slate','1') ON CONFLICT(key) DO UPDATE SET value='1'");
    db.run('COMMIT');
  }catch(e){try{db.run('ROLLBACK');}catch{}throw e;}
}

let lastAutoBackupError=null;
function autoBackupFolder(){return path.join(app.getPath('userData'),'auto-backups');}
function savedAutoBackups(){
  const folder=autoBackupFolder();
  if(!fs.existsSync(folder))return [];
  return fs.readdirSync(folder).filter(backupPolicy.isBackupName).sort().reverse();
}
function backupSettings(){return {
  enabled:backupPolicy.enabled(run("SELECT value FROM settings WHERE key='auto_backup_enabled'")[0]?.value),
  keep:backupPolicy.retention(run("SELECT value FROM settings WHERE key='auto_backup_keep'")[0]?.value),
  folder:autoBackupFolder(),lastError:lastAutoBackupError
};}
function createAutoBackup(force=false){
  if(!db||!dbPath)return {skipped:true,reason:'not-ready'};
  const settings=backupSettings();
  if(!force&&!settings.enabled)return {skipped:true,reason:'disabled'};
  const existing=savedAutoBackups(),date=new Date();
  if(!force&&backupPolicy.alreadyBackedUpToday(existing,date))return {skipped:true,reason:'today'};
  const folder=autoBackupFolder();fs.mkdirSync(folder,{recursive:true,mode:0o700});
  persist();
  const filename=backupPolicy.autoFilename(date);
  const destination=path.join(folder,filename);
  const temp=destination+'.tmp';
  try{
    fs.copyFileSync(dbPath,temp,fs.constants.COPYFILE_EXCL);
    const header=Buffer.alloc(16);
    const fd=fs.openSync(temp,'r');try{fs.readSync(fd,header,0,16,0);}finally{fs.closeSync(fd);}
    if(header.toString('ascii')!=='SQLite format 3\u0000'||fs.statSync(temp).size<100)
      throw new Error('Файл резервной копии повреждён');
    fs.renameSync(temp,destination);
    try{fs.chmodSync(destination,0o600);}catch{}
    for(const name of backupPolicy.retentionPlan(savedAutoBackups(),settings.keep))fs.unlinkSync(path.join(folder,name));
    lastAutoBackupError=null;
    return {skipped:false,filePath:destination};
  }catch(error){
    try{if(fs.existsSync(temp))fs.unlinkSync(temp);}catch{}
    lastAutoBackupError=error.message;
    throw error;
  }
}
function createWindow() {
  const display = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1600, display.width), height: Math.min(1000, display.height), minWidth: 980, minHeight: 680,
    backgroundColor: '#08090b',
    icon: path.join(__dirname, 'assets', 'app-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  if (display.width >= 1900 && display.height >= 1050) win.maximize();
}
app.whenReady().then(async () => {
  await initDb();
  // Keep the last validated daily snapshot in a private local folder.
  setTimeout(()=>{try{createAutoBackup(false);}catch(error){console.error('Daily backup failed:',error);}},2500);
  const backupTimer=setInterval(()=>{try{createAutoBackup(false);}catch(error){console.error('Daily backup failed:',error);}},60*60*1000);
  backupTimer.unref?.();
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('before-quit', () => { stopMt5(); try { persist(); } catch {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function mt5PublicStatus(){
  return {...mt5Last, connected:!!mt5Config, syncing:mt5Busy,
    login:mt5Config?.login??null, server:mt5Config?.server??null,
    auto:!!mt5Timer, accountId:mt5Config?.accountId??null};
}
function runBridge(config){
  return new Promise((resolve,reject)=>{
    const bridgeFile=app.isPackaged ? path.join(process.resourcesPath,'app.asar.unpacked','src','mt5_bridge.py') : path.join(__dirname,'mt5_bridge.py');
    let invocation;
    try {
      invocation=selectMt5Bridge({packaged:app.isPackaged,resourcesPath:process.resourcesPath,bridgeScript:bridgeFile,python:config.python});
    }catch(error){reject(error);return;}
    const child=spawn(invocation.executable,invocation.args,{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
    mt5Child=child;
    let stdout='', stderr='',finished=false;
    const finish=(err,value)=>{if(finished)return;finished=true;clearTimeout(timer);if(mt5Child===child)mt5Child=null;err?reject(err):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('MT5 не ответил в течение 90 секунд'))},90000);
    child.on('error',e=>finish(new Error(invocation.mode==='bundled'?'Не удалось запустить встроенный MT5-модуль. Переустанови программу. '+e.message:'Не удалось запустить указанный Python. Проверь путь. '+e.message)));
    child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8');if(stdout.length>12e6){child.kill();finish(new Error('Слишком большой ответ MT5'))}});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8').slice(0,1500)});
    child.on('close',code=>{
      if(finished)return;
      let answer;
      try{answer=JSON.parse(stdout.trim().split(/\r?\n/).at(-1))}catch{finish(new Error('Некорректный ответ MT5-модуля. Проверь запущенный терминал или переустанови программу.'));return;}
      if(!answer.ok){finish(new Error(String(answer.error||'Ошибка MT5')));return;}
      finish(null,answer.data);
    });
    child.stdin.on('error',()=>{});
    // Closed positions occasionally disappear from a date-scoped MT5 query.
    // Recheck locally OPEN position IDs against their full per-position history.
    const pending=run(`SELECT mt5_position_id,asset,external_key FROM trades
      WHERE account_id=? AND source='mt5' AND (closed_at IS NULL OR result='OPEN')
      AND mt5_position_id IS NOT NULL ORDER BY opened_at DESC LIMIT 200`,[config.accountId]);
    child.stdin.end(JSON.stringify({login:config.login,password:config.password,
      server:config.server,terminal:config.terminal,days:config.days,
      tracked_positions:pending.map(row=>({position_id:row.mt5_position_id,symbol:row.asset}))}));
  });
}
function importFromMt5(data, config){
  const account=Number(data.account_login), denom=Number(config.basis);
  const accountCurrency=String(accountProfile(config.accountId).currency||'').trim().toUpperCase();
  const brokerCurrency=String(data.currency||'').trim().toUpperCase();
  if(brokerCurrency&&accountCurrency!==brokerCurrency)
    throw new Error(`Валюта профиля (${accountCurrency}) отличается от валюты MT5 (${brokerCurrency}). Измени валюту счёта в настройках и введи капитал в ${brokerCurrency}. Импорт остановлен, чтобы не считать неверный процент.`);
  if(account!==Number(config.login))throw new Error('Данные принадлежат другому счёту');
  if(activeAccountId()!==Number(config.accountId))throw new Error('Счёт переключён во время синхронизации');
  // Compare imported money P&L (including live positions) to the configured
  // capital baseline. OPEN is unrealized and is excluded by ShelldStats.compute.
  const known=Number.isFinite(denom)&&denom>0;
  let imported=0,updated=0;
  db.run('BEGIN TRANSACTION');
  try{
    for(const t of data.trades||[]){
      if(!/^MT5:/.test(String(t.external_key||'')))continue;
      const existing=run('SELECT * FROM trades WHERE external_key=?',[t.external_key])[0];
      if(existing && Number(existing.account_id)!==Number(config.accountId))throw new Error('Обнаружена сделка другого счёта. Импорт остановлен без смешивания данных');
      if(existing && existing.model==='MT5')db.run("UPDATE trades SET model='' WHERE id=?",[existing.id]);
      const value=Number(t.profit_money)||0;
      const calculatedPercent=percentFromCapital(value, known ? denom : null);
      const priced=calculatedPercent!==null;
      // OPEN floating P&L is not included in realized performance statistics.
      const gain=priced?calculatedPercent:0;
      const serverFields={opened_at:t.opened_at,closed_at:t.closed_at,asset:t.symbol,direction:t.direction,
        result:t.result,gain_pct:gain,profit_money:value,profit_currency:t.profit_currency,
        percent_known:priced?1:0,percent_basis:priced?denom:null,mt5_volume:t.volume,
        mt5_open_price:t.open_price,mt5_close_price:t.close_price,mt5_position_id:t.position_id};
      if(existing){
        // Existing CLOSED positions are snapshots. Live positions refresh until
        // closure; manually edited fields always win over the broker feed.
        const patch=mt5Patch(existing,serverFields);
        const names=Object.keys(patch);
        if(names.length){
          db.run(`UPDATE trades SET ${names.map(k=>k+'=?').join(',')} WHERE id=? AND source='mt5'`,
            [...names.map(k=>patch[k]),existing.id]);
          updated++;
        }
      }else{
        db.run(`INSERT INTO trades
          (opened_at,closed_at,asset,direction,model,result,gain_pct,r_multiple,notes,trade_type,
           source,external_key,profit_money,profit_currency,percent_known,r_known,
           mt5_volume,mt5_open_price,mt5_close_price,mt5_position_id,percent_basis,account_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [t.opened_at,t.closed_at,t.symbol,t.direction,'',t.result,gain,0,'','Swing',
           'mt5',t.external_key,value,t.profit_currency,priced?1:0,0,
           t.volume,t.open_price,t.close_price,t.position_id,priced?denom:null,Number(config.accountId)]);
        imported++;
      }
    }
    db.run('COMMIT');persist();
  }catch(e){try{db.run('ROLLBACK');}catch{}throw e;}
  return {imported,updated,skipped:(data.skipped_partial||0)+(data.skipped_missing_entry||0)+(data.skipped_reversal||0),
    skipped_partial:data.skipped_partial||0,skipped_missing_entry:data.skipped_missing_entry||0,
    skipped_reversal:data.skipped_reversal||0, deal_count:data.deal_count||0,
    rechecked_positions:data.rechecked_positions||0,
    unresolved_positions:data.unresolved_positions||0,
    currency:data.currency, percent_known:known, account_login:account, open_positions:data.open_positions||0};
}
async function mt5Sync(){
  if(!mt5Config)throw new Error('Сначала подключи счёт MT5');
  if(activeAccountId()!==mt5Config.accountId)throw new Error('Выбран другой профиль. Подключи его отдельно');
  if(mt5Busy)throw new Error('Синхронизация уже выполняется');
  mt5Busy=true;mt5Last.error=null;
  try{
    const raw=await runBridge(mt5Config);
    const summary=importFromMt5(raw,mt5Config);
    mt5Last={connected:true,syncing:false,imported:summary.imported,updated:summary.updated,
      skipped:summary.skipped,at:new Date().toISOString(),error:null,...summary};
    for(const win of BrowserWindow.getAllWindows()){if(!win.isDestroyed())win.webContents.send('mt5:synced',summary);}
    return { ...summary,status:mt5PublicStatus() };
  }catch(err){mt5Last.error=err.message;throw err;}
  finally{mt5Busy=false;}
}
function stopMt5(){if(mt5Timer){clearInterval(mt5Timer);mt5Timer=null;}if(mt5Child){mt5Child.kill();mt5Child=null;}mt5Config=null;mt5Last.connected=false;}
ipcMain.handle('accounts:list',()=>run(`SELECT a.*,
  (SELECT COUNT(*) FROM trades t WHERE t.account_id=a.id) AS trades_count,
  (SELECT COUNT(*) FROM backtests b WHERE b.account_id=a.id) AS backtests_count,
  (SELECT COUNT(*) FROM weekly_plans w WHERE w.account_id=a.id) AS weeks_count,
  (SELECT COUNT(*) FROM plans p WHERE p.account_id=a.id) AS plans_count
  FROM accounts a ORDER BY a.id`));
ipcMain.handle('accounts:active',()=>({profile:accountProfile(),hasSavedPassword:hasStoredSecret(activeAccountId())}));
ipcMain.handle('accounts:create',(_,p)=>{
  const label=checkAccountText(p?.label,'Название счёта');
  const broker=String(p?.broker||'Manual').trim().slice(0,70)||'Manual';
  const currency=String(p?.currency||'EUR').trim().toUpperCase().slice(0,8)||'EUR';
  // Capital and currency are required when a new profile is created.
  // MT5 login/server/credentials can only be configured through MT5 Connect.
  if(!String(p?.mt5_basis??'').trim())throw new Error('Укажи базовый капитал нового счёта');
  const basis=positiveCapital(p?.mt5_basis,{allowZero:false});
  if(!/^[A-Z]{3,8}$/.test(currency))throw new Error('Валюта должна содержать 3–8 латинских букв, например EUR');
  // Capture the last insert ID BEFORE exporting sql.js: db.export() reopens SQLite
  // internally and last_insert_rowid() can then be 0. The old order created an
  // account but reported an error, causing users to create duplicates on retry.
  if(run('SELECT id FROM accounts WHERE lower(trim(label))=lower(?) AND archived_at IS NULL LIMIT 1',[label]).length)
    throw new Error('Счёт с таким названием уже есть. Выбери другое название, например «Phase 2».');
  db.run(`INSERT INTO accounts(label,broker,currency,mt5_basis)
    VALUES(?,?,?,?)`,[label,broker,currency,basis]);
  const createdId=Number(run('SELECT last_insert_rowid() AS id')[0]?.id);
  if(!Number.isSafeInteger(createdId)||createdId<1)throw new Error('Не удалось получить ID нового счёта');
  persist();
  return accountProfile(createdId);
});
ipcMain.handle('accounts:update',(_,p)=>updateProfile(activeAccountId(),p||{}));
ipcMain.handle('accounts:archive',(_,id,flag)=>{
  const profile=accountProfile(id);
  if(mt5Busy)throw new Error('Дождись завершения синхронизации MT5');
  if(flag && Number(id)===activeAccountId())stopMt5();
  let snapshotPath=null;
  if(flag){
    // Immutable history snapshot outside the rotating daily-backup folder.
    const folder=path.join(app.getPath('userData'),'phase-archives');fs.mkdirSync(folder,{recursive:true});
    persist();const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    snapshotPath=path.join(folder,`phase-${profile.id}-${stamp}.sqlite`);
    fs.writeFileSync(snapshotPath,Buffer.from(db.export()),{flag:'wx',mode:0o600});
    const header=fs.readFileSync(snapshotPath).subarray(0,16).toString('ascii');
    if(header!=='SQLite format 3\0')throw new Error('Не удалось подтвердить архивную SQLite-копию');
  }
  db.run('UPDATE accounts SET archived_at=? WHERE id=?',[flag?new Date().toISOString():null,profile.id]);
  persist();return {...accountProfile(id),snapshotPath};
});
ipcMain.handle('groups:list',()=>run(`SELECT g.id,g.name, group_concat(m.account_id) AS member_ids,
  COUNT(m.account_id) AS members FROM account_groups g LEFT JOIN account_group_members m ON m.group_id=g.id
  GROUP BY g.id ORDER BY g.id`));
ipcMain.handle('groups:create',(_,name,ids)=>{
  const title=checkAccountText(name,'Название группы',90);
  const members=[...new Set((Array.isArray(ids)?ids:[]).map(Number))];
  if(members.length<2)throw new Error('Выбери минимум два счёта (например, Phase 1 и Phase 2)');
  const records=members.map(id=>accountProfile(id));
  if(new Set(records.map(a=>a.currency)).size>1)throw new Error('Для общего процента счета должны иметь одинаковую валюту');
  db.run('BEGIN TRANSACTION');
  try{
    db.run('INSERT INTO account_groups(name) VALUES(?)',[title]);
    const groupId=run('SELECT last_insert_rowid() AS id')[0].id;
    for(const id of members)db.run('INSERT INTO account_group_members(group_id,account_id) VALUES(?,?)',[groupId,id]);
    db.run('COMMIT');persist();return {id:groupId,name:title,members:members.length};
  }catch(e){try{db.run('ROLLBACK');}catch{}throw e;}
});
ipcMain.handle('groups:delete',(_,id)=>{
  db.run('DELETE FROM account_group_members WHERE group_id=?',[Number(id)]);
  exec('DELETE FROM account_groups WHERE id=?',[Number(id)]);return true;
});
ipcMain.handle('groups:add-member',(_,groupId,rawAccountId)=>{
  const id=Number(groupId),accountId=Number(rawAccountId);
  const group=run('SELECT id,name FROM account_groups WHERE id=?',[id])[0];
  if(!group)throw new Error('Группа не найдена');
  const profile=accountProfile(accountId);
  const memberCurrencies=run(`SELECT DISTINCT a.currency FROM accounts a
    JOIN account_group_members m ON m.account_id=a.id WHERE m.group_id=?`,[id]).map(row=>row.currency);
  if(memberCurrencies.length&&memberCurrencies.some(currency=>currency!==profile.currency))
    throw new Error('Нельзя объединить счета с разной валютой');
  if(run('SELECT 1 FROM account_group_members WHERE group_id=? AND account_id=?',[id,accountId]).length)
    return {added:false,groupId:id,accountId};
  exec('INSERT INTO account_group_members(group_id,account_id) VALUES(?,?)',[id,accountId]);
  return {added:true,groupId:id,accountId};
});
// Only redundant EMPTY account profiles can be removed. No trade, image, plan,
// backtest, group membership or active MT5 profile is ever silently deleted.
function removableDuplicateAccounts(){
  const rows=run(`SELECT a.id,a.label,a.broker,a.currency,a.mt5_login,a.mt5_server,a.archived_at,
   (SELECT COUNT(*) FROM trades t WHERE t.account_id=a.id) trades_count,
   (SELECT COUNT(*) FROM plans p WHERE p.account_id=a.id) plans_count,
   (SELECT COUNT(*) FROM weekly_plans w WHERE w.account_id=a.id) weeks_count,
   (SELECT COUNT(*) FROM backtests b WHERE b.account_id=a.id) backtests_count,
   (SELECT COUNT(*) FROM studio_result_images i WHERE i.account_id=a.id) studio_images_count,
   (SELECT COUNT(*) FROM account_group_members m WHERE m.account_id=a.id) group_count
   FROM accounts a ORDER BY a.id`);
  return emptyDuplicateIds(rows,activeAccountId()).filter(id=>!hasStoredSecret(id)&&mt5Config?.accountId!==id);
}
ipcMain.handle('accounts:duplicate-preview',()=>{
  const ids=removableDuplicateAccounts();
  return {count:ids.length,accounts:ids.map(id=>accountProfile(id)).map(a=>({id:a.id,label:a.label,broker:a.broker}))};
});
ipcMain.handle('accounts:cleanup-empty-duplicates',()=>{
  if(mt5Busy)throw new Error('Дождись окончания синхронизации MT5');
  const ids=removableDuplicateAccounts();
  if(!ids.length)return {removed:0,backupPath:null};
  // Account cleanup must not depend on auto-backup rotation.
  const archive=path.join(app.getPath('userData'),'account-backups');
  fs.mkdirSync(archive,{recursive:true,mode:0o700});
  const dest=path.join(archive,'before-empty-duplicate-cleanup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
  const bytes=Buffer.from(db.export());
  fs.writeFileSync(dest,bytes,{flag:'wx',mode:0o600});
  if(fs.statSync(dest).size!==bytes.length||bytes.subarray(0,16).toString('ascii')!=='SQLite format 3\0')
    throw new Error('Не удалось проверить резервную копию. Очистка отменена.');
  db.run('BEGIN TRANSACTION');
  try{
    for(const id of ids){
      const stillSafe=removableDuplicateAccounts().includes(id);
      if(!stillSafe)throw new Error('Состав счетов изменился; очистка отменена');
      db.run('DELETE FROM accounts WHERE id=?',[id]);
    }
    db.run('COMMIT');persist();
  }catch(error){try{db.run('ROLLBACK');}catch{}throw error;}
  return {removed:ids.length,backupPath:dest};
});
ipcMain.handle('groups:trades',(_,id)=>{
  if(!run('SELECT id FROM account_groups WHERE id=?',[Number(id)]).length)throw new Error('Группа не найдена');
  return run(`SELECT t.*,a.label AS account_label,a.currency AS account_currency FROM trades t
    JOIN account_group_members m ON m.account_id=t.account_id JOIN accounts a ON a.id=t.account_id
    WHERE m.group_id=? ORDER BY t.opened_at DESC,t.id DESC`,[Number(id)]);
});
// Read a Notion CSV or the original Markdown & CSV ZIP. Never extract ZIP files to disk.
const validNotionRisk=raw=>{
  const input=String(raw??'').trim();
  if(!input)return null; // user can import R without a fabricated percentage
  const n=positiveCapital(input,{allowZero:false});
  if(n>100)throw new Error('Риск на одну сделку не должен превышать 100%');
  return n;
};
function analyzeNotionFile(fileBuffer,fileName,accountId,riskPct){
  const suffix=path.extname(fileName).toLowerCase();
  if(suffix==='.zip')return analyzeNotionExportZip(fileBuffer,accountId,{riskPct});
  if(suffix==='.csv'){
    const csv=new TextDecoder('utf-8',{fatal:true}).decode(fileBuffer);
    return analyzeNotionExportCsv(csv,accountId,{riskPct,filename:fileName});
  }
  throw new Error('Поддерживаются только ZIP или CSV из Notion');
}
function notionPreviewResponse(record){
  const {analysis,filename,riskPct}=record;
  return {canceled:false,filename,valid:analysis.valid.length,invalid:analysis.invalid?.length||0,
    incomplete:analysis.incomplete,total:analysis.total,duplicateRows:analysis.duplicateRows||0,
    imagesInZip:analysis.imagesInZip||0,matchedImages:analysis.matchedImages||0,
    unmatchedImages:analysis.unmatchedImages||0,
    unmatchedFiles:analysis.unmatchedFiles||[],previewTrades:analysis.previewTrades||[],
    fileCount:analysis.files?.length||1,riskPct,
    invalidRows:(analysis.invalid||[]).slice(0,10),
    examples:analysis.valid.slice(0,7).map(t=>({date:t.opened_at,asset:t.asset,result:t.result,
      gain:t.percent_known?t.gain_pct:null,rr:t.r_known?t.r_multiple:null,missing:t.missing}))};
}
ipcMain.handle('notion:preview',async(_,rawRisk)=>{
  const riskPct=validNotionRisk(rawRisk);
  const pick=await dialog.showOpenDialog({title:'Импорт Notion: архив ZIP или таблица CSV',
    filters:[{name:'Экспорт Notion ZIP / CSV',extensions:['zip','csv']}],properties:['openFile']});
  if(pick.canceled||!pick.filePaths?.[0])return {canceled:true};
  const file=pick.filePaths[0],maxBytes=220*1024*1024;
  if(fs.statSync(file).size>maxBytes)throw new Error('Файл должен быть меньше 220 МБ');
  const bytes=fs.readFileSync(file),id=activeAccountId();
  const analysis=analyzeNotionFile(bytes,file,id,riskPct);
  pendingNotion={analysis,accountId:id,filename:path.basename(file),riskPct,bytes};
  return notionPreviewResponse(pendingNotion);
});
ipcMain.handle('notion:recalculate',(_,rawRisk)=>{
  if(!pendingNotion||pendingNotion.accountId!==activeAccountId())
    throw new Error('Выбери ZIP или CSV для текущего торгового счёта');
  const riskPct=validNotionRisk(rawRisk);
  const analysis=analyzeNotionFile(pendingNotion.bytes,pendingNotion.filename,pendingNotion.accountId,riskPct);
  pendingNotion={...pendingNotion,analysis,riskPct};
  return notionPreviewResponse(pendingNotion);
});
function saveNotionAttachments(kind,ownerId,entry){
  const pictures=Array.isArray(entry.notionImages)?entry.notionImages:[];
  if(!pictures.length)return {added:0,duplicates:0};
  const tradeId=Number(ownerId);
  if(!Number.isSafeInteger(tradeId)||tradeId<=0)throw new Error('Неверный идентификатор сделки');
  const journal=kind==='trade';
  if(!journal&&kind!=='backtest')throw new Error('Некорректная галерея импорта');
  const table=journal?'trade_result_images':'backtest_result_images';
  const column=journal?'trade_id':'backtest_trade_id';
  const previous=run(`SELECT mime,image FROM ${table} WHERE ${column}=?`,[tradeId]);
  const hashes=new Set(previous.map(pic=>crypto.createHash('sha256').update(String(pic.mime)+'|').update(Buffer.from(pic.image)).digest('hex')));
  let added=0,duplicates=0;
  for(const image of pictures){
    if(!['image/png','image/jpeg','image/webp'].includes(image.mime)||!Buffer.isBuffer(image.bytes))continue;
    const hash=crypto.createHash('sha256').update(image.mime+'|').update(image.bytes).digest('hex');
    if(hashes.has(hash)){duplicates++;continue;}
    db.run(`INSERT INTO ${table}(${column},mime,image) VALUES(?,?,?)`,[tradeId,image.mime,image.bytes]);
    hashes.add(hash);added++;
  }
  return {added,duplicates};
}
function sameOriginalNotionRow(a,b){
  const field=(text,name)=>{
    const match=new RegExp('^'+name+':\\s*(.+)$','mi').exec(String(text||''));
    return match?match[1].trim().toLowerCase().replace(/\s+/g,' '):'';
  };
  // Older releases used row-order-dependent external keys. Check raw Notion columns
  // to avoid duplicating previously imported rows during the first ZIP import.
  const keys=['Number','Opened','Ticker','Direct'];
  return keys.every(key=>field(a.notes,key)&&field(a.notes,key)===field(b.notes,key));
}
// Optional on-demand image preview for manually matching ambiguous Notion pages.
// Image bytes stay on the local PC and are never exposed beyond this IPC call.
ipcMain.handle('notion:image-preview',(_,kind,filename)=>{
  const pending=kind==='backtest'?pendingBacktestNotion:kind==='journal'?pendingNotion:null;
  if(!pending||pending.accountId!==activeAccountId())throw new Error('Импорт уже закрыт');
  const pic=(pending.analysis.unmatchedPictures||[]).find(image=>image.filename===filename);
  if(!pic)throw new Error('Изображение не найдено в выбранном ZIP');
  return `data:${pic.mime};base64,${pic.bytes.toString('base64')}`;
});
ipcMain.handle('notion:import',(_,assignments=[])=>{
  if(!pendingNotion||pendingNotion.accountId!==activeAccountId())throw new Error('Сначала выбери ZIP/CSV заново для текущего счёта');
  const items=pendingNotion.analysis.valid,id=activeAccountId();
  if(!items.length)throw new Error('Нет строк для импорта');
  const manualCount=assignNotionImages(pendingNotion.analysis,assignments);
  const backup=createAutoBackup(true);
  const existingNotion=run("SELECT id,notes FROM trades WHERE account_id=? AND source='notion'",[id]);
  let imported=0,duplicates=0,imagesAdded=0,imagesDuplicates=0;
  db.run('BEGIN TRANSACTION');
  try{
    for(const t of items){
      const exact=run('SELECT id FROM trades WHERE account_id=? AND external_key=?',[id,t.external_key])[0];
      const prior=exact||existingNotion.find(e=>sameOriginalNotionRow(e,t));
      let tradeId;
      if(prior){duplicates++;tradeId=prior.id;}
      else{
        db.run(`INSERT INTO trades
        (opened_at,closed_at,asset,direction,model,result,gain_pct,r_multiple,notes,trade_type,account_id,
          source,external_key,percent_known,r_known)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [t.opened_at,t.closed_at,t.asset,t.direction,t.model,t.result,t.gain_pct,t.r_multiple,t.notes,t.trade_type,
         id,'notion',t.external_key,t.percent_known,t.r_known]);
        tradeId=run('SELECT last_insert_rowid() AS id')[0].id;imported++;
      }
      const added=saveNotionAttachments('trade',tradeId,t);
      imagesAdded+=added.added;imagesDuplicates+=added.duplicates;
    }
    db.run('COMMIT');persist();
    const unmatchedImages=pendingNotion.analysis.unmatchedImages||0;
    pendingNotion=null;
    return {imported,duplicates,imagesAdded,imagesDuplicates,unmatchedImages:Math.max(0,unmatchedImages-manualCount),backup};
  }catch(e){try{db.run('ROLLBACK');}catch{}throw e;}
});
ipcMain.handle('accounts:select',(_,id)=>{
  if(mt5Busy)throw new Error('Дождись завершения синхронизации MT5');
  accountProfile(id);
  stopMt5();
  exec("INSERT INTO settings(key,value) VALUES('active_account_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[String(id)]);
  return {profile:accountProfile(id),hasSavedPassword:hasStoredSecret(id)};
});
// Explicit destructive action. Never delete a profile without a verified backup.
ipcMain.handle('accounts:delete', (_, rawId, confirmedLabel) => {
  if(mt5Busy)throw new Error('Дождись завершения текущей синхронизации MT5');
  const id=Number(rawId);
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Некорректный счёт');
  const profile=accountProfile(id);
  if(String(confirmedLabel||'').trim()!==profile.label)
    throw new Error('Для удаления введи точное название счёта');
  const remaining=run('SELECT id FROM accounts WHERE id<>? ORDER BY id LIMIT 1',[id]);
  if(!remaining.length)throw new Error('Нельзя удалить последний профиль. Сначала создай другой счёт.');
  const wasActive=id===activeAccountId();
  // Include unsaved in-memory state in the snapshot, including images and backtests.
  const bytes=Buffer.from(db.export());
  const backupDir=path.join(app.getPath('userData'),'account-backups');
  fs.mkdirSync(backupDir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backupPath=path.join(backupDir,`before-delete-account-${id}-${stamp}.sqlite`);
  fs.writeFileSync(backupPath,bytes,{flag:'wx',mode:0o600});
  if(fs.statSync(backupPath).size!==bytes.length)throw new Error('Не удалось проверить резервную копию — удаление отменено');
  if(wasActive)stopMt5();
  db.run('BEGIN TRANSACTION');
  try{
    if(wasActive)db.run("UPDATE settings SET value=? WHERE key='active_account_id'",[String(remaining[0].id)]);
    // Image order records are metadata; remove all owner-scoped metadata with the account.
    db.run(`DELETE FROM image_orders WHERE
      (kind IN ('trade-captures','trade-results') AND owner_id IN (SELECT id FROM trades WHERE account_id=?)) OR
      (kind IN ('backtest-captures','backtest-results') AND owner_id IN (SELECT bt.id FROM backtest_trades bt JOIN backtests b ON b.id=bt.backtest_id WHERE b.account_id=?)) OR
      (kind='weekly-asset' AND owner_id IN (SELECT a.id FROM weekly_plan_assets a JOIN weekly_plans p ON p.id=a.plan_id WHERE p.account_id=?))`,[id,id,id]);
    db.run('DELETE FROM account_group_members WHERE account_id=?',[id]);
    for(const [sql,params] of deletionSteps(id))db.run(sql,params);
    db.run('COMMIT');
    persist();
  }catch(error){
    try{db.run('ROLLBACK');}catch{}
    // The old database is always recoverable from the snapshot even after a write failure.
    throw new Error(`Не удалось удалить счёт: ${error.message}. Полная копия: ${backupPath}`);
  }
  // Remove only the deleted profile's Windows-encrypted MT5 password.
  // If the file cannot be removed, do not misreport profile deletion as failed.
  let secretRemoved=true;
  try{const secret=secretPath(id);if(fs.existsSync(secret))fs.unlinkSync(secret);}catch{secretRemoved=false;}
  return {deleted:true,id,switchedTo:wasActive?remaining[0].id:null,backupPath,secretRemoved};
});
ipcMain.handle('app:copy-text',(_,value)=>{clipboard.writeText(String(value||'').slice(0,2000));return true;});
ipcMain.handle('accounts:forget-secret',()=>{const file=secretPath(activeAccountId());if(fs.existsSync(file))fs.unlinkSync(file);return true;});
ipcMain.handle('mt5:connect',async(_,config)=>{
  if(mt5Busy)throw new Error('Дождись завершения текущей синхронизации');
  const login=Number(config?.login);
  if(!Number.isSafeInteger(login)||login<=0)throw new Error('Укажи числовой логин MT5');
  const id=activeAccountId();
  const profile=accountProfile(id);
  if(profile.archived_at)throw new Error('Эта фаза архивирована. Сними архивный статус, чтобы подключить MT5');
  if(profile.mt5_login && profile.mt5_login!==String(login) && run("SELECT id FROM trades WHERE account_id=? AND source='mt5' LIMIT 1",[id]).length)throw new Error('Этот профиль уже содержит сделки другого MT5. Создай новый профиль');
  if(profile.mt5_server && profile.mt5_server!==String(config.server||'').trim() && run("SELECT id FROM trades WHERE account_id=? AND source='mt5' LIMIT 1",[id]).length)throw new Error('Для другого сервера MT5 создай отдельный профиль, чтобы не смешивать сделки');
  const basis=positiveCapital(config?.basis,{allowZero:false});
  const password=String(config?.password||'') || (config?.rememberPassword?storedPassword(id):'');
  if(!password)throw new Error('Введи пароль MT5 или включи использование защищённо сохранённого пароля');
  if(!String(config?.server||'').trim())throw new Error('Укажи сервер брокера из окна MT5');
  stopMt5();
  mt5Config={accountId:id,login,password,server:String(config.server).trim().slice(0,140),
    terminal:String(config.terminal||'').trim().slice(0,600),
    python:String(config.python||'').trim().slice(0,600),
    days:Math.max(1,Math.min(3650,Number(config.days)||365)),
    basis};
  try{
    const result=await mt5Sync();
    updateProfile(id,{broker:String(config.broker||profile.broker).trim()||'Manual',mt5_login:String(login),mt5_server:mt5Config.server,mt5_python:mt5Config.python,mt5_terminal:mt5Config.terminal,mt5_basis:mt5Config.basis,mt5_days:mt5Config.days,mt5_auto:config.auto!==false});
    if(config.rememberPassword){savePassword(id,password)}else if(fs.existsSync(secretPath(id))){fs.unlinkSync(secretPath(id));}
    if(config.auto!==false){mt5Timer=setInterval(()=>{if(mt5Config&&!mt5Busy)mt5Sync().catch(()=>{})},60000);}
    return {...result,status:mt5PublicStatus()};
  }catch(err){stopMt5();throw err;}
});
ipcMain.handle('mt5:sync',()=>mt5Sync());
ipcMain.handle('mt5:status',()=>mt5PublicStatus());
ipcMain.handle('mt5:disconnect',()=>{stopMt5();return mt5PublicStatus();});

ipcMain.handle('trades:list', () => run('SELECT * FROM trades WHERE account_id=? ORDER BY opened_at DESC, id DESC',[activeAccountId()]));
const validTrade = (t,{allowIncomplete=false}={}) => {
  const type = t.trade_type === 'Intraday' ? 'Intraday' : 'Swing';
  const result = ['WIN', 'LOSS', 'BE', 'OPEN', 'UNKNOWN'].includes(t.result) ? t.result : 'UNKNOWN';
  const gain = Number(String(t.gain_pct??'').trim().replace(',','.'));
  const multiple = Number(String(t.r_multiple??'').trim().replace(',','.'));
  const datesAndDirectionOK=Boolean(t.opened_at&&t.asset&&['LONG','SHORT'].includes(t.direction));
  if ((!allowIncomplete&&!datesAndDirectionOK) || !Number.isFinite(gain) || !Number.isFinite(multiple) ||
      (!allowIncomplete&&(String(t.gain_pct??'').trim()==='' || String(t.r_multiple??'').trim()===''))) {
    throw new Error('Проверь заполнение сделки');
  }
  return [String(t.opened_at||''), t.closed_at || null, String(t.asset||'').slice(0,48), t.direction||'UNKNOWN',
    String(t.model || '').slice(0,200), result, gain, multiple, String(t.notes || '').slice(0,20000), type,
    t.plan_id ? Number(t.plan_id) : null, t.plan_asset_id ? Number(t.plan_asset_id) : null];
};
ipcMain.handle('trades:add', (_, t) => {
  exec(`INSERT INTO trades (opened_at,closed_at,asset,direction,model,result,gain_pct,r_multiple,notes,trade_type,plan_id,plan_asset_id,account_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...validTrade(t),activeAccountId()]);
  return run('SELECT * FROM trades ORDER BY id DESC LIMIT 1')[0];
});
ipcMain.handle('trades:update', (_, id, t) => {
  const before=requireCurrentTrade(id);
  if(!before)throw new Error('Сделка не найдена');
  const values=validTrade(t,{allowIncomplete:before.source==='notion'});
  db.run(`UPDATE trades SET opened_at=?,closed_at=?,asset=?,direction=?,model=?,result=?,gain_pct=?,
    r_multiple=?,notes=?,trade_type=?,plan_id=?,plan_asset_id=? WHERE id=?`, [...values,Number(id)]);
  if(before.source==='notion'){
    // Empty numeric fields remain unknown, even though SQLite stores numeric zero.
    db.run('UPDATE trades SET percent_known=?,r_known=? WHERE id=?',
      [Number(t.percent_known)===0?0:1,Number(t.r_known)===0?0:1,Number(id)]);
  }
  if(before.source==='mt5'){
    const locks=newLocks(before,t);
    const rChanged=Number(t.r_multiple)!==Number(before.r_multiple);
    const gainChanged=Number(t.gain_pct)!==Number(before.gain_pct);
    db.run('UPDATE trades SET mt5_manual_fields=?,r_known=?,percent_known=? WHERE id=?',
      [JSON.stringify(locks),rChanged?1:Number(before.r_known),
       gainChanged?1:Number(before.percent_known),Number(id)]);
  }
  persist();
  return run('SELECT * FROM trades WHERE id=?',[Number(id)])[0];
});
ipcMain.handle('trades:delete', (_, id) => {
  requireCurrentTrade(id);
  db.run("DELETE FROM image_orders WHERE kind IN ('trade-results','trade-captures') AND owner_id=?",[Number(id)]);
  db.run('DELETE FROM trade_result_images WHERE trade_id=?',[Number(id)]);
  db.run('DELETE FROM trade_extra_screenshots WHERE trade_id=?',[Number(id)]);
  db.run('DELETE FROM trade_screenshots WHERE trade_id=?',[Number(id)]);
  db.run('DELETE FROM trades WHERE id=?', [Number(id)]);
  persist(); return true;
});
// All images are stored as original bytes. No re-encoding or compression.
async function selectImage(title, limit = 16 * 1024 * 1024) {
  const { canceled, filePaths } = await dialog.showOpenDialog({ title,
    properties:['openFile'], filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}] });
  if (canceled || !filePaths.length) return null;
  const file = filePaths[0];
  if (fs.statSync(file).size > limit) throw new Error('Максимальный размер изображения — 16 МБ');
  const bytes = fs.readFileSync(file);
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  const webp = bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
  const mime = png?'image/png':jpg?'image/jpeg':webp?'image/webp':null;
  if (!mime) throw new Error('Поддерживаются PNG, JPEG и WEBP');
  return {mime, bytes:new Uint8Array(bytes)};
}
function validateImageDataURL(dataUrl, limit=16*1024*1024) {
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl||''));
  if(!match)throw new Error('Вставь скриншот PNG, JPEG или WEBP');
  if(match[2].length>Math.ceil(limit*4/3)+8)throw new Error('Максимальный размер скриншота — 16 МБ');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.length>limit)throw new Error('Максимальный размер скриншота — 16 МБ');
  const isPng=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isJpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const isWebp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  const mime=isPng?'image/png':isJpg?'image/jpeg':isWebp?'image/webp':null;
  if(!mime||mime!==match[1])throw new Error('Повреждённый или неподдерживаемый скриншот');
  return {mime,bytes:new Uint8Array(bytes)};
}
const imageData = row => ({ id:row.id, timeframe:row.timeframe ?? null, mime:row.mime, dataUrl:`data:${row.mime};base64,${Buffer.from(row.image).toString('base64')}` });
// Account-scoped image order metadata; existing image BLOBs are never rewritten.
function liveOrderKeys(kind,ownerId){
  const owner=Number(ownerId);
  if(!Number.isSafeInteger(owner)||owner<1||!imageOrder.TYPES.includes(kind))throw new Error('Неизвестная галерея');
  if(kind==='trade-captures'){
    requireCurrentTrade(owner);
    return [...run('SELECT timeframe FROM trade_screenshots WHERE trade_id=?',[owner]).map(x=>'legacy:'+x.timeframe),
      ...run('SELECT id FROM trade_extra_screenshots WHERE trade_id=?',[owner]).map(x=>'extra:'+x.id)];
  }
  if(kind==='backtest-captures'){
    requireBacktestTrade(owner);
    return run('SELECT id FROM backtest_images WHERE backtest_trade_id=?',[owner]).map(x=>'id:'+x.id);
  }
  if(kind==='trade-results'){
    requireCurrentTrade(owner);
    return run('SELECT id FROM trade_result_images WHERE trade_id=?',[owner]).map(x=>'id:'+x.id);
  }
  if(kind==='backtest-results'){
    requireBacktestTrade(owner);
    return run('SELECT id FROM backtest_result_images WHERE backtest_trade_id=?',[owner]).map(x=>'id:'+x.id);
  }
  requireAsset(owner);
  return run('SELECT id FROM plan_images WHERE asset_id=?',[owner]).map(x=>'id:'+x.id);
}
ipcMain.handle('image-orders:get',(_,kind,ownerId)=>{
  const live=liveOrderKeys(kind,ownerId);
  const saved=run('SELECT image_key FROM image_orders WHERE kind=? AND owner_id=? ORDER BY position',
    [kind,Number(ownerId)]).map(x=>x.image_key);
  return imageOrder.mergeSavedOrder(live,saved);
});
ipcMain.handle('image-orders:save',(_,kind,ownerId,keys)=>{
  const live=liveOrderKeys(kind,ownerId);
  if(!imageOrder.sameImageSet(keys,live))throw new Error('Список скриншотов изменился. Обнови галерею и повтори.');
  db.run('BEGIN TRANSACTION');
  try{
    db.run('DELETE FROM image_orders WHERE kind=? AND owner_id=?',[kind,Number(ownerId)]);
    keys.forEach((key,i)=>db.run('INSERT INTO image_orders(kind,owner_id,image_key,position) VALUES(?,?,?,?)',[kind,Number(ownerId),key,i]));
    db.run('COMMIT');persist();return true;
  }catch(error){try{db.run('ROLLBACK');}catch{}throw error;}
});

// Windows clipboard fallback for screenshot tools that expose no File item in paste events.
ipcMain.handle('result-images:clipboard',()=>{
  const bitmap=clipboard.readImage();
  if(bitmap.isEmpty())return null;
  const bytes=bitmap.toPNG();
  if(bytes.length>16*1024*1024)throw new Error('Изображение в буфере больше 16 МБ. Сохрани его как файл и прикрепи вручную.');
  return 'data:image/png;base64,'+bytes.toString('base64');
});
// Result snapshots live outside the TF galleries and have no arbitrary image-count limit.
// Every operation resolves its parent through the active account to prevent cross-account access.
ipcMain.handle('result-images:list',(_,kind,ownerId)=>{
  if(kind==='trade'){
    requireCurrentTrade(ownerId);
    return run('SELECT * FROM trade_result_images WHERE trade_id=? ORDER BY id',[Number(ownerId)]).map(imageData);
  }
  if(kind==='backtest'){
    requireBacktestTrade(ownerId);
    return run('SELECT * FROM backtest_result_images WHERE backtest_trade_id=? ORDER BY id',[Number(ownerId)]).map(imageData);
  }
  throw new Error('Неизвестный тип сделки');
});
ipcMain.handle('result-images:add',(_,kind,ownerId,dataUrl)=>{
  const image=validateImageDataURL(dataUrl);
  if(kind==='trade'){
    requireCurrentTrade(ownerId);
    exec('INSERT INTO trade_result_images(trade_id,mime,image) VALUES(?,?,?)',[Number(ownerId),image.mime,image.bytes]);
  }else if(kind==='backtest'){
    requireBacktestTrade(ownerId);
    exec('INSERT INTO backtest_result_images(backtest_trade_id,mime,image) VALUES(?,?,?)',[Number(ownerId),image.mime,image.bytes]);
  }else throw new Error('Неизвестный тип сделки');
  return true;
});
ipcMain.handle('result-images:delete',(_,kind,imageId)=>{
  const id=Number(imageId);
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Некорректный скриншот');
  if(kind==='trade'){
    const image=run('SELECT trade_id FROM trade_result_images WHERE id=?',[id])[0];
    if(!image)throw new Error('Скриншот не найден');
    requireCurrentTrade(image.trade_id);
    exec('DELETE FROM trade_result_images WHERE id=?',[id]);
  }else if(kind==='backtest'){
    const image=run('SELECT backtest_trade_id FROM backtest_result_images WHERE id=?',[id])[0];
    if(!image)throw new Error('Скриншот не найден');
    requireBacktestTrade(image.backtest_trade_id);
    exec('DELETE FROM backtest_result_images WHERE id=?',[id]);
  }else throw new Error('Неизвестный тип сделки');
  return true;
});
const validTimeframe = tf => typeof tf==='string'&&/^[A-Za-z0-9._-]{1,16}$/.test(tf);
ipcMain.handle('screenshots:list', (_, tradeId) => {
  requireCurrentTrade(tradeId);
  const data = run('SELECT timeframe,mime,image FROM trade_screenshots WHERE trade_id=?', [Number(tradeId)]);
  return data.map(row => ({ timeframe:row.timeframe, dataUrl:`data:${row.mime};base64,${Buffer.from(row.image).toString('base64')}` }));
});
ipcMain.handle('screenshots:add', async (_, tradeId, tf) => {
  if(!validTimeframe(tf))throw new Error('Некорректный таймфрейм');
  requireCurrentTrade(tradeId);
  const selected = await selectImage(`Скриншот ${tf}`);
  if (!selected) return { canceled:true };
  exec('INSERT INTO trade_screenshots (trade_id,timeframe,mime,image) VALUES (?,?,?,?) ON CONFLICT(trade_id,timeframe) DO UPDATE SET mime=excluded.mime,image=excluded.image',
    [Number(tradeId),tf,selected.mime,selected.bytes]);
  return { canceled:false };
});
ipcMain.handle('screenshots:delete', (_, tradeId, tf) => {
  if(!validTimeframe(tf)) throw new Error('Некорректный таймфрейм');
  requireCurrentTrade(tradeId);
  exec('DELETE FROM trade_screenshots WHERE trade_id=? AND timeframe=?',[Number(tradeId),tf]);
  return true;
});

// No arbitrary per-trade image count limit; originals are stored in SQLite.
ipcMain.handle('screenshots-extra:list',(_,tradeId)=>{
  requireCurrentTrade(tradeId);
  return run('SELECT * FROM trade_extra_screenshots WHERE trade_id=? ORDER BY id',[Number(tradeId)]).map(imageData);
});
ipcMain.handle('screenshots-extra:add',async(_,tradeId,timeframe)=>{
  if(!validTimeframe(timeframe))throw new Error('Выбери таймфрейм скриншота');
  const id=Number(tradeId);
  requireCurrentTrade(id);
  const selected=await selectImage('Дополнительный скриншот сделки');
  if(!selected)return {canceled:true};
  exec('INSERT INTO trade_extra_screenshots(trade_id,timeframe,mime,image) VALUES(?,?,?,?)',[id,timeframe,selected.mime,selected.bytes]);
  return {canceled:false};
});
ipcMain.handle('screenshots-extra:paste',(_,tradeId,timeframe,dataUrl)=>{
  if(!validTimeframe(timeframe))throw new Error('Укажи таймфрейм');
  requireCurrentTrade(tradeId);
  const image=validateImageDataURL(dataUrl);
  exec('INSERT INTO trade_extra_screenshots(trade_id,timeframe,mime,image) VALUES(?,?,?,?)',
    [Number(tradeId),timeframe,image.mime,image.bytes]);
  return true;
});
ipcMain.handle('screenshots-extra:move',(_,imageId,timeframe)=>{
  if(!validTimeframe(timeframe))throw new Error('Некорректный таймфрейм');
  const image=run('SELECT id,trade_id FROM trade_extra_screenshots WHERE id=?',[Number(imageId)])[0];
  if(!image)throw new Error('Скриншот не найден');
  requireCurrentTrade(image.trade_id);
  exec('UPDATE trade_extra_screenshots SET timeframe=? WHERE id=?',[timeframe,Number(imageId)]);
  return true;
});
ipcMain.handle('screenshots:move',(_,tradeId,oldTf,newTf)=>{
  if(!validTimeframe(oldTf)||!validTimeframe(newTf))throw new Error('Некорректный таймфрейм');
  requireCurrentTrade(tradeId);
  const img=run('SELECT * FROM trade_screenshots WHERE trade_id=? AND timeframe=?',[Number(tradeId),oldTf])[0];
  if(!img)throw new Error('Скриншот не найден');
  // Move legacy 1W/1D/4H into the unlimited image list, preserving original bytes.
  db.run('BEGIN');
  try{
    db.run('INSERT INTO trade_extra_screenshots(trade_id,timeframe,mime,image) VALUES(?,?,?,?)',
      [Number(tradeId),newTf,img.mime,img.image]);
    db.run('DELETE FROM trade_screenshots WHERE trade_id=? AND timeframe=?',[Number(tradeId),oldTf]);
    db.run('COMMIT');persist();
  }catch(e){db.run('ROLLBACK');throw e;}
  return true;
});
ipcMain.handle('screenshots-extra:delete',(_,imageId)=>{
  const id=Number(imageId);
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Некорректный номер скриншота');
  const img=run('SELECT trade_id FROM trade_extra_screenshots WHERE id=?',[id])[0];
  if(img)requireCurrentTrade(img.trade_id);
  exec('DELETE FROM trade_extra_screenshots WHERE id=?',[id]);return true;
});

ipcMain.handle('plans:list', () => run('SELECT * FROM plans WHERE account_id=? ORDER BY id DESC',[activeAccountId()]));
ipcMain.handle('plans:add', (_, p) => {
  exec('INSERT INTO plans (name,asset,risk_pct,rules,account_id) VALUES (?,?,?,?,?)',
    [p.name, p.asset || '', Number(p.risk_pct || 1), p.rules || '',activeAccountId()]);
  return run('SELECT * FROM plans ORDER BY id DESC LIMIT 1')[0];
});

function requirePlan(id) {
  const p=run('SELECT id FROM weekly_plans WHERE id=? AND account_id=?',[Number(id),activeAccountId()])[0];
  if(!p)throw new Error('Недельный план не найден'); return p;
}
function requireAsset(id, planId){
  const a=run('SELECT id,plan_id FROM weekly_plan_assets WHERE id=?',[Number(id)])[0];
  if(!a || (planId != null && Number(a.plan_id)!==Number(planId))) throw new Error('Актив плана не найден');
  requirePlan(a.plan_id);return a;
}
ipcMain.handle('weekly:list',()=>run('SELECT * FROM weekly_plans WHERE account_id=? ORDER BY week_start DESC,id DESC',[activeAccountId()]));
ipcMain.handle('weekly:add',(_,p)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(p.week_start||'')) || !String(p.title||'').trim())throw new Error('Укажи дату начала недели и название');
  exec('INSERT INTO weekly_plans(week_start,title,notes,account_id) VALUES(?,?,?,?)',
    [p.week_start,String(p.title).trim().slice(0,150),String(p.notes||'').slice(0,50000),activeAccountId()]);
  return run('SELECT * FROM weekly_plans ORDER BY id DESC LIMIT 1')[0];
});
ipcMain.handle('weekly:update',(_,id,p)=>{
  requirePlan(id);
  exec('UPDATE weekly_plans SET week_start=?,title=?,notes=? WHERE id=?',
    [p.week_start,String(p.title||'').trim().slice(0,150),String(p.notes||'').slice(0,50000),Number(id)]);
  return true;
});
ipcMain.handle('weekly:delete',(_,id)=>{
  requirePlan(id);
  db.run('UPDATE trades SET plan_id=NULL,plan_asset_id=NULL WHERE plan_id=?',[Number(id)]);
  db.run("DELETE FROM image_orders WHERE kind='weekly-asset' AND owner_id IN (SELECT id FROM weekly_plan_assets WHERE plan_id=?)",[Number(id)]);
  db.run('DELETE FROM plan_images WHERE plan_id=?',[Number(id)]);
  db.run('DELETE FROM weekly_plan_assets WHERE plan_id=?',[Number(id)]);
  db.run('DELETE FROM weekly_plans WHERE id=?',[Number(id)]);
  persist();return true;
});
ipcMain.handle('weekly-assets:list',(_,planId)=>{requirePlan(planId);return run('SELECT * FROM weekly_plan_assets WHERE plan_id=? ORDER BY asset,id',[Number(planId)]);});
ipcMain.handle('weekly-assets:add',(_,planId,asset)=>{
  requirePlan(planId);
  asset=String(asset||'').trim().toUpperCase().slice(0,32);
  if(!asset)throw new Error('Укажи актив');
  exec('INSERT OR IGNORE INTO weekly_plan_assets(plan_id,asset) VALUES(?,?)',[Number(planId),asset]);
  return run('SELECT * FROM weekly_plan_assets WHERE plan_id=? AND asset=?',[Number(planId),asset])[0];
});
ipcMain.handle('weekly-assets:update',(_,id,notes)=>{
  requireAsset(id);exec('UPDATE weekly_plan_assets SET notes=? WHERE id=?',[String(notes||'').slice(0,50000),Number(id)]);return true;
});
ipcMain.handle('weekly-assets:delete',(_,id)=>{
  requireAsset(id);
  db.run("DELETE FROM image_orders WHERE kind='weekly-asset' AND owner_id=?",[Number(id)]);db.run('UPDATE trades SET plan_asset_id=NULL WHERE plan_asset_id=?',[Number(id)]);
  db.run('DELETE FROM plan_images WHERE asset_id=?',[Number(id)]);
  db.run('DELETE FROM weekly_plan_assets WHERE id=?',[Number(id)]);persist();return true;
});
ipcMain.handle('plan-images:list',(_,planId,assetId)=>{
  requirePlan(planId);
  if(assetId!=null)requireAsset(assetId,planId);
  return (assetId==null ? run('SELECT * FROM plan_images WHERE plan_id=? AND asset_id IS NULL ORDER BY id DESC',[Number(planId)])
    : run('SELECT * FROM plan_images WHERE plan_id=? AND asset_id=? ORDER BY id DESC',[Number(planId),Number(assetId)]))
      .map(imageData);
});
ipcMain.handle('plan-images:add',async(_,planId,assetId)=>{
  requirePlan(planId);if(assetId!=null)requireAsset(assetId,planId);
  const selected=await selectImage('Добавить скриншот к плану');
  if(!selected)return {canceled:true};
  exec('INSERT INTO plan_images(plan_id,asset_id,mime,image) VALUES(?,?,?,?)',
    [Number(planId),assetId==null?null:Number(assetId),selected.mime,selected.bytes]);return {canceled:false};
});
ipcMain.handle('plan-images:paste',(_,planId,assetId,dataUrl)=>{
  requirePlan(planId);
  if(assetId!=null)requireAsset(assetId,planId);
  const image=validateImageDataURL(dataUrl);
  exec('INSERT INTO plan_images(plan_id,asset_id,mime,image) VALUES(?,?,?,?)',
    [Number(planId),assetId==null?null:Number(assetId),image.mime,image.bytes]);
  return true;
});
ipcMain.handle('plan-images:delete',(_,id)=>{
  const img=run('SELECT plan_id FROM plan_images WHERE id=?',[Number(id)])[0];
  if(img)requirePlan(img.plan_id);
  exec('DELETE FROM plan_images WHERE id=?',[Number(id)]);return true;
});
function requireBacktest(id){
  const p=run('SELECT * FROM backtests WHERE id=? AND account_id=?',[Number(id),activeAccountId()])[0];
  if(!p)throw new Error('Бектест не найден');return p;
}
function requireBacktestTrade(id){
  const t=run('SELECT t.* FROM backtest_trades t JOIN backtests b ON b.id=t.backtest_id WHERE t.id=? AND b.account_id=?',[Number(id),activeAccountId()])[0];
  if(!t)throw new Error('Строка бектеста не найдена');return t;
}

function previewBacktestNotion(pending){
  const {analysis,groups,targetBacktestId,riskPct,filename}=pending;
  return {
    canceled:false,filename,riskPct,targetBacktestId,
    total:analysis.valid.length,duplicateRows:analysis.duplicateRows||0,
    imagesInZip:analysis.imagesInZip||0,matchedImages:analysis.matchedImages||0,
    unmatchedImages:analysis.unmatchedImages||0,
    unmatchedFiles:analysis.unmatchedFiles||[],previewTrades:analysis.previewTrades||[],
    missing:analysis.incomplete||0,files:analysis.files||[filename],
    projects:groups.map(g=>({title:g.title,asset:g.asset,style:g.style,year:g.year,count:g.trades.length})),
    examples:analysis.valid.slice(0,7).map(t=>({date:t.opened_at||'',asset:t.asset,result:t.result,
      rr:t.r_known?t.r_multiple:null,gain:t.percent_known?t.gain_pct:null}))
  };
}
function prepareBacktestNotion(pending,rawRisk){
  const riskPct=validNotionRisk(rawRisk);
  const analysis=analyzeNotionFile(pending.bytes,pending.filename,pending.accountId,riskPct);
  const groups=groupNotionBacktests(analysis,{fallbackYear:pending.fallbackYear,filename:pending.filename});
  if(pending.targetBacktestId){
    const bt=requireBacktest(pending.targetBacktestId);
    if(groups.length!==1||groups[0].year!==Number(bt.year)||groups[0].asset!==bt.asset.toUpperCase()||groups[0].style!==bt.style)
      throw new Error('В выбранный бектест можно добавить только сделки того же актива, стиля и года. Выбери импорт в новый бектест.');
  }
  return {...pending,riskPct,analysis,groups};
}
ipcMain.handle('backtest-notion:preview',async(_,rawRisk,targetId,rawFallbackYear)=>{
  const year=Number(rawFallbackYear);
  if(!Number.isInteger(year)||year<2000||year>2100)throw new Error('Укажи год бектеста от 2000 до 2100');
  const accountId=activeAccountId();
  if(targetId!=null)requireBacktest(targetId);
  const selected=await dialog.showOpenDialog({title:'Импорт Notion в Backtest — ZIP или CSV',
    filters:[{name:'Notion Export ZIP или CSV',extensions:['zip','csv']}],properties:['openFile']});
  if(selected.canceled||!selected.filePaths?.[0])return {canceled:true};
  const file=selected.filePaths[0];
  if(fs.statSync(file).size>220*1024*1024)throw new Error('Архив слишком большой — максимум 220 МБ');
  const pending={accountId,targetBacktestId:targetId==null?null:Number(targetId),filename:path.basename(file),bytes:fs.readFileSync(file),fallbackYear:year};
  pendingBacktestNotion=prepareBacktestNotion(pending,rawRisk);
  return previewBacktestNotion(pendingBacktestNotion);
});
ipcMain.handle('backtest-notion:recalculate',(_,rawRisk,rawFallbackYear)=>{
  if(!pendingBacktestNotion||pendingBacktestNotion.accountId!==activeAccountId())
    throw new Error('Сначала выбери ZIP или CSV для выбранного счёта');
  const year=Number(rawFallbackYear);
  if(!Number.isInteger(year)||year<2000||year>2100)throw new Error('Укажи корректный год');
  pendingBacktestNotion=prepareBacktestNotion({...pendingBacktestNotion,fallbackYear:year},rawRisk);
  return previewBacktestNotion(pendingBacktestNotion);
});
ipcMain.handle('backtest-notion:import',(_,assignments=[])=>{
  const p=pendingBacktestNotion;
  if(!p||p.accountId!==activeAccountId())throw new Error('Сначала проверь ZIP или CSV для текущего счёта');
  if(!p.groups.length)throw new Error('Нет сделок для импорта');
  // Groups hold references to analyzed trades, so manual attachments flow through
  // to the existing SQLite gallery without altering Journal or MT5 history.
  const manualCount=assignNotionImages(p.analysis,assignments);
  const byKey=new Map(p.analysis.valid.map(t=>[t.external_key,t]));
  for(const group of p.groups)for(const trade of group.trades){
    const original=byKey.get(trade.source_key);
    if(original?.notionImages)trade.notionImages=original.notionImages;
  }
  // Create the backup before opening the SQLite transaction. Never modify live journal trades.
  const backup=createAutoBackup(true);
  const created=[],projectIds=[];let imported=0,duplicates=0,imagesAdded=0,imagesDuplicates=0;
  db.run('BEGIN TRANSACTION');
  try{
    for(const group of p.groups){
      let project=p.targetBacktestId?requireBacktest(p.targetBacktestId):
        run('SELECT * FROM backtests WHERE account_id=? AND import_collection_key=? LIMIT 1',
          [p.accountId,group.collectionKey])[0];
      if(!project){
        db.run('INSERT INTO backtests(title,style,asset,year,notes,account_id,import_collection_key) VALUES(?,?,?,?,?,?,?)',
          [group.title,group.style,group.asset,group.year,'Импортировано из Notion ZIP / CSV',p.accountId,group.collectionKey]);
        const id=run('SELECT last_insert_rowid() AS id')[0].id;
        project=run('SELECT * FROM backtests WHERE id=?',[id])[0];
        created.push({id,title:project.title});
      }
      projectIds.push(project.id);
      for(const t of group.trades){
        const prior=run('SELECT id FROM backtest_trades WHERE backtest_id=? AND source_key=? LIMIT 1',
          [project.id,t.source_key])[0];
        let rowId;
        if(prior){duplicates++;rowId=prior.id;}
        else{
          db.run(`INSERT INTO backtest_trades(backtest_id,opened_at,closed_at,direction,model,result,
            rr,risk_pct,gain_pct,tags,notes,source_key,r_known,percent_known)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [project.id,t.opened_at,t.closed_at,t.direction==='UNKNOWN'?'UNKNOWN':t.direction,
             t.model,t.result,t.rr,t.risk_pct,t.gain_pct,t.tags,t.notes,t.source_key,
             t.r_known?1:0,t.percent_known?1:0]);
          rowId=run('SELECT last_insert_rowid() AS id')[0].id;imported++;
        }
        const attached=saveNotionAttachments('backtest',rowId,t);
        imagesAdded+=attached.added;imagesDuplicates+=attached.duplicates;
      }
    }
    db.run('COMMIT');persist();
    const unmatchedImages=pendingBacktestNotion.analysis.unmatchedImages||0;
    pendingBacktestNotion=null;
    return {imported,duplicates,imagesAdded,imagesDuplicates,unmatchedImages:Math.max(0,unmatchedImages-manualCount),backup,created,projectIds};
  }catch(err){try{db.run('ROLLBACK');}catch{}throw err;}
});

ipcMain.handle('backtests:list',()=>run('SELECT * FROM backtests WHERE account_id=? ORDER BY year DESC,id DESC',[activeAccountId()]));
ipcMain.handle('backtests:add',(_,p)=>{
  const year=Number(p.year);
  if(!String(p.title||'').trim()||!String(p.asset||'').trim()||!Number.isInteger(year)||year<2000||year>2100)throw new Error('Заполни название, актив и год');
  exec('INSERT INTO backtests(title,style,asset,year,notes,account_id) VALUES(?,?,?,?,?,?)',
    [String(p.title).trim().slice(0,150),String(p.style||'Swing').slice(0,50),String(p.asset).trim().toUpperCase().slice(0,32),year,String(p.notes||'').slice(0,20000),activeAccountId()]);
  return run('SELECT * FROM backtests ORDER BY id DESC LIMIT 1')[0];
});
ipcMain.handle('backtests:rename',(_,id,title)=>{
  requireBacktest(id);
  const name=String(title||'').trim();
  if(name.length<2||name.length>150)throw new Error('Название должно содержать от 2 до 150 символов');
  exec('UPDATE backtests SET title=? WHERE id=?',[name,Number(id)]);
  return requireBacktest(id);
});
ipcMain.handle('backtests:delete',(_,id)=>{
  requireBacktest(id);
  db.run("DELETE FROM image_orders WHERE kind IN ('backtest-captures','backtest-results') AND owner_id IN (SELECT id FROM backtest_trades WHERE backtest_id=?)",[Number(id)]);
  db.run('DELETE FROM backtest_result_images WHERE backtest_trade_id IN (SELECT id FROM backtest_trades WHERE backtest_id=?)',[Number(id)]);
  db.run('DELETE FROM backtest_images WHERE backtest_trade_id IN (SELECT id FROM backtest_trades WHERE backtest_id=?)',[Number(id)]);
  db.run('DELETE FROM backtest_trades WHERE backtest_id=?',[Number(id)]);
  db.run('DELETE FROM backtests WHERE id=?',[Number(id)]);persist();return true;
});
ipcMain.handle('backtest-trades:list',(_,id)=>{requireBacktest(id);return run('SELECT * FROM backtest_trades WHERE backtest_id=? ORDER BY id ASC',[Number(id)]);});
ipcMain.handle('backtest-trades:add',(_,id)=>{
  requireBacktest(id);
  exec('INSERT INTO backtest_trades(backtest_id) VALUES(?)',[Number(id)]);
  return run('SELECT * FROM backtest_trades ORDER BY id DESC LIMIT 1')[0];
});
const allowedBtColumns=['opened_at','closed_at','direction','model','result','risk_pct','rr','gain_pct','tags','notes'];
ipcMain.handle('backtest-trades:field',(_,id,column,value)=>{
  const row=requireBacktestTrade(id);
  if(!allowedBtColumns.includes(column))throw new Error('Недопустимое поле');
  if(column==='direction'&&!['LONG','SHORT','UNKNOWN'].includes(value))throw new Error('Некорректное направление');
  if(column==='result'&&!['WIN','LOSS','BE','OPEN','UNKNOWN'].includes(value))throw new Error('Некорректный результат');
  if(['rr','gain_pct','risk_pct'].includes(column)){
    const entered=String(value??'').trim().replace(/[−–]/g,'-').replace(',', '.');
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(entered))
      throw new Error('Введите число, например -1,5 или 2.5');
    value=Number(entered);
    if(!Number.isFinite(value)||Math.abs(value)>100000)throw new Error('Некорректное число');
    if(column==='risk_pct'&&(value<0||value>100))throw new Error('Риск должен быть от 0 до 100%');
  }else value=String(value||'').slice(0,column==='notes'?20000:300);
  const idNum=Number(id), risk=Number(row.risk_pct??1), achievedR=Number(row.rr||0);
  const hasR=row.r_known!==0, hasPercent=row.percent_known!==0;
  // Never invent 0R or 0% when the imported source was incomplete.
  if(column==='result'){
    const nextR=value==='BE'?0:value==='LOSS'?-Math.abs(achievedR):value==='WIN'?Math.abs(achievedR):achievedR;
    const knownR=value==='BE'?1:Number(hasR);
    const priceKnown=value==='BE'?1:Number(knownR&&risk>0&&['WIN','LOSS'].includes(value)?1:hasPercent);
    const nextGain=priceKnown&&knownR&&risk>0?nextR*risk:row.gain_pct;
    db.run('UPDATE backtest_trades SET result=?,rr=?,gain_pct=?,r_known=?,percent_known=? WHERE id=?',
      [value,nextR,nextGain,knownR,priceKnown,idNum]);
  }else if(column==='rr'){
    const nextR=row.result==='WIN'?Math.abs(value):row.result==='LOSS'?-Math.abs(value):row.result==='BE'?0:value;
    const priced=risk>0&&['WIN','LOSS','BE'].includes(row.result);
    db.run('UPDATE backtest_trades SET rr=?,gain_pct=?,r_known=1,percent_known=? WHERE id=?',
      [nextR,priced?nextR*risk:row.gain_pct,priced?1:Number(hasPercent),idNum]);
  }else if(column==='risk_pct'){
    const priced=Number(hasR)&&value>0&&['WIN','LOSS','BE'].includes(row.result);
    db.run('UPDATE backtest_trades SET risk_pct=?,gain_pct=?,percent_known=? WHERE id=?',
      [value,priced?achievedR*value:row.gain_pct,priced?1:Number(hasPercent),idNum]);
  }else if(column==='gain_pct'){
    if(row.result==='OPEN')throw new Error('Сначала закрой сделку — у открытой позиции нет реализованной прибыли');
    const nextResult=value>0?'WIN':value<0?'LOSS':'BE';
    db.run('UPDATE backtest_trades SET gain_pct=?,rr=?,result=?,percent_known=1,r_known=? WHERE id=?',
      [value,risk>0?value/risk:row.rr,nextResult,risk>0?1:Number(hasR),idNum]);
  }else{
    db.run('UPDATE backtest_trades SET '+column+'=? WHERE id=?',[value,idNum]);
  }
  persist();return run('SELECT * FROM backtest_trades WHERE id=?',[idNum])[0];
});
ipcMain.handle('backtest-trades:delete',(_,id)=>{
  requireBacktestTrade(id);
  db.run("DELETE FROM image_orders WHERE kind IN ('backtest-captures','backtest-results') AND owner_id=?",[Number(id)]);
  db.run('DELETE FROM backtest_result_images WHERE backtest_trade_id=?',[Number(id)]);
  db.run('DELETE FROM backtest_images WHERE backtest_trade_id=?',[Number(id)]);
  db.run('DELETE FROM backtest_trades WHERE id=?',[Number(id)]);persist();return true;
});
ipcMain.handle('backtest-images:list',(_,tradeId)=>{
  requireBacktestTrade(tradeId);
  return run('SELECT * FROM backtest_images WHERE backtest_trade_id=? ORDER BY timeframe,id DESC',[Number(tradeId)]).map(imageData);
});
ipcMain.handle('backtest-images:add',async(_,tradeId,timeframe)=>{
  requireBacktestTrade(tradeId);
  // Never silently assign a missing timeframe to 4H.
  if(!validTimeframe(timeframe))throw new Error('Выбери таймфрейм скриншота');
  const selected=await selectImage(`Скриншот бектеста ${timeframe}`);if(!selected)return {canceled:true};
  db.run('INSERT INTO backtest_images(backtest_trade_id,timeframe,mime,image) VALUES(?,?,?,?)',
    [Number(tradeId),timeframe,selected.mime,selected.bytes]);
  const inserted=run('SELECT id,timeframe FROM backtest_images WHERE id=last_insert_rowid()')[0];
  persist();
  return {canceled:false,id:inserted.id,timeframe:inserted.timeframe};
});
ipcMain.handle('backtest-images:paste',(_,tradeId,timeframe,dataUrl)=>{
  requireBacktestTrade(tradeId);
  if(!validTimeframe(timeframe))throw new Error('Укажи таймфрейм');
  const image=validateImageDataURL(dataUrl);
  exec('INSERT INTO backtest_images(backtest_trade_id,timeframe,mime,image) VALUES(?,?,?,?)',
    [Number(tradeId),timeframe,image.mime,image.bytes]);
  return true;
});
ipcMain.handle('backtest-images:move',(_,imageId,timeframe)=>{
  if(!validTimeframe(timeframe))throw new Error('Некорректный таймфрейм');
  const image=run('SELECT id,backtest_trade_id FROM backtest_images WHERE id=?',[Number(imageId)])[0];
  if(!image)throw new Error('Скриншот не найден');
  requireBacktestTrade(image.backtest_trade_id);
  db.run('UPDATE backtest_images SET timeframe=? WHERE id=?',[timeframe,Number(imageId)]);
  persist();return {id:Number(imageId),timeframe};
});
ipcMain.handle('backtest-images:delete',(_,id)=>{
  const img=run('SELECT backtest_trade_id FROM backtest_images WHERE id=?',[Number(id)])[0];
  if(img)requireBacktestTrade(img.backtest_trade_id);
  exec('DELETE FROM backtest_images WHERE id=?',[Number(id)]);return true;
});
ipcMain.handle('settings:get', (_, key) => run('SELECT value FROM settings WHERE key=?', [key])[0]?.value ?? null);
ipcMain.handle('settings:set', (_, key, value) => exec(
  'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  [key, String(value)]));
ipcMain.handle('backup:status',()=>({ ...backupSettings(),files:savedAutoBackups().length,
  latest:savedAutoBackups()[0]||null }));
ipcMain.handle('backup:settings',(_,enabled,keep)=>{
  const n=Number(keep);
  if(![7,14,30].includes(n))throw new Error('Хранить можно 7, 14 или 30 копий');
  db.run("INSERT INTO settings(key,value) VALUES('auto_backup_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[enabled?'1':'0']);
  db.run("INSERT INTO settings(key,value) VALUES('auto_backup_keep',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[String(n)]);
  persist();
  if(enabled)createAutoBackup(false);
  return {...backupSettings(),files:savedAutoBackups().length,latest:savedAutoBackups()[0]||null};
});
ipcMain.handle('backup:run-auto',()=>createAutoBackup(true));
ipcMain.handle('backup:open-folder',async()=>{
  const folder=autoBackupFolder();fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const error=await shell.openPath(folder);if(error)throw new Error(error);
  return folder;
});
// Synchronous final flush on window close: prevents losing Export Studio drafts
// when the application is closed before the regular 320ms debounced SQLite write.
ipcMain.on('studio:prefs-flush', (event, ownerId, serialized) => {
  try {
    const id=Number(ownerId),payload=String(serialized||'');
    if(!Number.isSafeInteger(id)||id<=0||payload.length>8192||!payload.length)
      throw new Error('Неверные настройки экспорта');
    if(!run('SELECT id FROM accounts WHERE id=?',[id]).length)
      throw new Error('Торговый счёт не найден');
    const value=JSON.parse(payload);
    if(value===null||Array.isArray(value)||typeof value!=='object')
      throw new Error('Неверные настройки экспорта');
    exec('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      ['export_studio_v1_account_'+id,payload]);
    event.returnValue=true;
  }catch(error){event.returnValue=false;}
});

ipcMain.handle('backup:export', async () => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Backup Shelld Statistics',
    defaultPath: `shelld-backup-${new Date().toISOString().slice(0,10)}.sqlite`,
    filters: [{ name: 'SQLite database', extensions: ['sqlite','db'] }]
  });
  if (canceled || !filePath) return { canceled: true };
  persist(); fs.copyFileSync(dbPath, filePath); return { canceled: false, filePath };
});
ipcMain.handle('backup:import', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: 'Restore backup', properties: ['openFile'],
    filters: [{ name: 'SQLite database', extensions: ['sqlite','db'] }]
  });
  if (canceled || !filePaths[0]) return { canceled: true };
  let test;
  try {
    test = new SQL.Database(new Uint8Array(fs.readFileSync(filePaths[0])));
    test.run('SELECT 1 FROM trades LIMIT 1'); test.close();
    persist(); fs.copyFileSync(filePaths[0], dbPath);
    db.close(); db = new SQL.Database(new Uint8Array(fs.readFileSync(dbPath)));
    applyMigrations();
    migrateAccounts();
    stopMt5();
    // A user-initiated restore should never trigger another automatic test-plan wipe.
    db.run("INSERT INTO settings(key,value) VALUES('v063_test_plans_reset','1') ON CONFLICT(key) DO UPDATE SET value='1'");
    db.run("INSERT INTO settings(key,value) VALUES('v069_clean_slate','1') ON CONFLICT(key) DO UPDATE SET value='1'");
    persist();
    return { canceled: false };
  } catch {
    try { if (test) test.close(); } catch {}
    return { canceled: false, error: 'Файл не является корректной резервной копией SQLite.' };
  }
});

function studioScope(scope,tradeId,expectedAccountId){
  if(expectedAccountId!==undefined && Number(expectedAccountId)!==activeAccountId())
    throw new Error('Аккаунт переключился, повтори операцию');
  if(scope!=='trade'&&scope!=='summary')throw new Error('Некорректный раздел результата');
  if(scope==='trade'){
    if(!Number.isSafeInteger(Number(tradeId))||Number(tradeId)<=0)throw new Error('Выбери сделку');
    requireCurrentTrade(tradeId);
  }
  return {scope,tradeId:scope==='trade'?Number(tradeId):null,accountId:activeAccountId()};
}
function studioImageRows(owner, includeBytes=false){
  const fields=includeBytes?'id,mime,image':'id,mime,image';
  const sql=`SELECT ${fields} FROM studio_result_images WHERE account_id=? AND scope=? AND `+
    (owner.scope==='summary'?'trade_id IS NULL':'trade_id=?')+' ORDER BY id';
  return run(sql,owner.scope==='summary'?[owner.accountId,owner.scope]:[owner.accountId,owner.scope,owner.tradeId]);
}
ipcMain.handle('studio-images:list',(_,scope,tradeId,expectedAccountId)=>{
  return studioImageRows(studioScope(scope,tradeId,expectedAccountId)).map(imageData);
});
ipcMain.handle('studio-images:add',(_,scope,tradeId,dataUrl,expectedAccountId)=>{
  const owner=studioScope(scope,tradeId,expectedAccountId),img=validateImageDataURL(dataUrl);
  exec('INSERT INTO studio_result_images(account_id,scope,trade_id,mime,image) VALUES(?,?,?,?,?)',
    [owner.accountId,owner.scope,owner.tradeId,img.mime,img.bytes]);
  return true;
});
ipcMain.handle('studio-images:delete',(_,rawId)=>{
  const id=Number(rawId);
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Скриншот не найден');
  const found=run('SELECT id FROM studio_result_images WHERE id=? AND account_id=?',[id,activeAccountId()])[0];
  if(!found)throw new Error('Скриншот не найден в этом аккаунте');
  exec('DELETE FROM studio_result_images WHERE id=? AND account_id=?',[id,activeAccountId()]);
  return true;
});
// Export a Telegram album without downscaling the original charts. The card is a
// separate PNG; every attached screenshot is preserved as the original bytes.
ipcMain.handle('exports:save-result-album',async(_,coverDataUrl,scope,tradeId,expectedAccountId)=>{
  const owner=studioScope(scope,tradeId,expectedAccountId);
  const cover=validateImageDataURL(coverDataUrl,32*1024*1024);
  if(cover.mime!=='image/png')throw new Error('Карточка должна быть PNG');
  const {canceled,filePaths}=await dialog.showOpenDialog({title:'Папка для публикации Telegram',
    properties:['openDirectory','createDirectory']});
  if(canceled||!filePaths?.[0])return {canceled:true};
  if(owner.accountId!==activeAccountId())throw new Error('Счёт был переключён, повтори экспорт');
  const name='Shelld-Result-'+new Date().toISOString().replace(/[:.]/g,'-');
  const folder=path.join(filePaths[0],name);
  fs.mkdirSync(folder,{recursive:false});
  fs.writeFileSync(path.join(folder,'01-card.png'),Buffer.from(cover.bytes));
  const imgs=studioImageRows(owner,true);
  for(let i=0;i<imgs.length;i++){
    const ext=imgs[i].mime==='image/png'?'png':imgs[i].mime==='image/jpeg'?'jpg':'webp';
    fs.writeFileSync(path.join(folder,`${String(i+2).padStart(2,'0')}-result.${ext}`),Buffer.from(imgs[i].image));
  }
  return {canceled:false,folder,count:imgs.length+1};
});
ipcMain.handle('exports:save-image', async (_, dataUrl, defaultName='shelld-export.png') => {
  if (!String(dataUrl||'').startsWith('data:image/png;base64,')) throw new Error('Некорректное изображение');
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Export image',
    defaultPath: defaultName,
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (canceled || !filePath) return { canceled: true };
  const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return { canceled: false, filePath };
});

ipcMain.handle('trades:export-csv', async () => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: 'shelld-trades.csv', filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return { canceled: true };
  const rows = run('SELECT * FROM trades WHERE account_id=? ORDER BY opened_at',[activeAccountId()]);
  const cols = ['id','opened_at','closed_at','asset','direction','model','trade_type','result','gain_pct','r_multiple','notes'];
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  fs.writeFileSync(filePath, '\uFEFF' + [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\r\n'), 'utf8');
  return { canceled: false, filePath };
});
