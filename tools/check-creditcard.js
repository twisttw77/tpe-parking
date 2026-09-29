/**
 * 查證：開放資料裡到底有沒有「信用卡優惠」的資訊？
 *
 * 之前我下結論說「完全沒有」，這支程式重新驗證：
 *   1. 台北市有一個一直沒用到的 FareInfo 欄位，裡面是什麼？
 *   2. 費率文字（payex）裡有沒有提到信用卡、折抵、消費之類的字眼？
 *   3. 其他欄位有沒有藏相關資訊？
 */

const fs = require('fs');
const path = require('path');
const RAW = path.join(__dirname, '..', 'data', 'raw');
const read = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));

const tpe = read('taipei-lots.json').data.park;
const ntp = read('newtaipei-lots.json');

const line = (t) => console.log('\n' + '='.repeat(64) + '\n' + t + '\n' + '='.repeat(64));

// ---------------------------------------------------------------- 1
line('1. 台北市的 FareInfo 欄位裡有東西嗎？');
const withFareInfo = tpe.filter(
  (p) => p.FareInfo && typeof p.FareInfo === 'object' && Object.keys(p.FareInfo).length > 0
);
console.log(`有內容的筆數：${withFareInfo.length} / ${tpe.length}`);
if (withFareInfo.length) {
  console.log('\n前 3 筆範例：');
  withFareInfo.slice(0, 3).forEach((p) => {
    console.log(`\n【${p.name}】`);
    console.log(JSON.stringify(p.FareInfo, null, 2).slice(0, 800));
  });
}

// ---------------------------------------------------------------- 2
line('2. 費率文字裡有沒有提到信用卡相關字眼？');
const KEYS = [
  '信用卡', '刷卡', '悠遊卡', '一卡通', 'icash', '電子票證',
  '折抵', '折扣', '優惠', '消費', '購物', '滿額', '特約',
  '會員', '折價', '免費停車', '兌換',
];

function scan(label, rows, getText, getName) {
  console.log(`\n${label}`);
  console.log('-'.repeat(56));
  let anyHit = false;
  for (const k of KEYS) {
    const hits = rows.filter((r) => String(getText(r) || '').includes(k));
    if (hits.length) {
      anyHit = true;
      console.log(`  ${String(hits.length).padStart(4)} 筆含「${k}」`);
    }
  }
  if (!anyHit) console.log('  （完全沒有命中任何關鍵字）');
  return anyHit;
}

scan('臺北市 payex（費率文字）', tpe, (p) => p.payex);
scan('新北市 PAYEX（費率文字）', ntp, (p) => p.PAYEX);

// 有命中的話，把實際內容印出來看
line('3. 實際命中的內容長什麼樣子？');
const cardHits = tpe.filter((p) =>
  ['信用卡', '刷卡', '悠遊卡', '一卡通', '電子票證', '折抵', '特約', '消費'].some((k) =>
    String(p.payex || '').includes(k)
  )
);
console.log(`臺北市命中 ${cardHits.length} 筆\n`);
cardHits.slice(0, 12).forEach((p, i) => {
  const txt = String(p.payex).replace(/\s+/g, ' ');
  // 只印出關鍵字前後的片段，方便看
  const m = txt.match(/.{0,45}(信用卡|刷卡|悠遊卡|一卡通|電子票證|折抵|特約|消費).{0,70}/);
  console.log(`[${i + 1}] ${p.name}（${p.type2}）`);
  console.log(`    …${m ? m[0] : txt.slice(0, 110)}…\n`);
});

const ntpHits = ntp.filter((p) =>
  ['信用卡', '刷卡', '悠遊卡', '折抵', '特約', '消費'].some((k) =>
    String(p.PAYEX || '').includes(k)
  )
);
console.log(`新北市命中 ${ntpHits.length} 筆`);
ntpHits.slice(0, 6).forEach((p, i) => {
  console.log(`[${i + 1}] ${p.NAME}：${String(p.PAYEX).slice(0, 110)}`);
});

// ---------------------------------------------------------------- 4
line('4. 有沒有其他欄位藏著相關資訊？');
const sample = tpe[0];
console.log('臺北市所有欄位：');
console.log('  ' + Object.keys(sample).join(', '));
console.log('\n新北市所有欄位：');
console.log('  ' + Object.keys(ntp[0]).join(', '));

// Handicap_Discount 這個欄位看起來像折扣相關，檢查一下
const hd = {};
for (const p of tpe) {
  const v = String(p.Handicap_Discount ?? '').trim();
  if (v) hd[v] = (hd[v] || 0) + 1;
}
console.log('\nHandicap_Discount 欄位的值分布（前 8 名）：');
Object.entries(hd).sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([v, n]) => console.log(`  ${String(n).padStart(5)}  ${v.slice(0, 70)}`));
