/**
 * 各縣市轉接器共用的工具
 *
 * 「轉接器」的用途：每個縣市的開放資料格式都不一樣
 * （欄位名稱不同、檔案格式不同、座標系統不同），
 * 每個縣市配一個轉接器把它翻譯成 App 認得的同一種格式。
 * 要加新縣市時只要多寫一個轉接器，App 本身完全不用改。
 */

/**
 * 已知的連鎖停車場品牌
 *
 * ⚠ 只列「實際比對過資料、確定不會誤判」的品牌。
 * 曾經試過加入「中興」「順停」，結果抓到的全是誤判
 *   中興 → 中興北停車場、聯合醫院中興院區（是路名和地名）
 *   順停 → 振順、昇順、福順停車場（是店名的一部分）
 * 所以品牌名一定要夠長、夠獨特，寧可少抓也不要抓錯。
 */
const CHAINS = [
  { match: '台灣聯通', name: '台灣聯通' },
  { match: '臺灣聯通', name: '台灣聯通' },  // 統一寫成「台」
  { match: '嘟嘟房', name: '嘟嘟房' },
  { match: '俥亭', name: '俥亭' },
  { match: '歐特儀', name: '歐特儀' },
  { match: '便利停車場', name: '便利停車場' },
];

/**
 * 從停車場名稱判斷是哪個連鎖品牌
 * @returns {string|null}
 */
function detectChain(name) {
  if (!name) return null;
  for (const c of CHAINS) {
    if (name.includes(c.match)) return c.name;
  }
  return null;
}

/** 清理字串：去頭尾空白、把空字串當成 null */
function clean(s) {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t === '' || t === '-' || t === '無' ? null : t;
}

/** 轉成數字，失敗回傳 0 */
function num(v) {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/** 台北市資料用 "0"/"1" 表示有無 */
function flag(v) {
  return v === '1' || v === 1 || v === true;
}

module.exports = { CHAINS, detectChain, clean, num, flag };
