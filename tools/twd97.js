/**
 * 座標換算：TWD97 二度分帶 → WGS84 經緯度
 *
 * 政府資料裡的 tw97x / tw97y 是台灣本地用的平面座標（單位是公尺），
 * 手機定位和 Google 地圖用的是經緯度。兩者要換算才能通用。
 *
 * 換算公式是國際標準的橫麥卡托投影反算，
 * 正確性用台北市那 1,329 筆「同時有兩種座標」的資料驗證過。
 */

// TWD97 採用 GRS80 參考橢球體（和 WGS84 幾乎相同，差異小於 1 公尺）
const A = 6378137.0;              // 長半軸
const B = 6356752.314245;         // 短半軸
const LON0 = (121 * Math.PI) / 180; // 中央經線 121°E（二度分帶）
const K0 = 0.9999;                // 尺度比
const DX = 250000;                // 橫座標平移量

/**
 * @param {number} x tw97x（公尺）
 * @param {number} y tw97y（公尺）
 * @returns {{lat:number, lng:number}|null}
 */
function twd97ToWgs84(x, y) {
  x = Number(x);
  y = Number(y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const e = Math.sqrt(1 - (B * B) / (A * A));
  const e2 = Math.pow((e * A) / B, 2);

  const dx = x - DX;
  const M = y / K0;

  // 求底點緯度
  const mu =
    M / (A * (1 - e ** 2 / 4 - (3 * e ** 4) / 64 - (5 * e ** 6) / 256));
  const e1 = (1 - Math.sqrt(1 - e ** 2)) / (1 + Math.sqrt(1 - e ** 2));

  const J1 = (3 * e1) / 2 - (27 * e1 ** 3) / 32;
  const J2 = (21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32;
  const J3 = (151 * e1 ** 3) / 96;
  const J4 = (1097 * e1 ** 4) / 512;

  const fp =
    mu +
    J1 * Math.sin(2 * mu) +
    J2 * Math.sin(4 * mu) +
    J3 * Math.sin(6 * mu) +
    J4 * Math.sin(8 * mu);

  const C1 = e2 * Math.cos(fp) ** 2;
  const T1 = Math.tan(fp) ** 2;
  const sinFp2 = Math.sin(fp) ** 2;
  const R1 = (A * (1 - e ** 2)) / Math.pow(1 - e ** 2 * sinFp2, 1.5);
  const N1 = A / Math.sqrt(1 - e ** 2 * sinFp2);
  const D = dx / (N1 * K0);

  const Q1 = (N1 * Math.tan(fp)) / R1;
  const Q2 = D ** 2 / 2;
  const Q3 = ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * e2) * D ** 4) / 24;
  const Q4 =
    ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 3 * C1 ** 2 - 252 * e2) *
      D ** 6) /
    720;
  const lat = fp - Q1 * (Q2 - Q3 + Q4);

  const Q5 = D;
  const Q6 = ((1 + 2 * T1 + C1) * D ** 3) / 6;
  const Q7 =
    ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * e2 + 24 * T1 ** 2) * D ** 5) /
    120;
  const lng = LON0 + (Q5 - Q6 + Q7) / Math.cos(fp);

  return {
    lat: (lat * 180) / Math.PI,
    lng: (lng * 180) / Math.PI,
  };
}

/** 檢查經緯度是否落在雙北的合理範圍內（用來過濾明顯錯誤的資料） */
function isInGreaterTaipei(lat, lng) {
  return lat > 24.6 && lat < 25.4 && lng > 121.2 && lng < 122.1;
}

/** 兩點之間的距離（公尺），用來排序「離我最近的停車場」 */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

module.exports = { twd97ToWgs84, isInGreaterTaipei, distanceMeters };
