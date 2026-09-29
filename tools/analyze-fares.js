/**
 * 分析雙北費率文字的寫法樣態。
 * 目的：在寫「費率翻譯器」之前，先搞清楚實際資料長什麼樣子。
 * 這支只是調查用，不產生任何 App 會用到的檔案。
 */

const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const read = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));

const tpe = read('taipei-lots.json').data.park;
const ntp = read('newtaipei-lots.json');

/** 全形數字/符號轉半形，統一空白 */
function normalize(s) {
  if (!s) return '';
  return String(s)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function section(title) {
  console.log('\n' + '='.repeat(64));
  console.log(title);
  console.log('='.repeat(64));
}

function topValues(list, n = 25) {
  const map = new Map();
  for (const v of list) map.set(v, (map.get(v) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ---------------------------------------------------------------- 台北
section('台北市：費率文字長度分布');
const tpeFares = tpe.map((p) => normalize(p.payex));
const lens = tpeFares.map((s) => s.length).sort((a, b) => a - b);
console.log(`總筆數 ${tpeFares.length}`);
console.log(`空白   ${tpeFares.filter((s) => !s).length}`);
console.log(`最短 ${lens[0]} / 中位 ${lens[Math.floor(lens.length / 2)]} / 最長 ${lens[lens.length - 1]}`);

section('台北市：最常見的費率寫法 Top 25');
for (const [txt, n] of topValues(tpeFares)) {
  console.log(`${String(n).padStart(4)}×  ${txt.slice(0, 110)}`);
}

section('台北市：關鍵詞出現次數');
const KEYWORDS = [
  '計時', '每小時', '元/時', '小時', '半小時', '每半小時', '30分', '15分', '每次',
  '未滿', '以上', '首小時', '第1小時', '第一小時', '逾',
  '平日', '假日', '例假日', '週末', '星期',
  '上限', '最高', '全日', '日間', '夜間', '月租', '免費',
  '身心障礙', '電動', '機車', '小型車', '大型車',
];
for (const k of KEYWORDS) {
  const n = tpeFares.filter((s) => s.includes(k)).length;
  if (n) console.log(`${String(n).padStart(5)}  ${k}`);
}

// ---------------------------------------------------------------- 新北
section('新北市：最常見的費率寫法 Top 25');
const ntpFares = ntp.map((p) => normalize(p.PAYEX));
console.log(`總筆數 ${ntpFares.length} / 空白 ${ntpFares.filter((s) => !s).length}\n`);
for (const [txt, n] of topValues(ntpFares)) {
  console.log(`${String(n).padStart(4)}×  ${txt.slice(0, 110)}`);
}

section('新北市：關鍵詞出現次數');
for (const k of KEYWORDS) {
  const n = ntpFares.filter((s) => s.includes(k)).length;
  if (n) console.log(`${String(n).padStart(5)}  ${k}`);
}

// ---------------------------------------------------------- 複雜度抽樣
section('台北市：最長的 8 筆（最難翻譯的樣本）');
[...tpeFares].sort((a, b) => b.length - a.length).slice(0, 8)
  .forEach((s, i) => console.log(`\n[${i + 1}] ${s.slice(0, 420)}`));
