/**
 * 解讀台北市的 FareInfo 欄位
 *
 * 這個欄位是結構化的費率資料（不是自然語言），但官方沒有附說明文件，
 * 所以這支程式用「跟費率文字（payex）互相比對」的方式，
 * 反推出每個代碼是什麼意思。搞清楚之後才能安全地拿來計費。
 */

const fs = require('fs');
const path = require('path');
const RAW = path.join(__dirname, '..', 'data', 'raw');
const tpe = JSON.parse(fs.readFileSync(path.join(RAW, 'taipei-lots.json'), 'utf8')).data.park;

const line = (t) => console.log('\n' + '='.repeat(66) + '\n' + t + '\n' + '='.repeat(66));

const withInfo = tpe.filter((p) => p.FareInfo?.FareRule?.length);
const allRules = withInfo.flatMap((p) =>
  p.FareInfo.FareRule.map((r) => ({ ...r, _name: p.name, _payex: p.payex }))
);

line(`基本統計`);
console.log(`有 FareInfo 的停車場：${withInfo.length} / ${tpe.length}`);
console.log(`費率規則總筆數：${allRules.length}`);

// ---------------------------------------------------------------- 代碼分布
function dist(field) {
  const m = {};
  for (const r of allRules) m[r[field]] = (m[r[field]] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

line('各代碼出現次數');
console.log('ParkingType（車種）:');
dist('ParkingType').forEach(([k, n]) => console.log(`  ${String(k).padEnd(4)} ${String(n).padStart(5)}`));
console.log('\nRateType（費率種類）:');
dist('RateType').forEach(([k, n]) => console.log(`  ${String(k).padEnd(4)} ${String(n).padStart(5)}`));
console.log('\nCUnit（單位）:');
dist('CUnit').forEach(([k, n]) => console.log(`  ${String(k || '(空白)').padEnd(8)} ${String(n).padStart(5)}`));

// ---------------------------------------------------------------- 推測語意
line('推測 RateType 的意思：看每種 RateType 的金額分布');
for (const [rt] of dist('RateType')) {
  const rows = allRules.filter((r) => String(r.RateType) === String(rt));
  const rates = rows.map((r) => Number(r.ParkingRates)).filter(Number.isFinite).sort((a, b) => a - b);
  const mid = rates[Math.floor(rates.length / 2)];
  console.log(`\nRateType ${rt}（${rows.length} 筆）`);
  console.log(`  金額範圍 ${rates[0]} ~ ${rates[rates.length - 1]}，中位數 ${mid}`);
  console.log(`  對照一筆實例：${rows[0]._name}`);
  console.log(`    這筆規則：${rows[0].ParkingType}/${rt} ${rows[0].ChargeableSTime}-${rows[0].ChargeableETime} ${rows[0].ParkingRates}${rows[0].CUnit || ''}`);
  console.log(`    費率原文：${String(rows[0]._payex).replace(/\s+/g, ' ').slice(0, 100)}`);
}

// ---------------------------------------------------------------- 小型車計時
line('重點：小型車的計時費率（ParkingType=C 且 RateType=1）');
const carHourly = withInfo
  .map((p) => ({
    name: p.name,
    payex: String(p.payex).replace(/\s+/g, ' '),
    rules: p.FareInfo.FareRule.filter(
      (r) => String(r.ParkingType) === 'C' && String(r.RateType) === '1' && !r.CUnit
    ),
  }))
  .filter((p) => p.rules.length);

console.log(`有小型車計時費率的停車場：${carHourly.length}`);

const multi = carHourly.filter((p) => p.rules.length > 1);
console.log(`其中有「多個時段不同價」的：${multi.length}  ← 這些正是目前算不準的那批`);

console.log('\n多時段費率的實例（拿來跟費率原文對照，確認解讀正確）:');
multi.slice(0, 6).forEach((p, i) => {
  console.log(`\n[${i + 1}] ${p.name}`);
  p.rules.forEach((r) =>
    console.log(`    ${r.ChargeableSTime}:00–${r.ChargeableETime}:00　${r.ParkingRates} 元`)
  );
  console.log(`    原文：${p.payex.slice(0, 120)}`);
});

// ---------------------------------------------------------------- 一致性檢查
line('一致性檢查：FareInfo 的金額跟費率文字對得起來嗎？');
const single = carHourly.filter((p) => p.rules.length === 1);
let match = 0, mismatch = 0;
const badCases = [];

for (const p of single) {
  const rate = Number(p.rules[0].ParkingRates);
  // 費率文字裡有沒有出現同樣的數字（元/時）
  const inText = new RegExp(`${rate}\\s*元\\s*/\\s*時|計時\\s*[:：]?\\s*(小型車)?\\s*${rate}\\s*元`).test(p.payex);
  if (inText) match++;
  else { mismatch++; if (badCases.length < 5) badCases.push({ ...p, rate }); }
}
console.log(`單一時段的停車場 ${single.length} 筆`);
console.log(`  金額和文字一致　 ${match}（${((match / single.length) * 100).toFixed(1)}%）`);
console.log(`  對不起來　　　　 ${mismatch}`);

if (badCases.length) {
  console.log('\n對不起來的例子（要確認是資料本身不一致，還是我解讀錯）:');
  badCases.forEach((p, i) => {
    console.log(`\n[${i + 1}] ${p.name}`);
    console.log(`    FareInfo 說：${p.rate} 元`);
    console.log(`    原文：${p.payex.slice(0, 130)}`);
  });
}

// ---------------------------------------------------------------- 涵蓋率
line('如果採用 FareInfo，能改善多少？');
const { parseFare } = require('./fare-parser');
const carLots = tpe.filter((p) => Number(p.totalcar) > 0);

let lowNow = 0, lowFixable = 0, unknownNow = 0, unknownFixable = 0;
for (const p of carLots) {
  const f = parseFare(p.payex);
  const rules = (p.FareInfo?.FareRule || []).filter(
    (r) => String(r.ParkingType) === 'C' && String(r.RateType) === '1' && !r.CUnit
  );
  if (f.kind === 'hourly' && f.confidence === 'low') {
    lowNow++;
    if (rules.length) lowFixable++;
  }
  if (f.kind === 'unknown') {
    unknownNow++;
    if (rules.length) unknownFixable++;
  }
}
console.log(`目前「費率複雜需確認」${lowNow} 筆，其中 ${lowFixable} 筆有 FareInfo 可用`);
console.log(`目前「需手動設定」　 ${unknownNow} 筆，其中 ${unknownFixable} 筆有 FareInfo 可用`);
