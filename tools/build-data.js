/**
 * 產生 App 要用的停車場資料檔
 *
 * 流程：讀取 data/raw/ 的原始檔 → 各縣市轉接器翻譯成統一格式
 *      → 合併、排序 → 輸出 app/data/parking.js
 *
 * 輸出成 .js 而不是 .json 是刻意的：
 * 這樣直接用瀏覽器打開 index.html（不用架伺服器）也能讀到資料。
 */

const fs = require('fs');
const path = require('path');

const taipei = require('./sources/taipei');
const newtaipei = require('./sources/newtaipei');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT_DIR = path.join(ROOT, 'app', 'data');
const OUT_FILE = path.join(OUT_DIR, 'parking.js');

const read = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));

/**
 * 精簡輸出：3000 多筆資料如果照原樣存，檔案會接近 3MB，
 * 手機第一次打開要等很久。這裡把「空的、假的、算得出來的」欄位全部拿掉。
 * App 讀取時會自動補回預設值。
 */
function compact(lot) {
  const o = {};

  // 空值一律不存
  for (const [k, v] of Object.entries(lot)) {
    if (v == null || v === '' || k === 'fare' || k === 'facilities') continue;
    o[k] = v;
  }

  // 座標只留小數 5 位（誤差約 1 公尺，遠小於資料本身的誤差）
  if (o.lat != null) o.lat = Number(o.lat.toFixed(5));
  if (o.lng != null) o.lng = Number(o.lng.toFixed(5));

  // 設施只留「有」的，沒有的不佔空間
  const fac = Object.entries(lot.facilities || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  if (fac.length) o.fac = fac;

  // 費率：note 不存（App 會依規則自己組出說明文字）
  const f = lot.fare || {};
  const fare = { kind: f.kind };
  if (f.kind === 'hourly') {
    fare.fm = f.firstMin;
    fare.fp = f.firstPrice;
    fare.um = f.unitMin;
    fare.up = f.unitPrice;
    if (f.dailyCap != null) fare.cap = f.dailyCap;
    if (f.hourly != null) fare.hr = f.hourly;
    fare.c = f.confidence;
    if (f.complexReasons?.length) fare.why = f.complexReasons;
  }
  // 費率原文一定要保留：詳情頁要原封不動顯示給使用者對照
  if (f.raw) fare.raw = f.raw;
  o.fare = fare;

  return o;
}

function main() {
  console.log('讀取原始資料...');
  const tpeRaw = read('taipei-lots.json');
  const tpeAvail = (() => {
    try { return read('taipei-available.json'); } catch { return null; }
  })();
  const ntpRaw = read('newtaipei-lots.json');

  console.log('翻譯成統一格式...');
  const lots = [
    ...taipei.convert(tpeRaw, tpeAvail),
    ...newtaipei.convert(ntpRaw),
  ];

  // 依縣市、行政區、名稱排序，讓清單順序穩定
  lots.sort((a, b) =>
    (a.city || '').localeCompare(b.city, 'zh-Hant') ||
    (a.district || '').localeCompare(b.district || '', 'zh-Hant') ||
    (a.name || '').localeCompare(b.name || '', 'zh-Hant')
  );

  // ---------------- 統計 ----------------
  const stat = {
    產生時間: new Date().toISOString(),
    總數: lots.length,
    臺北市: lots.filter((l) => l.city === '臺北市').length,
    新北市: lots.filter((l) => l.city === '新北市').length,
    有座標: lots.filter((l) => l.lat != null).length,
    有即時空位: lots.filter((l) => l.availableCar != null).length,
    費率_規則明確: lots.filter((l) => l.fare.kind === 'hourly' && l.fare.confidence === 'high').length,
    費率_進位推估: lots.filter((l) => l.fare.kind === 'hourly' && l.fare.confidence === 'medium').length,
    費率_需確認: lots.filter((l) => l.fare.kind === 'hourly' && l.fare.confidence === 'low').length,
    費率_免費: lots.filter((l) => l.fare.kind === 'free').length,
    費率_需手動設定: lots.filter((l) => l.fare.kind === 'unknown').length,
  };

  const chains = {};
  for (const l of lots) if (l.chain) chains[l.chain] = (chains[l.chain] || 0) + 1;

  // ---------------- 輸出 ----------------
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const header = `/**
 * 停車場資料（由 tools/build-data.js 自動產生，請勿手動修改）
 *
 * 產生時間：${new Date().toLocaleString('zh-TW', { hour12: false })}
 * 資料來源：臺北市停車管理工程處、新北市資料開放平臺
 * 停車場數：${lots.length}（臺北 ${stat.臺北市} / 新北 ${stat.新北市}）
 *
 * 要更新資料請執行：node tools/update-all.js
 */
`;

  const body =
    header +
    'window.PARKING_META = ' + JSON.stringify({
      builtAt: stat.產生時間,
      total: lots.length,
      taipei: stat.臺北市,
      newTaipei: stat.新北市,
      withCoords: stat.有座標,
      withLiveAvailability: stat.有即時空位,
    }) + ';\n' +
    'window.PARKING_DATA = ' + JSON.stringify(lots.map(compact)) + ';\n';

  fs.writeFileSync(OUT_FILE, body, 'utf8');

  // ---------------- 報告 ----------------
  const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
  console.log('\n' + '='.repeat(52));
  console.log('完成');
  console.log('='.repeat(52));
  for (const [k, v] of Object.entries(stat)) {
    if (k === '產生時間') continue;
    console.log(`  ${k.padEnd(16, '　')} ${String(v).padStart(6)}`);
  }
  console.log('\n  連鎖品牌據點：');
  for (const [c, n] of Object.entries(chains).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c.padEnd(8, '　')} ${String(n).padStart(4)}`);
  }
  console.log(`\n  輸出檔案：app/data/parking.js（${kb} KB）`);
  console.log('='.repeat(52));
}

main();
