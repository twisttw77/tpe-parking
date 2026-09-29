/**
 * 驗證費率翻譯器：
 *  1. 先用手工挑的例子做正確性測試（答案我人工核對過）
 *  2. 再跑過全部 3,182 筆，統計翻譯成功率
 */

const fs = require('fs');
const path = require('path');
const { parseFare } = require('./fare-parser');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const read = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));

// ============================================================
// 第一部分：正確性測試
// ============================================================
const CASES = [
  {
    text: '計時:小型車100元/時,停車未滿1小時以1小時計,逾1小時以上,未滿半小時以半小時計。月租:小型車全日10,000元/月。',
    want: { kind: 'hourly', firstMin: 60, firstPrice: 100, unitMin: 30, unitPrice: 50, dailyCap: null },
    why: '首小時整小時計、之後半小時計；月租一萬不可被誤認',
  },
  {
    text: '計時:小型車200元/時,停車全程以半小時計。月租:小型車全日10,000元/月。',
    want: { kind: 'hourly', firstMin: 30, firstPrice: 100, unitMin: 30, unitPrice: 100 },
    why: '全程半小時計：半小時 100 元',
  },
  {
    text: '小型車:計時 150元/時,停車未滿1小時以1小時計,逾1小時以上,未滿半小時以半小時計;月租 全日10,000元。',
    want: { kind: 'hourly', firstMin: 60, firstPrice: 150, unitMin: 30, unitPrice: 75 },
    why: '台北的第二種寫法（小型車在前）',
  },
  {
    text: '小型車計時80元;小型車月租8000元;',
    want: { kind: 'hourly', hourly: 80, confidence: 'medium' },
    why: '新北格式；時薪明確但進位規則是推估的，可信度必須是 medium',
  },
  {
    // 2026-09-30 抽樣時抓到的誤判：(08-22) 兩位數時段沒被認出來
    text: '計時：小型車週一至週日、展覽期間100元/時(08-22)，週一至週日、非展覽期間70元/時(08-22)、40元/時(22-08)，停車未滿1小時以1小時計，逾1小時以上，未滿半小時以半小時計。',
    want: { kind: 'hourly', confidence: 'low' },
    why: '【回歸測試】展覽期間與日夜時段不同價，即使進位規則寫得很清楚也必須降為 low',
  },
  {
    // 同一批抽樣抓到的誤判：「週六至週日」沒被當成平假日差異
    text: '計時：小型車週六至週日60元/時(06-18)、10元/時(18-06)，停車全程以半小時計。計次：小型車週一至週五50元/次。',
    want: { kind: 'hourly', confidence: 'low' },
    why: '【回歸測試】「週六至週日」「週一至週五」也是平假日差異，必須降為 low',
  },
  {
    text: '小型車月租2500元;',
    want: { kind: 'unknown' },
    why: '只有月租，不能拿 2500 當時薪',
  },
  {
    text: '小型車免費;大型車免費;',
    want: { kind: 'free' },
    why: '免費停車場',
  },
  {
    text: '計時:機車10元/時,當日單次停車最高收費上限20元/次,隔日另計,以00時為基準,停車全程以半小時計,小型車(含大型重型機車):A區至H區 30元/時(0730-2130)、10元/時(2130-0730)。',
    want: { kind: 'hourly', hourly: 30, confidence: 'low' },
    why: '混著機車費率，必須抓小型車的 30 元；有分區與時段所以要降為 low',
  },
  {
    text: '計時:小型車30元(0700-2130)、10元(2130-0700),全程以半小時計。月租:小型車全日5,000元/月。免費停車:機車。',
    want: { confidence: 'low' },
    why: '日夜不同費率，必須降為 low 提醒使用者確認',
  },
  {
    // 2026-09-30 抽樣時抓到的誤判：主費率沒寫「/時」，結果抓到後面的附加費用
    text: '計時:40元(08-22)、20元(22-08)，停放於充電格位之車輛，加收10元/時，依設備自動判斷未充電者再加收10元/時。',
    want: { kind: 'hourly', hourly: 40, confidence: 'low' },
    why: '【回歸測試】要抓主費率 40 元，不可抓到充電格位的「加收10元」',
  },
  {
    text: ';',
    want: { kind: 'unknown' },
    why: '空資料',
  },
];

console.log('='.repeat(64));
console.log('第一部分：正確性測試');
console.log('='.repeat(64));

let pass = 0, fail = 0;
for (const c of CASES) {
  const got = parseFare(c.text);
  const bad = Object.entries(c.want).filter(([k, v]) => got[k] !== v);
  if (bad.length === 0) {
    pass++;
    console.log(`✓ ${c.why}`);
  } else {
    fail++;
    console.log(`✗ ${c.why}`);
    console.log(`   原文：${c.text.slice(0, 80)}`);
    for (const [k, v] of bad) console.log(`   ${k}: 預期 ${v} / 實際 ${got[k]}`);
  }
}
console.log(`\n通過 ${pass} / 失敗 ${fail}`);

