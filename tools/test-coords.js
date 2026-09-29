/**
 * 驗證座標換算的正確性。
 *
 * 方法：台北市有 1,329 筆停車場「同時」提供兩種座標
 *   - tw97x / tw97y（平面座標）
 *   - EntranceCoord（官方給的經緯度）
 * 把平面座標換算成經緯度，和官方值比對，看差幾公尺。
 */

const fs = require('fs');
const path = require('path');
const { twd97ToWgs84, distanceMeters, isInGreaterTaipei } = require('./twd97');

const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'raw', 'taipei-lots.json'), 'utf8')
);
const parks = raw.data.park;

// ---------- 用官方雙座標資料大量驗證 ----------
// 不用單一地標當基準：地標的參考座標本身就不一定準確，
// 拿 1,200 筆官方同時提供的兩種座標互相比對，結論才可靠。
const errors = [];
let compared = 0;
let outOfRange = 0;

for (const p of parks) {
  const info = p.EntranceCoord?.EntrancecoordInfo?.[0];
  if (!info) continue;

  const officialLat = Number(info.Xcod); // 注意：官方把 Xcod 當緯度用
  const officialLng = Number(info.Ycod);
  if (!isInGreaterTaipei(officialLat, officialLng)) continue;

  const got = twd97ToWgs84(p.tw97x, p.tw97y);
  if (!got || !isInGreaterTaipei(got.lat, got.lng)) {
    outOfRange++;
    continue;
  }

  errors.push(distanceMeters(got.lat, got.lng, officialLat, officialLng));
  compared++;
}

errors.sort((a, b) => a - b);
const pct = (q) => errors[Math.floor(errors.length * q)];

console.log('='.repeat(56));
console.log(`比對筆數：${compared}（換算後落在雙北範圍外：${outOfRange}）`);
console.log('-'.repeat(56));
console.log(`  最小誤差    ${errors[0]} 公尺`);
console.log(`  中位數誤差  ${pct(0.5)} 公尺`);
console.log(`  90% 落在    ${pct(0.9)} 公尺以內`);
console.log(`  99% 落在    ${pct(0.99)} 公尺以內`);
console.log(`  最大誤差    ${errors[errors.length - 1]} 公尺`);
console.log('='.repeat(56));

const within50 = errors.filter((e) => e <= 50).length;
console.log(`\n誤差 50 公尺以內：${within50} / ${compared}（${((within50 / compared) * 100).toFixed(1)}%）`);
console.log('（停車場入口和場區中心本來就會有幾十公尺差距，這是正常的）');
