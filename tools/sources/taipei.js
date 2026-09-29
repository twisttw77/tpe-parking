/**
 * 臺北市 轉接器
 *
 * 資料來源：臺北市停車管理工程處公開資料
 *   基本資料　https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json
 *   即時空位　https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_allavailable.json
 *
 * 這份資料的特點：
 *   - 費率文字寫得相當完整，通常有寫進位規則
 *   - 民營連鎖（嘟嘟房、台灣聯通等）也包含在內
 *   - 部分停車場附有官方經緯度，其餘要用平面座標換算
 */

const { detectChain, clean, num, flag } = require('./_shared');
const { twd97ToWgs84, isInGreaterTaipei } = require('../twd97');
const { parseFare } = require('../fare-parser');

const CITY = '臺北市';

/** 把 type2 轉成看得懂的「經營單位」說明 */
function describeOperator(row) {
  const chain = detectChain(row.name);
  if (chain) return chain;

  const t2 = clean(row.type2) || '';
  if (t2.includes('本處自營')) return '臺北市停車管理工程處（自營）';
  if (t2.includes('本處委外')) return '臺北市停車管理工程處（委外經營）';
  if (t2.includes('市屬機關學校委外')) return '市屬機關學校（委外經營）';
  if (t2.includes('市屬機關學校')) return '市屬機關學校';
  if (t2.includes('中央機關學校委外')) return '中央機關學校（委外經營）';
  if (t2.includes('中央機關學校')) return '中央機關學校';
  if (t2.includes('民營')) return '民營停車場';
  return t2 || null;
}

/** 取得經緯度：優先用官方提供的入口座標，沒有才用平面座標換算 */
function resolveLatLng(row) {
  const info = row.EntranceCoord?.EntrancecoordInfo?.[0];
  if (info) {
    // 注意：官方這份資料把緯度放在 Xcod、經度放在 Ycod
    const lat = Number(info.Xcod);
    const lng = Number(info.Ycod);
    if (isInGreaterTaipei(lat, lng)) {
      return { lat, lng, coordFrom: 'official' };
    }
  }

  const conv = twd97ToWgs84(row.tw97x, row.tw97y);
  if (conv && isInGreaterTaipei(conv.lat, conv.lng)) {
    return { lat: conv.lat, lng: conv.lng, coordFrom: 'converted' };
  }

  return { lat: null, lng: null, coordFrom: null };
}

/**
 * @param {object} raw 讀進來的原始 JSON
 * @param {object} rawAvailable 即時空位 JSON（可省略）
 * @returns {Array} 標準格式的停車場陣列
 */
function convert(raw, rawAvailable) {
  const rows = raw?.data?.park || [];

  // 即時空位先做成查表用的對照
  const availMap = new Map();
  for (const a of rawAvailable?.data?.park || []) {
    if (Number(a.availablecar) >= 0) availMap.set(a.id, Number(a.availablecar));
  }

  const out = [];
  for (const row of rows) {
    // App 只做汽車，沒有小型車位的直接略過
    const totalCar = num(row.totalcar);
    if (totalCar <= 0) continue;

    const { lat, lng, coordFrom } = resolveLatLng(row);

    out.push({
      id: `TPE-${clean(row.id)}`,
      city: CITY,
      name: clean(row.name) || '（未命名停車場）',
      operator: describeOperator(row),
      chain: detectChain(row.name),
      district: clean(row.area),
      address: clean(row.address),
      tel: clean(row.tel),
      lat, lng, coordFrom,

      totalCar,
      summary: clean(row.summary),
      serviceTime: clean(row.serviceTime),
      category: clean(row.type2),

      fare: parseFare(row.payex),

      // 這份資料有提供的設施資訊
      facilities: {
        charging: flag(row.ChargingStation),
        accessibleElevator: flag(row.Accessibility_Elevator),
        aed: flag(row.AED_Equipment),
        childPickup: flag(row.Child_Pickup_Area),
        phoneCharge: flag(row.Phone_Charge),
        cellSignal: flag(row.CellSignal_Enhancement),
        handicapFirst: flag(row.Handicap_First),
        pregnancyFirst: flag(row.Pregnancy_First),
        taxiOneHourFree: flag(row.Taxi_OneHR_Free),
      },

      // 即時剩餘車位（先存起來，畫面暫時不顯示）
      availableCar: availMap.has(clean(row.id)) ? availMap.get(clean(row.id)) : null,

      source: 'taipei-open-data',
    });
  }

  return out;
}

module.exports = { convert, CITY };
