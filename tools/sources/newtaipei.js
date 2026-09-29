/**
 * 新北市 轉接器
 *
 * 資料來源：新北市資料開放平臺「新北市路外公共停車場資訊」
 *   https://data.ntpc.gov.tw/api/datasets/b1464ef0-9c7c-4a6f-abf7-6bdf32847e68/json
 *
 * 這份資料的特點（和台北市差很多）：
 *   - 欄位名稱全部大寫（NAME / PAYEX / ADDRESS）
 *   - 費率只寫金額，幾乎都沒寫進位規則 → 計費只能用推估的
 *   - 沒有經緯度，只有平面座標，一律要換算
 *   - 沒有任何設施資訊（充電樁、電梯等）
 *   - 一次最多回 1000 筆，要翻頁抓
 */

const { detectChain, clean, num } = require('./_shared');
const { twd97ToWgs84, isInGreaterTaipei } = require('../twd97');
const { parseFare } = require('../fare-parser');

const CITY = '新北市';

function describeOperator(row) {
  const chain = detectChain(row.NAME);
  if (chain) return chain;

  // TYPE 1 = 公有、2 = 民營（依平台說明）
  const t = String(row.TYPE ?? '').trim();
  if (t === '1') return '新北市政府交通局（公有）';
  if (t === '2') return '民營停車場';
  return null;
}

function convert(rows) {
  const out = [];

  for (const row of rows || []) {
    const totalCar = num(row.TOTALCAR);
    if (totalCar <= 0) continue;

    const conv = twd97ToWgs84(row.TW97X, row.TW97Y);
    const ok = conv && isInGreaterTaipei(conv.lat, conv.lng);

    out.push({
      id: `NTP-${clean(row.ID)}`,
      city: CITY,
      name: clean(row.NAME) || '（未命名停車場）',
      operator: describeOperator(row),
      chain: detectChain(row.NAME),
      district: clean(row.AREA),
      address: clean(row.ADDRESS),
      tel: clean(row.TEL),
      lat: ok ? conv.lat : null,
      lng: ok ? conv.lng : null,
      coordFrom: ok ? 'converted' : null,

      totalCar,
      summary: clean(row.SUMMARY),
      serviceTime: clean(row.SERVICETIME),
      category: String(row.TYPE) === '1' ? '公有停車場' : '民營停車場',

      fare: parseFare(row.PAYEX),

      // 新北市這份資料沒有提供設施資訊
      facilities: {},

      // 新北市沒有即時空位資料
      availableCar: null,

      source: 'newtaipei-open-data',
    });
  }

  return out;
}

module.exports = { convert, CITY };