// ============================================================
// 第二部分：全量統計
// ============================================================
function report(name, fares) {
  const results = fares.map(parseFare);
  const n = results.length;
  const byKind = {};
  const byConf = {};
  for (const r of results) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    const key = r.kind === 'hourly' ? r.confidence : '-';
    byConf[key] = (byConf[key] || 0) + 1;
  }

  const usable = results.filter((r) => r.kind === 'hourly' || r.kind === 'free').length;
  const high = byConf['high'] || 0;
  const med = byConf['medium'] || 0;
  const low = byConf['low'] || 0;

  console.log(`\n${name}（共 ${n} 筆）`);
  console.log('-'.repeat(52));
  const pct = (v) => `${((v / n) * 100).toFixed(1)}%`;
  console.log(`  可自動計費        ${String(usable).padStart(5)}  ${pct(usable)}`);
  console.log(`    ├ 規則明確       ${String(high).padStart(5)}  ${pct(high)}`);
  console.log(`    ├ 進位方式為推估 ${String(med).padStart(5)}  ${pct(med)}`);
  console.log(`    ├ 費率複雜需確認 ${String(low).padStart(5)}  ${pct(low)}`);
  console.log(`    └ 免費           ${String(byKind['free'] || 0).padStart(5)}  ${pct(byKind['free'] || 0)}`);
  console.log(`  需手動設定        ${String(byKind['unknown'] || 0).padStart(5)}  ${pct(byKind['unknown'] || 0)}`);

  // 哪些原因導致降為「需確認」
  const cx = {};
  for (const r of results) {
    for (const why of r.complexReasons || []) cx[why] = (cx[why] || 0) + 1;
  }
  if (Object.keys(cx).length) {
    console.log('\n  「費率複雜」的原因（可複選）：');
    for (const [why, c] of Object.entries(cx).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(c).padStart(5)}  ${why}`);
    }
  }

  // 看不懂的原因分類
  const reasons = {};
  for (const r of results) {
    if (r.kind === 'unknown') reasons[r.note] = (reasons[r.note] || 0) + 1;
  }
  if (Object.keys(reasons).length) {
    console.log('\n  「需手動設定」的原因：');
    for (const [why, c] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(c).padStart(5)}  ${why}`);
    }
  }
  return results;
}

console.log('\n' + '='.repeat(64));
console.log('第二部分：全量統計');
console.log('='.repeat(64));

const tpe = read('taipei-lots.json').data.park;
const ntp = read('newtaipei-lots.json');

// 只看有小型車車位的停車場（App 只做汽車）
const tpeCar = tpe.filter((p) => Number(p.totalcar) > 0);
const ntpCar = ntp.filter((p) => Number(p.TOTALCAR) > 0);

console.log(`\n（只統計有小型車車位的停車場：台北 ${tpeCar.length} / 新北 ${ntpCar.length}）`);

const rTpe = report('臺北市', tpeCar.map((p) => p.payex));
const rNtp = report('新北市', ntpCar.map((p) => p.PAYEX));

const all = [...rTpe, ...rNtp];
const n = all.length;
const usable = all.filter((r) => r.kind === 'hourly' || r.kind === 'free').length;
const cnt = (c) => all.filter((r) => r.kind === 'hourly' && r.confidence === c).length;
console.log('\n' + '='.repeat(64));
console.log(`總計 ${n} 個停車場`);
const p = (v) => `${((v / n) * 100).toFixed(1)}%`;
console.log(`  可自動計費       ${usable}（${p(usable)}）`);
console.log(`    規則明確       ${cnt('high')}（${p(cnt('high'))}）`);
console.log(`    進位方式為推估 ${cnt('medium')}（${p(cnt('medium'))}）`);
console.log(`    費率複雜需確認 ${cnt('low')}（${p(cnt('low'))}）`);
console.log('='.repeat(64));

// ============================================================
// 第三部分：抽樣人工檢查（每個可信度各抽幾筆，人工核對用）
// ============================================================
function sample(title, rows, getFare, getName, want, limit = 4) {
  console.log(`\n抽樣：${title}`);
  console.log('-'.repeat(64));
  let shown = 0;
  for (const row of rows) {
    const r = parseFare(getFare(row));
    if (r.kind !== 'hourly' || r.confidence !== want) continue;
    console.log(`${getName(row)}`);
    console.log(`  原文：${String(getFare(row)).slice(0, 76)}`);
    console.log(`  翻譯：首 ${r.firstMin} 分 ${r.firstPrice} 元，之後每 ${r.unitMin} 分 ${r.unitPrice} 元`
      + (r.dailyCap ? `，每日上限 ${r.dailyCap} 元` : ''));
    if (r.complexReasons?.length) console.log(`  降級原因：${r.complexReasons.join('、')}`);
    if (++shown >= limit) break;
  }
}

sample('台北 — 規則明確', tpeCar, (p) => p.payex, (p) => p.name, 'high');
sample('台北 — 費率複雜需確認', tpeCar, (p) => p.payex, (p) => p.name, 'low');
sample('新北 — 進位方式為推估', ntpCar, (p) => p.PAYEX, (p) => p.NAME, 'medium');
