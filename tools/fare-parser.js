/**
 * 費率翻譯器
 * ============================================================
 * 把政府開放資料裡「用中文寫的費率說明」翻譯成電腦能計算的規則。
 *
 * 例如把這句話：
 *   「計時:小型車100元/時,停車未滿1小時以1小時計,逾1小時以上,未滿半小時以半小時計。」
 * 翻譯成：
 *   首段 60 分鐘收 100 元，之後每 30 分鐘收 50 元
 *
 * 翻譯不出來的就誠實標成 unknown，讓使用者自己設定，絕不亂猜。
 */

// ============================================================
// 費率規則的資料格式（App 和這支程式共用同一種格式）
// ============================================================
//
// {
//   kind: 'free' | 'hourly' | 'unknown',
//   firstMin:    首段幾分鐘       (例 60)
//   firstPrice:  首段收多少錢     (例 100)
//   unitMin:     之後每幾分鐘一段 (例 30)
//   unitPrice:   每段收多少錢     (例 50)
//   dailyCap:    每日上限，沒有就是 null
//   confidence:  'high' | 'medium' | 'low'
//   note:        給人看的白話說明
//   raw:         政府資料的原文（一字不改，方便使用者對照）
// }

/** 全形轉半形、統一標點與空白 */
function normalize(s) {
  if (!s) return '';
  return String(s)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/[，､]/g, ',')
    .replace(/[；]/g, ';')
    .replace(/[：]/g, ':')
    .replace(/[。]/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把數字字串轉成整數，處理 "1,000" 這種千分位 */
function toNum(s) {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * 移除「月租」相關的片段。
 * 月租金額動輒數千元，如果不先拿掉，會被誤認成計時費率。
 */
function stripMonthly(text) {
  let t = text;
  // 「月租:小型車全日10,000元/月。」整段拿掉（到句號或字串結尾）
  t = t.replace(/月租[^.]*(\.|$)/g, ' ');
  // 「;月租 全日10,000元」分號後的月租段
  t = t.replace(/;\s*月租[^;]*/g, ' ');
  // 剩餘零星的「月票」「元/月」片語
  t = t.replace(/[^,;.]*月票[^,;.]*/g, ' ');
  t = t.replace(/[^,;.]*元\/月[^,;.]*/g, ' ');
  return t;
}

/**
 * 移除「附加費用」的片段。
 * 例如「停放於充電格位之車輛，加收10元/時」——
 * 這是額外加價，不是主要費率，不先拿掉會被誤認成停車費。
 */
function stripSurcharge(text) {
  return text.replace(/[^,;.]*(?:加收|另加|加計|另收|加價)[^,;.]*/g, ' ');
}

/**
 * 找出「小型車」的每小時費率。
 * 難點：同一句話裡常混著機車、大型車的費率，必須只取小型車的。
 */
function findHourlyRate(text) {
  // 情況 A：「小型車」之後緊接著金額，例如
  //   小型車100元/時 ／ 小型車:計時 100元/時 ／ 小型車(含大型重型機車)20元/時
  const nearCar = text.match(
    /小型車(?:\([^)]*\))?[^,;.]{0,12}?(\d[\d,]*)\s*元\s*\/\s*時/
  );
  if (nearCar) return { price: toNum(nearCar[1]), how: '小型車時薪' };

  // 情況 B：新北格式「小型車計時80元」
  const ntpc = text.match(/小型車計時\s*(\d[\d,]*)\s*元/);
  if (ntpc) return { price: toNum(ntpc[1]), how: '小型車計時' };

  // 情況 C：「計時:40元(08-22)」這種沒寫「/時」的寫法
  const afterKeyword = text.match(
    /計時\s*:?\s*(?:小型車)?(?:\([^)]*\))?\s*(\d[\d,]*)\s*元(?!\s*\/\s*月)/
  );
  if (afterKeyword) return { price: toNum(afterKeyword[1]), how: '計時後接金額' };

  // 情況 D：整句只有一個時薪，而且沒提到機車 → 視為小型車的
  if (!/機車/.test(text)) {
    const only = text.match(/(\d[\d,]*)\s*元\s*\/\s*時/);
    if (only) return { price: toNum(only[1]), how: '單一時薪' };
    const perHour = text.match(/每小時\s*(\d[\d,]*)\s*元/);
    if (perHour) return { price: toNum(perHour[1]), how: '每小時' };
  }

  return null;
}

