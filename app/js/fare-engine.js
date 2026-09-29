/**
 * 計費引擎
 * ============================================================
 * 給它「費率規則 + 進場時間 + 出場時間」，算出要付多少錢。
 *
 * 費率規則的格式（自動翻譯出來的、和使用者手動設定的，都用這一種）：
 * {
 *   kind: 'free' | 'hourly' | 'unknown',
 *   fm:  首段幾分鐘        例 60
 *   fp:  首段收多少錢      例 100
 *   um:  之後每幾分鐘一段  例 30
 *   up:  每段收多少錢      例 50
 *   cap: 每日上限（沒有就沒這個欄位）
 *   weekend: { fm, fp, um, up, cap }   假日費率不同時才有
 *   c:   'high' | 'medium' | 'low'     可信度
 * }
 */

(function (global) {
  'use strict';

  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;

  /** 是不是假日（六、日）。國定假日不在判斷範圍內，資料裡也沒有。 */
  function isWeekend(date) {
    const d = date.getDay();
    return d === 0 || d === 6;
  }

  /** 取得某個時間點當天的 00:00 */
  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** 挑出當天該用的費率（平日或假日） */
  function ruleForDate(rule, date) {
    if (rule.weekend && isWeekend(date)) {
      return { ...rule, ...rule.weekend };
    }
    return rule;
  }

  /**
   * 算一段連續停車的費用（不考慮跨日、不考慮上限）
   *
   * 規則：先收「首段」的錢，超過首段之後，每滿一個「單位」收一次錢，
   *      不滿一個單位也算一個單位（這就是「不滿半小時以半小時計」的意思）。
   */
  function feeForMinutes(r, minutes) {
    if (minutes <= 0) return 0;

    const fm = r.fm > 0 ? r.fm : 60;
    const fp = r.fp >= 0 ? r.fp : 0;
    const um = r.um > 0 ? r.um : fm;
    const up = r.up >= 0 ? r.up : fp;

    if (minutes <= fm) return fp;

    const rest = minutes - fm;
    const units = Math.ceil(rest / um);
    return fp + units * up;
  }

  /**
   * 主要進入點：算出停車費
   *
   * @param {object} rule  費率規則
   * @param {number|Date} startAt 進場時間
   * @param {number|Date} endAt   出場時間
   * @param {object} [opts]
   * @param {number} [opts.discountMinutes] 信用卡等優惠折抵幾分鐘
   * @returns {{amount:number|null, minutes:number, billedMinutes:number,
   *           detail:string, capped:boolean, days:Array, discountMinutes:number}}
   *          amount 為 null 代表「算不出來」（費率不明），不是 0 元
   */
  function calcFee(rule, startAt, endAt, opts = {}) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const minutes = Math.max(0, Math.ceil((end - start) / MIN));

    // 折抵：把折抵的時數從停車時間裡扣掉再計費
    // （台灣停車場的折抵券通常就是這個意思：前 N 小時不收錢）
    const discountMinutes = Math.max(0, Math.round(opts.discountMinutes || 0));
    const billEnd = new Date(end.getTime() - discountMinutes * MIN);
    const billedMinutes = Math.max(0, Math.ceil((billEnd - start) / MIN));

    const base = { minutes, billedMinutes, discountMinutes };

    if (!rule || rule.kind === 'unknown') {
      return { ...base, amount: null, detail: '這個停車場的費率還沒設定', capped: false, days: [] };
    }
    if (rule.kind === 'free') {
      return { ...base, amount: 0, detail: '免費停車', capped: false, days: [] };
    }
    // 折抵時數已經涵蓋整段停車 → 不用付錢
    if (billedMinutes <= 0) {
      return {
        ...base, amount: 0, capped: false, days: [],
        detail: '優惠折抵已涵蓋全部停車時間',
      };
    }

    // 沒有每日上限、也沒有假日費率 → 整段一次算完，最單純
    const needSplit = rule.cap != null || rule.weekend;
    if (!needSplit) {
      const r = rule;
      const amount = feeForMinutes(r, billedMinutes);
      return {
        ...base,
        amount,
        detail: describeRule(r),
        capped: false,
        days: [{ from: start, to: billEnd, minutes: billedMinutes, amount, capped: false }],
      };
    }

    // 有上限或平假日差異 → 以每天 00:00 為界切開，一天一天算
    // （「隔日另計」是台灣停車場的通例，每天的首段也重新起算）
    const days = [];
    let cursor = new Date(start);
    let total = 0;
    let anyCapped = false;
    let guard = 0;

    while (cursor < billEnd && guard++ < 400) {
      const dayEnd = new Date(startOfDay(cursor).getTime() + DAY);
      const segEnd = dayEnd < billEnd ? dayEnd : billEnd;
      const segMin = Math.max(0, Math.ceil((segEnd - cursor) / MIN));

      const r = ruleForDate(rule, cursor);
      let segFee = feeForMinutes(r, segMin);

      let capped = false;
      if (r.cap != null && segFee > r.cap) {
        segFee = r.cap;
        capped = true;
        anyCapped = true;
      }

      days.push({ from: new Date(cursor), to: new Date(segEnd), minutes: segMin, amount: segFee, capped });
      total += segFee;
      cursor = segEnd;
    }

    return {
      ...base,
      amount: total,
      detail: describeRule(ruleForDate(rule, start)),
      capped: anyCapped,
      days,
    };
  }

  /** 把規則翻成一句白話 */
  function describeRule(r) {
    if (!r) return '';
    if (r.kind === 'free') return '免費停車';
    if (r.kind === 'unknown') return '費率未設定';

    const unit = (m) => (m === 60 ? '1 小時' : m === 30 ? '半小時' : `${m} 分鐘`);
    const same = r.fm === r.um && r.fp === r.up;

    let s = same
      ? `每 ${unit(r.um)} ${r.up} 元`
      : `前 ${unit(r.fm)} ${r.fp} 元，之後每 ${unit(r.um)} ${r.up} 元`;

    if (r.cap != null) s += `，每日上限 ${r.cap} 元`;
    return s;
  }

  /** 把分鐘數寫成「1 小時 30 分鐘」 */
  function formatDuration(minutes) {
    const m = Math.max(0, Math.round(minutes));
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h === 0) return `${mm} 分鐘`;
    if (mm === 0) return `${h} 小時`;
    return `${h} 小時 ${mm} 分鐘`;
  }

  /** 把毫秒寫成 00:00:00 */
  function formatClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  /**
   * 把「自動翻譯出來的費率」轉成使用者在設定畫面看到的欄位
   * （兩者其實是同一種格式，這裡只是補上預設值）
   */
  function toEditable(fare) {
    const f = fare || {};
    return {
      kind: f.kind || 'unknown',
      fm: f.fm ?? 60,
      fp: f.fp ?? 0,
      um: f.um ?? 30,
      up: f.up ?? 0,
      cap: f.cap ?? null,
      weekend: f.weekend ? { ...f.weekend } : null,
      c: f.c || 'low',
    };
  }

  /** 可信度的中文說明（給畫面上的標籤用） */
  const CONFIDENCE_LABEL = {
    high: { text: '費率明確', tone: 'ok', tip: '官方資料寫明了計費與進位方式' },
    medium: { text: '進位為推估', tone: 'warn', tip: '官方只寫了金額，沒寫不滿一小時怎麼算，這裡採用較保守（估高）的算法' },
    low: { text: '費率待確認', tone: 'alert', tip: '這個停車場有平假日或時段差異，自動估算可能不準，建議點進去確認' },
  };

  global.FareEngine = {
    calcFee,
    feeForMinutes,
    describeRule,
    formatDuration,
    formatClock,
    toEditable,
    isWeekend,
    CONFIDENCE_LABEL,
  };
})(typeof window !== 'undefined' ? window : globalThis);
