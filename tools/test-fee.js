/**
 * 計費引擎測試
 *
 * 這裡的每一題都對應計劃書第五節「功能 3.4 你要怎麼測試」列出的情境，
 * 所以這支程式跑過，等於那些測試已經自動幫你驗過一遍。
 */

require('../app/js/fare-engine.js');
const { calcFee, formatDuration } = globalThis.FareEngine;

let pass = 0, fail = 0;

/** 從某個基準時間開始停 n 分鐘 */
function at(dateStr, minutes) {
  const s = new Date(dateStr);
  return [s, new Date(s.getTime() + minutes * 60000)];
}

function check(title, rule, [start, end], expected, opts) {
  const got = calcFee(rule, start, end, opts);
  const ok = got.amount === expected;
  if (ok) { pass++; console.log(`✓ ${title} → ${got.amount === null ? '算不出來' : got.amount + ' 元'}`); }
  else {
    fail++;
    console.log(`✗ ${title}`);
    console.log(`   預期 ${expected} 元，實際 ${got.amount} 元（停了 ${formatDuration(got.minutes)}）`);
  }
}

// 週三（平日）與週六（假日）各取一個基準時間
const WED = '2026-09-30T10:00:00';
const SAT = '2026-10-03T10:00:00';

console.log('='.repeat(60));
console.log('一、每小時 20 元，不滿一小時以一小時計');
console.log('='.repeat(60));
// 計劃書：「一開始就該顯示 $20，而不是 $0」
const r20 = { kind: 'hourly', fm: 60, fp: 20, um: 30, up: 10 };
check('剛停好（1 分鐘）', r20, at(WED, 1), 20);
check('停 59 分鐘', r20, at(WED, 59), 20);
check('停 60 分鐘', r20, at(WED, 60), 20);
check('停 61 分鐘（進入第二段）', r20, at(WED, 61), 30);
check('停 90 分鐘', r20, at(WED, 90), 30);
check('停 91 分鐘', r20, at(WED, 91), 40);

console.log('\n' + '='.repeat(60));
console.log('二、首小時 50 元，之後每半小時 20 元');
console.log('='.repeat(60));
// 計劃書列的驗收數字：30 分 → 50、61 分 → 70、91 分 → 90
const rStep = { kind: 'hourly', fm: 60, fp: 50, um: 30, up: 20 };
check('停 30 分鐘', rStep, at(WED, 30), 50);
check('停 61 分鐘', rStep, at(WED, 61), 70);
check('停 91 分鐘', rStep, at(WED, 91), 90);
check('停 121 分鐘', rStep, at(WED, 121), 110);

console.log('\n' + '='.repeat(60));
console.log('三、全程以半小時計（台北常見寫法）');
console.log('='.repeat(60));
// 「200元/時，全程以半小時計」→ 每半小時 100 元
const rHalf = { kind: 'hourly', fm: 30, fp: 100, um: 30, up: 100 };
check('停 1 分鐘', rHalf, at(WED, 1), 100);
check('停 30 分鐘', rHalf, at(WED, 30), 100);
check('停 31 分鐘', rHalf, at(WED, 31), 200);
check('停 60 分鐘', rHalf, at(WED, 60), 200);

console.log('\n' + '='.repeat(60));
console.log('四、每日上限');
console.log('='.repeat(60));
// 計劃書：「設上限 200，入場改到 10 小時前，金額應該卡在 200」
const rCap = { kind: 'hourly', fm: 60, fp: 30, um: 30, up: 15, cap: 200 };
check('停 4 小時（還沒到上限）', rCap, at(WED, 240), 120);
check('停 10 小時（應該卡在上限）', rCap, at(WED, 600), 200);
check('停 20 小時（仍是當天上限）', rCap, at('2026-09-30T02:00:00', 20 * 60), 200);

console.log('\n' + '='.repeat(60));
console.log('五、跨日（計劃書：昨晚 11 點停到今天）');
console.log('='.repeat(60));
// 9/30 23:00 → 10/1 01:00，橫跨兩天，有上限就要分兩天各自算
const crossStart = new Date('2026-09-30T23:00:00');
const crossEnd = new Date('2026-10-01T01:00:00');
// 第一天只停 60 分 → 30 元；第二天停 60 分 → 30 元；合計 60
check('跨日 2 小時（有每日上限，分兩天算）', rCap, [crossStart, crossEnd], 60);

// 沒有上限時，整段連續算：首小時 30 + 之後 3 個半小時 45 = 75
const rNoCap = { kind: 'hourly', fm: 60, fp: 30, um: 30, up: 15 };
check('跨日 2.5 小時（無上限，連續算）', rNoCap,
  [new Date('2026-09-30T23:00:00'), new Date('2026-10-01T01:30:00')], 75);

