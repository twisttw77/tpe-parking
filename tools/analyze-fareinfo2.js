/**
 * FareInfo 第二輪分析
 *
 * 第一輪發現它沒有「多時段費率」，不能拿來解決日夜不同價的問題。
 * 這一輪檢查它有沒有其他用途：
 *   1. CUnit = min / hour 是什麼意思？可能代表計費單位（每 N 分鐘）
 *   2. 收費時段不是 00-24 的，是不是代表「其他時間免費」？
 *   3. 費率文字解析失敗、但 FareInfo 有值的，能不能補救？
 */

const fs = require('fs');
const path = require('path');
const { parseFare } = require('./fare-parser');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const tpe = JSON.parse(fs.readFileSync(path.join(RAW, 'taipei-lots.json'), 'utf8')).data.park;
const line = (t) => console.log('\n' + '='.repeat(66) + '\n' + t + '\n' + '='.repeat(66));

const carRules = (p) =>
  (p.FareInfo?.FareRule || []).filter(
    (r) => String(r.ParkingType) === 'C' && String(r.RateType) === '1'
  );

// ---------------------------------------------------------------- 1
line('1. CUnit = min / hour 是什麼意思？');
const unitRows = [];
for (const p of tpe) {
  for (const r of carRules(p)) {
    if (r.CUnit === 'min' || r.CUnit === 'hour') {
      unitRows.push({ name: p.name, r, payex: String(p.payex).replace(/\s+/g, ' ') });
    }
  }
}
console.log(`小型車計時且 CUnit 有值的：${unitRows.length} 筆\n`);
unitRows.slice(0, 8).forEach((x, i) => {
  console.log(`[${i + 1}] ${x.name}`);
  console.log(`    ${x.r.ChargeableSTime}-${x.r.ChargeableETime}　${x.r.ParkingRates} 元 / ${x.r.CUnit}`);
  console.log(`    原文：${x.payex.slice(0, 110)}\n`);
});

// ---------------------------------------------------------------- 2
line('2. 收費時段不是全天（00-24）的有多少？');
const partial = [];
for (const p of tpe) {
  const rules = carRules(p).filter((r) => !r.CUnit);
  if (rules.length !== 1) continue;
  const r = rules[0];
  const s = String(r.ChargeableSTime), e = String(r.ChargeableETime);
  const full = (s === '00' && (e === '24' || e === '00')) || s === e;
  if (!full) partial.push({ name: p.name, r, payex: String(p.payex).replace(/\s+/g, ' ') });
}
console.log(`只在特定時段收費的：${partial.length} 筆`);
console.log('（如果這代表「其他時間免費」，就能讓計費更準）\n');
partial.slice(0, 8).forEach((x, i) => {
  console.log(`[${i + 1}] ${x.name}`);
  console.log(`    收費時段 ${x.r.ChargeableSTime}:00–${x.r.ChargeableETime}:00　${x.r.ParkingRates} 元`);
  console.log(`    原文：${x.payex.slice(0, 120)}\n`);
});

// ---------------------------------------------------------------- 3
line('3. 費率文字看不懂、但 FareInfo 有值的，能補救嗎？');
const carLots = tpe.filter((p) => Number(p.totalcar) > 0);
const rescuable = [];
for (const p of carLots) {
  const f = parseFare(p.payex);
  if (f.kind !== 'unknown') continue;
  const rules = carRules(p).filter((r) => !r.CUnit);
  if (rules.length) rescuable.push({ name: p.name, rules, payex: String(p.payex).replace(/\s+/g, ' ') });
}
console.log(`可補救的：${rescuable.length} 筆\n`);
rescuable.forEach((x, i) => {
  console.log(`[${i + 1}] ${x.name}`);
  x.rules.forEach((r) => console.log(`    ${r.ChargeableSTime}-${r.ChargeableETime}　${r.ParkingRates} 元`));
  console.log(`    原文：${x.payex.slice(0, 120)}\n`);
});

// ---------------------------------------------------------------- 4
line('4. 總結：FareInfo 能提供多少「文字解析不到」的新資訊？');
let sameAsText = 0, newInfo = 0, conflict = 0;
for (const p of carLots) {
  const rules = carRules(p).filter((r) => !r.CUnit);
  if (rules.length !== 1) continue;
  const f = parseFare(p.payex);
  const rate = Number(rules[0].ParkingRates);

  if (f.kind === 'unknown') newInfo++;
  else if (f.hourly === rate) sameAsText++;
  else conflict++;
}
console.log(`  和文字解析結果一致　 ${sameAsText} 筆（沒有新增價值）`);
console.log(`  文字解析不到、可補上 ${newInfo} 筆`);
console.log(`  和文字解析結果衝突　 ${conflict} 筆（需要判斷相信哪個）`);