/**
 * 判斷進位方式（這是計費最關鍵、也最容易算錯的地方）。
 * 回傳 { firstMin, unitMin, label, confidence }
 */
function findRounding(text) {
  const hasFirstHour = /未滿\s*1\s*小時以\s*1\s*小時計/.test(text);
  const hasHalfAfter = /未滿半小時以半小時計/.test(text);
  const wholeHalf = /全程以半小時計/.test(text);
  const wholeHour = /全程以1?小時計/.test(text);

  // 「未滿1小時以1小時計，逾1小時以上，未滿半小時以半小時計」
  if (hasFirstHour && hasHalfAfter) {
    return {
      firstMin: 60, unitMin: 30, confidence: 'high',
      label: '第一小時以一小時計，之後每半小時計',
    };
  }
  // 只寫了「未滿1小時以1小時計」
  if (hasFirstHour) {
    return {
      firstMin: 60, unitMin: 60, confidence: 'high',
      label: '不滿一小時以一小時計',
    };
  }
  // 「停車全程以半小時計」
  if (wholeHalf) {
    return {
      firstMin: 30, unitMin: 30, confidence: 'high',
      label: '全程以半小時計',
    };
  }
  if (wholeHour) {
    return {
      firstMin: 60, unitMin: 60, confidence: 'high',
      label: '全程以一小時計',
    };
  }
  // 「全程以15分鐘計」「以30分計」這類
  const everyN = text.match(/全程以\s*(\d+)\s*分/);
  if (everyN) {
    const m = toNum(everyN[1]);
    return {
      firstMin: m, unitMin: m, confidence: 'high',
      label: `全程以 ${m} 分鐘計`,
    };
  }

  // 完全沒寫進位規則（新北市絕大多數屬於這種）
  return {
    firstMin: 60, unitMin: 30, confidence: 'medium',
    label: '原始資料沒有寫進位方式，暫時用「第一小時以一小時計、之後每半小時計」估算',
  };
}

/**
 * 偵測「複雜費率」。
 * 只要有下列任何一種情況，自動估算就很可能算錯，必須降為 low 並提醒使用者：
 *   - 分時段不同價（日間/夜間、展覽期間）
 *   - 平日假日不同價
 *   - 分區不同價
 *   - 階梯式（第 3 小時起改價）
 *   - 按次計費
 */
function detectComplex(text) {
  const reasons = [];

  // 時段費率：(0730-2130) 或 (08-22) 都要認得
  if (/\(\s*\d{1,2}(:\d{2})?\s*[-~]\s*\d{1,2}(:\d{2})?\s*\)/.test(text) ||
      /\(\s*\d{3,4}\s*[-~]\s*\d{3,4}\s*\)/.test(text)) {
    reasons.push('不同時段有不同費率');
  }
  // 日間 / 夜間
  if (/日間|夜間|白天|深夜/.test(text)) reasons.push('日間與夜間費率不同');

  // 平假日：「平日」「假日」以及「週一至週五」「星期六」等寫法
  if (/平日|假日|例假日|週末/.test(text) ||
      /[週周星期][一二三四五六日天]/.test(text)) {
    reasons.push('平日與假日費率不同');
  }
  // 特殊期間
  if (/展覽|活動期間|特定期間|尖峰|離峰/.test(text)) reasons.push('特殊期間另有費率');

  // 分區
  if (/[A-Z]\s*區/.test(text) || /地下\s*\d+\s*層.*元/.test(text)) reasons.push('不同區域費率不同');

  // 階梯：第3小時起、2小時內
  if (/第\s*\d+\s*小時(起|後)/.test(text) || /\d+\s*小時內/.test(text)) {
    reasons.push('停越久單價會變');
  }
  // 按次計費
  if (/元\s*\/\s*次|計次|每次/.test(text)) reasons.push('部分情況採按次計費');

  return reasons;
}

/**
 * 解析「時段費率」：同一天不同時間收不同價。
 *
 * 台北市的寫法有兩種順序：
 *   金額在前：40元/時(09-21)，30元/時(21-09)
 *   時段在前：(10時~22時)50元/時，(22時~10時)10元/時
 *
 * @returns {Array<{from:number, to:number, hourly:number}>|null}
 */