console.log('\n' + '='.repeat(60));
console.log('六、平日與假日費率不同');
console.log('='.repeat(60));
// 計劃書：「把入場時間改到上個星期六，應該自動套用假日費率」
const rWeekend = {
  kind: 'hourly', fm: 60, fp: 20, um: 30, up: 10, cap: 300,
  weekend: { fm: 60, fp: 60, um: 30, up: 30, cap: 500 },
};
check('平日（週三）停 2 小時', rWeekend, at(WED, 120), 40);
check('假日（週六）停 2 小時', rWeekend, at(SAT, 120), 120);

console.log('\n' + '='.repeat(60));
console.log('七、信用卡優惠折抵');
console.log('='.repeat(60));
// 折抵的意思是「前 N 小時不收錢」，等於把那段時間從停車時間裡扣掉
const D1H = { discountMinutes: 60 };
check('折抵 1 小時，只停 45 分鐘 → 完全免費', r20, at(WED, 45), 0, D1H);
check('折抵 1 小時，停 60 分鐘 → 剛好打平', r20, at(WED, 60), 0, D1H);
check('折抵 1 小時，停 90 分鐘 → 只算 30 分鐘', r20, at(WED, 90), 20, D1H);
check('折抵 1 小時，停 150 分鐘 → 算 90 分鐘', r20, at(WED, 150), 30, D1H);
// 首小時 50、之後半小時 20 的場子，折抵 1 小時後停 2 小時 → 只算 60 分 = 50 元
check('首段制場子，折抵 1 小時、停 2 小時', rStep, at(WED, 120), 50, D1H);
check('折抵 2 小時，停 2 小時 → 免費', rStep, at(WED, 120), 0, { discountMinutes: 120 });
// 有每日上限時，折抵仍要先扣時間再套上限
check('有上限的場子，折抵 1 小時、停 10 小時', rCap, at(WED, 600), 200, D1H);
check('沒勾選折抵時，費用不受影響', r20, at(WED, 90), 30, { discountMinutes: 0 });

console.log('\n' + '='.repeat(60));
console.log('八、時段費率（白天晚上不同價）');
console.log('='.repeat(60));
// 北寧路地下停車場的真實規則：09-21 每小時 40 元，21-09 每小時 30 元，全程半小時計
const rBand = {
  kind: 'hourly', fm: 30, fp: 20, um: 30, up: 20, hourly: 40,
  bands: [{ from: 9, to: 21, hourly: 40 }, { from: 21, to: 9, hourly: 30 }],
};
// 白天 10:00 進場停 2 小時 → 全在 40 元時段 → 40×2 = 80
check('白天 10:00 停 2 小時（全在 40 元時段）', rBand,
  [new Date('2026-09-30T10:00:00'), new Date('2026-09-30T12:00:00')], 80);
// 深夜 23:00 停 2 小時 → 全在 30 元時段 → 30×2 = 60
check('深夜 23:00 停 2 小時（全在 30 元時段）', rBand,
  [new Date('2026-09-30T23:00:00'), new Date('2026-10-01T01:00:00')], 60);
// 20:00 停 2 小時 → 20-21 是 40 元、21-22 是 30 元 → 40+30 = 70
check('20:00 停 2 小時（跨越費率交界）', rBand,
  [new Date('2026-09-30T20:00:00'), new Date('2026-09-30T22:00:00')], 70);
// 08:00 停 2 小時 → 08-09 是 30 元、09-10 是 40 元 → 30+40 = 70
check('08:00 停 2 小時（從夜間費率跨進日間）', rBand,
  [new Date('2026-09-30T08:00:00'), new Date('2026-09-30T10:00:00')], 70);
// 停 10 分鐘 → 進位成 30 分鐘 → 40 × 0.5 = 20
check('白天只停 10 分鐘（要進位成半小時）', rBand,
  [new Date('2026-09-30T10:00:00'), new Date('2026-09-30T10:10:00')], 20);
// 折抵 1 小時後只剩 1 小時要算
check('時段費率 + 折抵 1 小時', rBand,
  [new Date('2026-09-30T10:00:00'), new Date('2026-09-30T12:00:00')], 40, { discountMinutes: 60 });

console.log('\n' + '='.repeat(60));
console.log('九、特殊情況');
console.log('='.repeat(60));
check('免費停車場', { kind: 'free' }, at(WED, 300), 0);
check('費率不明 → 必須回傳「算不出來」而不是 0 元',
  { kind: 'unknown' }, at(WED, 120), null);
check('剛按下開始停車（0 分鐘）', r20, at(WED, 0), 0);

console.log('\n' + '='.repeat(60));
console.log(`通過 ${pass} 題，失敗 ${fail} 題`);
console.log('='.repeat(60));
process.exitCode = fail ? 1 : 0;