function parseTimeBands(text) {
  const bands = [];
  const seen = new Set();

  const push = (from, to, rate) => {
    from = Number(from); to = Number(to); rate = Number(rate);
    if (![from, to, rate].every(Number.isFinite)) return;
    if (from > 24 || to > 24 || rate <= 0 || rate > 500) return;
    to = to === 0 ? 24 : to;
    from = from === 24 ? 0 : from;
    if (from === to) return;
    const key = `${from}-${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    bands.push({ from, to, hourly: rate });
  };

  // 金額在前：「40元/時(09-21)」
  const reA = /(\d[\d,]*)\s*元\s*\/\s*時\s*[（(]\s*(\d{1,2})\s*時?\s*[-~至]\s*(\d{1,2})\s*時?\s*[)）]/g;
  for (const m of text.matchAll(reA)) push(m[2], m[3], m[1]);

  // 時段在前：「(10時~22時)50元/時」
  const reB = /[（(]\s*(\d{1,2})\s*時?\s*[-~至]\s*(\d{1,2})\s*時?\s*[)）]\s*(\d[\d,]*)\s*元\s*\/\s*時/g;
  for (const m of text.matchAll(reB)) push(m[1], m[2], m[3]);

  // 至少要兩個時段才算「時段費率」，只有一個就不是
  if (bands.length < 2) return null;

  // 檢查時段有沒有重疊。
  // 重疊代表原文其實是「好幾套時段表」（例如週一至週四一套、週五至週日另一套），
  // 把它們混在一起算出來的錢會是錯的，這種情況寧可不解析。
  const covered = new Array(24).fill(0);
  for (const b of bands) {
    if (b.from < b.to) {
      for (let h = b.from; h < b.to; h++) covered[h]++;
    } else {
      for (let h = b.from; h < 24; h++) covered[h]++;
      for (let h = 0; h < b.to; h++) covered[h]++;
    }
  }
  if (covered.some((c) => c > 1)) return null;

  return bands.sort((a, b) => a.from - b.from);
}

/**
 * 解析「平日與假日不同價」。
 * 寫法：週一至週五20元/時，週六至週日30元/時
 * @returns {{weekday:number, weekend:number}|null}
 */
function parseWeekdayWeekend(text) {
  // 平日
  const wd = text.match(
    /[週周星期][一1]\s*[-~至到]\s*[週周星期]?[五5][^,;.，。]{0,10}?(\d[\d,]*)\s*元\s*\/?\s*時/
  );
  // 假日（週六、週日、例假日、國定假日）
  const we = text.match(
    /[週周星期][六6][^,;.，。]{0,30}?(\d[\d,]*)\s*元\s*\/?\s*時/
  );

  if (!wd || !we) return null;
  const weekday = toNum(wd[1]);
  const weekend = toNum(we[1]);
  if (!weekday || !weekend || weekday === weekend) return null;
  if (weekday > 500 || weekend > 500) return null;
  return { weekday, weekend };
}

/** 找每日收費上限 */
function findDailyCap(text) {
  // 「當日單次停車最高收費上限20元/次」「每日上限200元」「全日最高300元」
  const m =
    text.match(/(?:當日|每日|全日|單日)[^,;.]{0,12}?上限\s*(\d[\d,]*)\s*元/) ||
    text.match(/上限\s*(\d[\d,]*)\s*元/) ||
    text.match(/(?:當日|每日|全日|單日)[^,;.]{0,8}?最高\s*(?:收費)?\s*(\d[\d,]*)\s*元/);
  if (!m) return null;

  const v = toNum(m[1]);
  // 上限若明顯是月租等級的數字，視為誤判
  if (v == null || v < 10 || v > 3000) return null;
  return v;
}

/** 判斷是不是免費停車場 */
function isFree(text) {
  if (!text) return false;
  // 「小型車免費」「免費停車場」，但要排除「免費停車:機車」這種只有機車免費的
  if (/小型車免費/.test(text)) return true;
  if (/^[^,;.]*免費[^,;.]*$/.test(text) && !/機車/.test(text)) return true;
  if (/免費/.test(text) && !/元/.test(text)) return true;
  return false;
}

/**
 * 主要進入點：把一段費率文字翻譯成規則
 * @param {string} rawText 政府資料的費率原文
 * @returns {object} 費率規則
 */
function parseFare(rawText) {
  const raw = rawText == null ? '' : String(rawText);
  const base = {
    raw,
    kind: 'unknown',
    firstMin: null, firstPrice: null,
    unitMin: null, unitPrice: null,
    dailyCap: null,
    confidence: 'low',
    note: '',
  };

  const text = normalize(raw);
  if (!text || text === ';' || text === '.') {
    return { ...base, note: '原始資料沒有費率說明' };
  }

  if (isFree(text)) {
    return {
      ...base, kind: 'free', confidence: 'high',
      note: '免費停車',
    };
  }

  const body = stripSurcharge(stripMonthly(text));
  const rate = findHourlyRate(body);

  if (!rate || !rate.price) {
    // 抓不到小型車的計時費率。可能是只有月租、或寫法太特殊
    const onlyMonthly = /月租/.test(text) && !/計時/.test(text);
    return {
      ...base,
      note: onlyMonthly
        ? '這個停車場只有月租，沒有計時收費'
        : '看不懂費率的寫法，請手動設定',
    };
  }

  const round = findRounding(body);
  const cap = findDailyCap(text);

  // 試著讀出時段費率與平假日費率
  const bands = parseTimeBands(body);
  const wdwe = parseWeekdayWeekend(body);

  // 首段價格 = 時薪 ×（首段長度 ÷ 60），單位價格 = 時薪 ×（單位長度 ÷ 60）
  const firstPrice = Math.round((rate.price * round.firstMin) / 60);
  const unitPrice = Math.round((rate.price * round.unitMin) / 60);

  // 判定可信度
  //   high   規則寫得完整明確，可以放心使用
  //   medium 時薪明確，但進位方式是用常見規則推估的
  //   low    有時段/平假日/分區等變化，自動估算很可能不準
  let complexReasons = detectComplex(body);
  let confidence = round.confidence;

  const out = {
    raw,
    kind: 'hourly',
    firstMin: round.firstMin,
    firstPrice,
    unitMin: round.unitMin,
    unitPrice,
    dailyCap: cap,
    hourly: rate.price,
  };

  // 「時段費率」和「平假日費率」同時出現時，組合方式太多變，
  // 硬解容易算錯，寧可維持標示為需人工確認。
  const bothVary = bands && wdwe;

  if (!bothVary && bands) {
    out.bands = bands;
    // 讀懂了就不再算它「複雜」
    complexReasons = complexReasons.filter((r) => r !== '不同時段有不同費率' && r !== '日間與夜間費率不同');
  }

  if (!bothVary && wdwe) {
    // 平日用原本解析到的規則，假日換成假日時薪
    out.firstPrice = Math.round((wdwe.weekday * round.firstMin) / 60);
    out.unitPrice = Math.round((wdwe.weekday * round.unitMin) / 60);
    out.hourly = wdwe.weekday;
    out.weekend = {
      firstMin: round.firstMin,
      firstPrice: Math.round((wdwe.weekend * round.firstMin) / 60),
      unitMin: round.unitMin,
      unitPrice: Math.round((wdwe.weekend * round.unitMin) / 60),
      hourly: wdwe.weekend,
    };
    complexReasons = complexReasons.filter((r) => r !== '平日與假日費率不同');
  }

  if (complexReasons.length) confidence = 'low';

  const notes = [round.label];
  if (cap) notes.push(`每日上限 ${cap} 元`);
  if (out.bands) notes.push(`分 ${out.bands.length} 個時段計費`);
  if (out.weekend) notes.push(`假日每小時 ${out.weekend.hourly} 元`);
  if (complexReasons.length) {
    notes.push(`⚠ ${complexReasons.join('、')}，自動估算可能不準，建議手動確認`);
  }

  out.confidence = confidence;
  out.complexReasons = complexReasons;
  out.note = notes.join('；');
  return out;
}

module.exports = {
  parseFare, normalize, stripMonthly, stripSurcharge,
  findHourlyRate, findRounding, findDailyCap, isFree, detectComplex,
  parseTimeBands, parseWeekdayWeekend,
};
