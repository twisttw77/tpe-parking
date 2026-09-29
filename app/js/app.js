/**
 * TPE Parking — 主程式
 * ============================================================
 * 負責把資料變成畫面，以及所有的操作邏輯。
 */

(function () {
  'use strict';

  const FE = window.FareEngine;
  const ST = window.Store;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const PAGE_SIZE = 24;   // 一次先畫幾張卡片，往下滑再載更多

  const state = {
    tab: 'lots',
    query: '',
    filters: new Set(),
    nearMe: false,
    myPos: null,
    shown: PAGE_SIZE,
    detailId: null,
    range: 'month',
    lots: [],          // 合併後的完整清單
    view: [],          // 篩選排序後要顯示的
  };

  // ============================================================
  // 小工具
  // ============================================================

  /** 把使用者輸入的文字變成安全的 HTML（避免名稱裡的符號破壞版面） */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * 圖示。viewBox 一定要給：圖示的路徑是以 24×24 畫的，
   * 沒有 viewBox 的話在小尺寸會被裁掉，只看到左上角一小塊。
   */
  function icon(name, cls = 'ic') {
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /** 搜尋用的正規化：全形轉半形、臺台互通、去掉空白和標點 */
  function norm(s) {
    return String(s ?? '')
      .toLowerCase()
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/臺/g, '台')
      .replace(/[\s\-–—_()（）,.、。·]/g, '');
  }

  /**
   * 常見的別名與簡寫。
   * 完整的注音輸入容錯需要整套拼音對照表，成本太高；
   * 這裡先covered最常被搜尋的連鎖品牌和簡寫。
   */
  const ALIASES = [
    { keys: ['ㄉㄨㄉㄨ', 'dudu', '嘟嘟'], to: '嘟嘟房' },
    { keys: ['聯通', 'lt', '台聯', '臺聯'], to: '台灣聯通' },
    { keys: ['ㄡㄊㄜ', '歐特'], to: '歐特儀' },
    { keys: ['ㄔㄜㄊㄧㄥˊ', '車亭'], to: '俥亭' },
    { keys: ['北車', '台北車站', '臺北車站'], to: '台北車站' },
    { keys: ['101', '一零一'], to: '台北101' },
  ];

  function expandQuery(q) {
    const n = norm(q);
    for (const a of ALIASES) {
      if (a.keys.some((k) => norm(k) === n || n.includes(norm(k)))) return norm(a.to);
    }
    return n;
  }

  /** 兩點距離（公尺） */
  function distance(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }

  function fmtDistance(m) {
    if (m == null) return '';
    return m < 1000 ? `${m} 公尺` : `${(m / 1000).toFixed(1)} 公里`;
  }

  function fmtDateTime(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 給 <input type="datetime-local"> 用的格式 */
  function toLocalInput(ms) {
    const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }

  /**
   * 判斷現在是否在營業時間內。
   * 開放資料的寫法五花八門，看不懂的一律當成「不確定」（回傳 null），
   * 篩選時不會把它排除掉 —— 寧可多顯示，也不要漏掉你需要的停車場。
   */
  function isOpenNow(serviceTime) {
    if (!serviceTime) return null;
    const s = String(serviceTime).replace(/\s/g, '');

    if (/00:00:00-23:59:59|0~24|00-24|24小時|全天/.test(s)) return true;

    // "7-20" / "08:00-22:00" / "7~20"
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?[-~](\d{1,2})(?::(\d{2}))?/);
    if (!m) return null;

    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const from = (+m[1]) * 60 + (+(m[2] || 0));
    let to = (+m[3]) * 60 + (+(m[4] || 0));
    if (to === 0) to = 24 * 60;

    return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
  }

  // ============================================================
  // 資料層：把官方資料、你的修改、你自建的停車場合併起來
  // ============================================================

  /** 取得一個停車場「套用你的修改之後」的樣子 */
  function applyOverride(lot) {
    const ov = ST.overrides.get(lot.id);
    if (!ov) return lot;
    const merged = { ...lot, ...ov, edited: true };
    // 費率要整包換掉，不能只蓋部分欄位
    if (ov.fare) merged.fare = ov.fare;
    return merged;
  }

  function loadLots() {
    const official = (window.PARKING_DATA || []).map(applyOverride);
    const custom = ST.custom.all().map(applyOverride);
    state.lots = [...custom, ...official];
  }

  function findLot(id) {
    return state.lots.find((l) => l.id === id) || null;
  }

  // ============================================================
  // 篩選與排序
  // ============================================================
  function computeView() {
    const q = state.query.trim();
    const nq = q ? expandQuery(q) : '';
    const favs = new Set(ST.favorites.all());

    let list = state.lots.filter((l) => {
      if (nq) {
        const hay = norm(
          [l.name, l.address, l.operator, l.chain, l.district, l.city].join(' ')
        );
        // 多個關鍵字要全部符合（例如「信義 嘟嘟」）
        const words = q.split(/\s+/).filter(Boolean).map(expandQuery);
        if (!words.every((w) => hay.includes(w))) return false;
      }

      for (const f of state.filters) {
        if (f === 'fav' && !favs.has(l.id)) return false;
        if (f === 'mine' && !l.isCustom) return false;
        if (f === 'cap' && l.fare?.cap == null) return false;
        if (f === 'sure' && !(l.fare?.kind === 'hourly' && l.fare.c === 'high')) return false;
        if (f === 'open' && isOpenNow(l.serviceTime) === false) return false;
        // 信用卡優惠和廁所開放資料沒有提供，是你自己補上去的
        if (f === 'card' && !l.creditCard) return false;
        if (f === 'toilet' && !l.toilet) return false;
      }
      return true;
    });

    if (state.nearMe && state.myPos) {
      const { lat, lng } = state.myPos;
      list = list
        .map((l) => ({
          ...l,
          _d: l.lat != null ? distance(lat, lng, l.lat, l.lng) : null,
        }))
        .sort((a, b) => (a._d ?? Infinity) - (b._d ?? Infinity));
    }

    state.view = list;
  }

  // ============================================================
  // 畫面：停車場卡片
  // ============================================================

  /** 費率那一行要顯示什麼 */
  function fareLine(fare) {
    if (!fare || fare.kind === 'unknown') {
      return `<span class="lot-price muted">費率未設定</span>`;
    }
    if (fare.kind === 'free') {
      return `<span class="lot-price">免費</span>`;
    }
    const unit = fare.um === 60 ? '小時' : fare.um === 30 ? '半小時' : `${fare.um} 分`;
    const same = fare.fm === fare.um && fare.fp === fare.up;
    return same
      ? `<span class="lot-price">$${fare.up}<span class="unit">/${unit}</span></span>`
      : `<span class="lot-price">$${fare.fp}<span class="unit"> 首 ${fare.fm === 60 ? '1 小時' : fare.fm + ' 分'}</span></span>
         <span class="lot-meta">之後每${unit} $${fare.up}</span>`;
  }

  /** 卡片上的標籤：只有「有」的才出現，沒有就不佔位置 */
  function lotTags(lot) {
    const t = [];
    if (lot.isCustom) t.push(`<span class="tag brand">我新增的</span>`);
    if (lot.edited) t.push(`<span class="tag">已修改</span>`);
    if (lot.fare?.cap != null) t.push(`<span class="tag ok">每日上限 $${lot.fare.cap}</span>`);
    if (lot.creditCard) {
      t.push(`<span class="tag ok">${icon('card', 'ic ic-sm')}${esc(lot.creditCard)}</span>`);
    }
    if (lot.toilet) t.push(`<span class="tag">${icon('toilet', 'ic ic-sm')}廁所</span>`);

    const c = lot.fare?.kind === 'hourly' ? FE.CONFIDENCE_LABEL[lot.fare.c] : null;
    if (c && lot.fare.c !== 'high') {
      t.push(`<span class="tag ${c.tone}" title="${esc(c.tip)}">${c.text}</span>`);
    }
    return t.length ? `<div class="tags">${t.join('')}</div>` : '';
  }

  function lotCard(lot) {
    const fav = ST.favorites.has(lot.id);
    const sub = [lot.operator, lot.district].filter(Boolean)
      .map(esc).join(' <span class="dot">·</span> ');

    return `
      <article class="lot" data-id="${esc(lot.id)}">
        <button class="fav" data-act="fav" data-id="${esc(lot.id)}"
                aria-pressed="${fav}" aria-label="${fav ? '取消收藏' : '加入收藏'}">
          ${icon('star', 'ic ic-sm')}
        </button>
        <button class="lot-main" data-act="detail" data-id="${esc(lot.id)}">
          <h3 class="lot-name">${esc(lot.name)}</h3>
          ${sub ? `<div class="lot-sub">${sub}</div>` : ''}
          <div class="lot-fare">
            ${fareLine(lot.fare)}
            ${lot._d != null ? `<span class="lot-meta">· ${fmtDistance(lot._d)}</span>` : ''}
          </div>
          ${lotTags(lot)}
        </button>
        <div class="lot-actions">
          <button class="btn primary sm block" data-act="start" data-id="${esc(lot.id)}">開始停車</button>
        </div>
      </article>`;
  }

  function renderLots() {
    computeView();
    const box = $('#lots');
    const n = state.view.length;

    $('#count').textContent = state.query || state.filters.size || state.nearMe
      ? `找到 ${n.toLocaleString('zh-TW')} 個停車場`
      : `共 ${n.toLocaleString('zh-TW')} 個停車場`;

    if (n === 0) {
      box.innerHTML = emptyState(
        'search', '找不到符合的停車場',
        state.filters.has('fav')
          ? '你還沒有收藏任何停車場。點卡片右上角的星號就能收藏。'
          : '換個關鍵字試試，或是把篩選條件取消。'
      );
      return;
    }

    const slice = state.view.slice(0, state.shown);
    box.innerHTML =
      `<div class="lot-list">${slice.map(lotCard).join('')}</div>` +
      (n > state.shown
        ? `<button class="btn block" id="more" style="margin-top:10px">
             載入更多（還有 ${(n - state.shown).toLocaleString('zh-TW')} 個）
           </button>`
        : '');
  }

  function emptyState(ico, title, text) {
    return `<div class="empty">
      ${icon(ico, 'ic ic-xl')}
      <h3>${esc(title)}</h3>
      <p>${text}</p>
    </div>`;
  }

  // ============================================================
  // 畫面：停車場詳情
  // ============================================================
  function row(label, value, cls = '') {
    if (value == null || value === '') return '';   // 沒資料就整行不顯示
    return `<div class="row"><dt>${esc(label)}</dt><dd class="${cls}">${value}</dd></div>`;
  }

  function renderDetail(id) {
    const lot = findLot(id);
    if (!lot) { go('lots'); return; }
    state.detailId = id;

    const f = lot.fare || {};
    const conf = f.kind === 'hourly' ? FE.CONFIDENCE_LABEL[f.c] : null;
    const note = ST.notes.get(id);
    const open = isOpenNow(lot.serviceTime);
    // 開放資料沒有的欄位，空著時顯示這句，提示可以自己補
    const blank = '<span style="color:var(--text-3);font-weight:400">尚未填寫</span>';

    const mapUrl = lot.lat != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${lot.lat},${lot.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [lot.city, lot.district, lot.address, lot.name].filter(Boolean).join(' '))}`;

    $('#detail').innerHTML = `
      <div class="detail-head">
        <h2>${esc(lot.name)}</h2>
        ${lot.operator ? `<div class="op">經營：${esc(lot.operator)}</div>` : ''}
      </div>

      <div class="card">
        ${row('地址', esc(lot.address))}
        ${row('行政區', esc([lot.city, lot.district].filter(Boolean).join(' ')))}
        ${row('營業時間', lot.serviceTime
            ? esc(lot.serviceTime) + (open === true ? ' <span class="tag ok">營業中</span>'
              : open === false ? ' <span class="tag">目前休息</span>' : '')
            : null)}
        ${row('汽車位', lot.totalCar ? `${lot.totalCar} 格` : null)}
        ${row('電話', lot.tel ? `<a href="tel:${esc(lot.tel)}">${esc(lot.tel)}</a>` : null)}
        ${row('停車場類型', esc(lot.category))}
        ${row('信用卡優惠', lot.creditCard || lot.cardHours
            ? `<span class="tag ok">${icon('card', 'ic ic-sm')}${
                esc(lot.creditCard || '有優惠')}</span>${
                lot.cardHours ? `<div class="hint" style="margin-top:4px">可折抵 ${
                  FE.formatDuration(lot.cardHours * 60)}</div>` : ''}`
            : blank)}
        ${row('附設廁所', lot.toilet
            ? `<span class="tag">${icon('toilet', 'ic ic-sm')}有</span>`
            : blank)}
        <p class="disclaimer" style="padding:0 0 12px">
          ${icon('info', 'ic ic-sm')} 信用卡優惠和廁所是政府開放資料沒有提供的，
          去過之後可以按下面的「編輯資料」自己補上，App 會永久記住。
        </p>
      </div>

      <div class="card">
        <h3>收費方式</h3>
        ${row('計費規則', f.kind === 'unknown'
            ? '<span style="color:var(--text-3)">尚未設定，點下方「設定費率」</span>'
            : esc(FE.describeRule({ ...f, kind: f.kind })))}
        ${f.cap != null ? row('每日上限', `$${f.cap}`) : ''}
        ${conf ? row('資料可信度',
            `<span class="tag ${conf.tone}">${conf.text}</span>`) : ''}
        ${f.why?.length ? row('注意', esc(f.why.join('、')), 'raw') : ''}
        ${f.raw ? row('官方費率原文', esc(f.raw), 'raw') : ''}
        <div style="padding:12px 0">
          <button class="btn block" data-act="editFare" data-id="${esc(id)}">
            ${icon('edit', 'ic ic-sm')} 設定 / 修正費率
          </button>
        </div>
      </div>

      <div class="card pad">
        <div class="field" style="margin:0">
          <label for="note">個人備註</label>
          <textarea id="note" placeholder="例如：車位很窄、假日很難停、B2 靠電梯比較好停…">${esc(note)}</textarea>
          <button class="btn block" id="saveNote" style="margin-top:9px">儲存備註</button>
        </div>
      </div>

      <div class="card pad" style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn grow" href="${mapUrl}" target="_blank" rel="noopener">
          ${icon('nav', 'ic ic-sm')} 導航
        </a>
        <button class="btn grow" data-act="editLot" data-id="${esc(id)}">
          ${icon('edit', 'ic ic-sm')} 編輯資料
        </button>
        ${lot.edited ? `<button class="btn ghost grow" data-act="resetLot" data-id="${esc(id)}">還原官方資料</button>` : ''}
        ${lot.isCustom ? `<button class="btn danger grow" data-act="delLot" data-id="${esc(id)}">刪除這個停車場</button>` : ''}
      </div>

      <button class="btn primary block" data-act="start" data-id="${esc(id)}"
              style="margin-bottom:20px">開始停車</button>
    `;

    $('#saveNote').onclick = () => {
      ST.notes.set(id, $('#note').value);
      toast('備註已儲存');
    };
  }

  // ============================================================
  // 畫面：計時中
  // ============================================================
  let tick = null;

  function renderTimer() {
    const s = ST.active.get();
    const box = $('#timer');
    clearInterval(tick);

    if (!s) {
      $('#timerBadge').hidden = true;
      box.innerHTML = emptyState(
        'timer', '目前沒有進行中的停車',
        '到「停車場」頁選一個地點按下「開始停車」，<br>這裡就會開始計時並即時估算費用。'
      );
      return;
    }

    $('#timerBadge').hidden = false;
    const lot = findLot(s.lotId) || {};
    const fare = lot.fare || { kind: 'unknown' };
    // 這個停車場有沒有登記過優惠？有才顯示折抵的勾選框
    const hasDiscount = !!(lot.creditCard || lot.cardHours);

    box.innerHTML = `
      <div class="timer-card">
        <div class="name">${esc(s.lotName)}</div>
        ${s.operator ? `<div class="op">${esc(s.operator)}</div>` : ''}
        <div class="label">已停留時間</div>
        <div class="clock" id="clock">00:00:00</div>
        <div class="fee-box">
          <div>
            <div class="label">預估目前費用</div>
            <div class="amount" id="fee">—</div>
          </div>
          <div class="rate" id="rate"></div>
        </div>
      </div>

      ${hasDiscount ? `
      <div class="card pad">
        <label class="switch" style="padding-top:0">
          <span>
            使用信用卡／消費優惠
            ${lot.creditCard ? `<br><span class="hint" style="margin:0">${esc(lot.creditCard)}</span>` : ''}
          </span>
          <input type="checkbox" id="useCard" ${s.useCard ? 'checked' : ''}><i class="track"></i>
        </label>
        <div id="cardHoursBox" ${s.useCard ? '' : 'hidden'}>
          <div class="field" style="margin:12px 0 0">
            <label for="cardHours">折抵幾小時</label>
            <input type="number" id="cardHours" step="0.5" min="0" max="24" inputmode="decimal"
                   value="${s.cardHours ?? lot.cardHours ?? 1}">
            <p class="hint">
              停車費會扣掉這段時間再計算。實際折抵以停車場現場認定為準。
            </p>
          </div>
        </div>
      </div>` : ''}

      <div class="card pad">
        <h3 style="margin-top:0">停車位置</h3>
        <p class="disclaimer" style="margin:0 0 12px">
          開始計時比較重要，先按開始，找到車位後再回來填也可以。
        </p>
        <div class="grid-2">
          <div class="field" style="margin:0">
            <label for="floor">樓層</label>
            <input type="text" id="floor" placeholder="例如：B2" value="${esc(s.floor)}">
          </div>
          <div class="field" style="margin:0">
            <label for="space">車格號碼</label>
            <input type="text" id="space" placeholder="例如：215" value="${esc(s.space)}">
          </div>
        </div>
        <button class="btn block" id="savePos" style="margin-top:10px">儲存車位</button>
      </div>

      <div class="card pad">
        <div class="row" style="border:none;padding:6px 0">
          <dt style="width:auto">開始時間</dt>
          <dd>${fmtDateTime(s.startAt)}
            <button class="btn sm ghost" id="editStart" style="margin-left:8px">修改</button>
          </dd>
        </div>
        <p class="disclaimer" id="ruleText" style="margin:8px 0 0"></p>
        <p class="disclaimer" style="margin:8px 0 0">
          費用依上述規則無條件進位估算，<strong>僅供參考，實際收費請以現場為準</strong>。
        </p>
      </div>

      <button class="btn danger block" id="stop" style="margin-bottom:20px">結束停車並記錄</button>
    `;

    /** 目前這次停車套用的折抵分鐘數 */
    const discountMinutes = () => {
      const cur = ST.active.get();
      if (!cur?.useCard) return 0;
      return Math.max(0, Number(cur.cardHours ?? lot.cardHours ?? 0)) * 60;
    };

    const update = () => {
      const now = Date.now();
      const disc = discountMinutes();
      $('#clock').textContent = FE.formatClock(now - s.startAt);

      const r = FE.calcFee(fare, s.startAt, now, { discountMinutes: disc });
      $('#fee').textContent = r.amount == null ? '無法估算' : `$${r.amount}`;
      $('#rate').innerHTML = r.amount == null
        ? '費率未設定'
        : (fare.kind === 'free' ? '免費' : esc(FE.describeRule(fare)).replace('，', '<br>'));

      let txt;
      if (r.amount == null) {
        txt = '這個停車場的費率還沒設定，可以到停車場詳情頁設定一次，之後就會自動計算。';
      } else {
        txt = `計費方式：${r.detail}`
          + (FE.isWeekend(new Date(s.startAt)) ? '（今天是假日）' : '（今天是平日）');
        if (disc > 0) {
          txt += r.billedMinutes <= 0
            ? `　已折抵 ${FE.formatDuration(disc)}，目前不用付費。`
            : `　已折抵 ${FE.formatDuration(disc)}，實際計費 ${FE.formatDuration(r.billedMinutes)}。`;
        }
      }
      $('#ruleText').textContent = txt;
    };
    update();
    tick = setInterval(update, 1000);

    // 折抵的勾選與時數
    const useCard = $('#useCard');
    if (useCard) {
      useCard.onchange = () => {
        const on = useCard.checked;
        $('#cardHoursBox').hidden = !on;
        ST.active.update({
          useCard: on,
          cardHours: Number($('#cardHours')?.value ?? lot.cardHours ?? 1),
        });
        update();
        toast(on ? '已套用優惠折抵' : '已取消優惠折抵');
      };
    }
    const cardHours = $('#cardHours');
    if (cardHours) {
      cardHours.oninput = () => {
        ST.active.update({ cardHours: Math.max(0, Number(cardHours.value) || 0) });
        update();
      };
    }

    $('#savePos').onclick = () => {
      ST.active.update({ floor: $('#floor').value.trim(), space: $('#space').value.trim() });
      toast('車位已儲存');
    };

    $('#editStart').onclick = () => openStartEditor(s);
    // 重新讀一次，才會帶到剛剛勾的折抵設定
    $('#stop').onclick = () => confirmStop(ST.active.get(), lot, fare, discountMinutes());
  }

  /** 修改進場時間（忘記按開始時可以補，測試費率時也很好用） */
  function openStartEditor(s) {
    openModal('修改開始時間', `
      <div class="field">
        <label for="newStart">進場時間</label>
        <input type="datetime-local" id="newStart" value="${toLocalInput(s.startAt)}">
        <p class="hint">忘記按「開始停車」的話，可以在這裡改成實際進場的時間。</p>
      </div>
      <div class="modal-actions">
        <button class="btn grow" data-close>取消</button>
        <button class="btn primary grow" id="okStart">儲存</button>
      </div>
    `, () => {
      $('#okStart').onclick = () => {
        const v = $('#newStart').value;
        if (!v) return;
        const ms = new Date(v).getTime();
        if (ms > Date.now()) { toast('開始時間不能比現在晚'); return; }
        ST.active.update({ startAt: ms });
        closeModal();
        renderTimer();
        toast('開始時間已更新');
      };
    });
  }

  /** 結束停車前先確認，避免手滑 */
  function confirmStop(s, lot, fare, discountMinutes = 0) {
    const end = Date.now();
    const r = FE.calcFee(fare, s.startAt, end, { discountMinutes });
    const dur = FE.formatDuration(r.minutes);

    openModal('結束停車', `
      <p style="margin:0 0 14px;color:var(--text-2)">${esc(s.lotName)}</p>
      <div class="summary" style="box-shadow:none;background:var(--surface-2)">
        <div class="cell"><div class="k">停車時間</div><div class="v" style="font-size:1rem">${dur}</div></div>
        <div class="cell"><div class="k">預估費用</div><div class="v">${r.amount == null ? '—' : '$' + r.amount}</div></div>
      </div>
      ${discountMinutes > 0
        ? `<p class="hint" style="margin:10px 0 0">
             已套用優惠折抵 ${FE.formatDuration(discountMinutes)}${
               r.billedMinutes > 0 ? `，實際計費 ${FE.formatDuration(r.billedMinutes)}` : ''}
           </p>` : ''}
      ${r.amount == null
        ? `<div class="field" style="margin-top:12px">
             <label for="manualFee">這個停車場的費率沒有設定，實際付了多少？</label>
             <input type="number" id="manualFee" inputmode="numeric" placeholder="例如：120" min="0">
             <p class="hint">留空也可以，之後在歷史紀錄裡還能補填。</p>
           </div>` : ''}
      <div class="modal-actions">
        <button class="btn grow" data-close>再等一下</button>
        <button class="btn primary grow" id="okStop">確定結束並記錄</button>
      </div>
    `, () => {
      $('#okStop').onclick = () => {
        const manual = $('#manualFee');
        const amount = r.amount != null ? r.amount
          : (manual && manual.value !== '' ? Number(manual.value) : null);

        ST.history.add({
          lotId: s.lotId,
          lotName: s.lotName,
          operator: s.operator,
          startAt: s.startAt,
          endAt: end,
          minutes: r.minutes,
          amount,
          floor: s.floor,
          space: s.space,
          estimated: r.amount != null,
          discountMinutes: discountMinutes || 0,
        });
        ST.active.clear();
        closeModal();
        renderTimer();
        renderHistory();
        go('history');
        toast('已記錄這次停車');
      };
    });
  }

  function startParking(id) {
    const lot = findLot(id);
    if (!lot) return;
    const cur = ST.active.get();

    const doStart = () => {
      ST.active.start(lot);
      renderTimer();
      go('timer');
      toast(`已開始計時：${lot.name}`);
    };

    // 一支手機同時只計時一台車
    if (cur) {
      openModal('已經有一筆停車在計時', `
        <p style="margin:0 0 6px;color:var(--text-2)">目前正在計時：</p>
        <p style="margin:0 0 16px;font-weight:600">${esc(cur.lotName)}</p>
        <p class="disclaimer" style="margin:0">
          要結束原本那筆並改成停在「${esc(lot.name)}」嗎？<br>
          原本那筆會被記錄到歷史紀錄。
        </p>
        <div class="modal-actions">
          <button class="btn grow" data-close>取消</button>
          <button class="btn primary grow" id="okSwitch">結束原本那筆，改停這裡</button>
        </div>
      `, () => {
        $('#okSwitch').onclick = () => {
          const oldLot = findLot(cur.lotId);
          const disc = cur.useCard ? Math.max(0, Number(cur.cardHours || 0)) * 60 : 0;
          const r = FE.calcFee(oldLot?.fare || { kind: 'unknown' }, cur.startAt, Date.now(),
            { discountMinutes: disc });
          ST.history.add({
            lotId: cur.lotId, lotName: cur.lotName, operator: cur.operator,
            startAt: cur.startAt, endAt: Date.now(), minutes: r.minutes,
            amount: r.amount, floor: cur.floor, space: cur.space,
            estimated: r.amount != null, discountMinutes: disc,
          });
          closeModal();
          doStart();
        };
      });
      return;
    }
    doStart();
  }

  // ============================================================
  // 畫面：歷史紀錄
  // ============================================================
  function inRange(ms, range) {
    const d = new Date(ms), now = new Date();
    if (range === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (range === 'year') return d.getFullYear() === now.getFullYear();
    return true;
  }

  function renderHistory() {
    const all = ST.history.all();
    const list = all.filter((r) => inRange(r.endAt, state.range));
    const box = $('#history');

    const total = list.reduce((s, r) => s + (r.amount || 0), 0);
    const label = { month: '本月', year: '今年', all: '全部' }[state.range];

    const summary = `
      <div class="summary">
        <div class="cell"><div class="k">${label}停車</div><div class="v">${list.length} 次</div></div>
        <div class="cell"><div class="k">${label}花費</div><div class="v">$${total.toLocaleString('zh-TW')}</div></div>
      </div>`;

    if (all.length === 0) {
      box.innerHTML = emptyState('history', '還沒有停車紀錄',
        '結束一次停車之後，紀錄就會出現在這裡。<br>也可以按下方的「手動補登」補上以前的停車。')
        + `<button class="btn block" id="addRec">手動補登一筆</button>`;
      $('#addRec').onclick = () => openRecordEditor(null);
      return;
    }

    if (list.length === 0) {
      box.innerHTML = summary + emptyState('history', `${label}沒有停車紀錄`, '換個範圍看看，或按下方補登一筆。')
        + `<button class="btn block" id="addRec">手動補登一筆</button>`;
      $('#addRec').onclick = () => openRecordEditor(null);
      return;
    }

    box.innerHTML = summary + list.map((r) => {
      const pos = [r.floor, r.space].filter(Boolean).join(' · ');
      return `
        <article class="rec" data-rec="${esc(r.id)}">
          <div class="rec-top">
            <div>
              <div class="rec-name">${esc(r.lotName)}</div>
              ${r.operator ? `<div class="rec-meta">${esc(r.operator)}</div>` : ''}
            </div>
            <div class="rec-amount">${r.amount == null ? '—' : '$' + r.amount}</div>
          </div>
          <div class="rec-meta">
            ${pos ? `${icon('pin', 'ic ic-sm')} ${esc(pos)}<br>` : ''}
            ${fmtDateTime(r.startAt)} → ${fmtDateTime(r.endAt)}
            <span class="dot">·</span> ${FE.formatDuration(r.minutes)}
            ${r.discountMinutes > 0
              ? `<span class="dot">·</span> 已折抵 ${FE.formatDuration(r.discountMinutes)}` : ''}
            ${r.estimated === false ? '<span class="dot">·</span> 手動填寫' : ''}
          </div>
          <div class="rec-actions">
            <button class="btn sm" data-act="editRec" data-id="${esc(r.id)}">${icon('edit', 'ic ic-sm')} 編輯</button>
            <button class="btn sm danger" data-act="delRec" data-id="${esc(r.id)}">${icon('trash', 'ic ic-sm')} 刪除</button>
          </div>
        </article>`;
    }).join('') + `
      <div style="display:flex;gap:8px;margin:16px 0 20px;flex-wrap:wrap">
        <button class="btn grow" id="addRec">手動補登</button>
        <button class="btn grow" id="exportBtn">${icon('download', 'ic ic-sm')} 匯出備份</button>
        <button class="btn grow" id="importBtn">${icon('upload', 'ic ic-sm')} 匯入備份</button>
        <button class="btn danger grow" id="clearAll">清空全部</button>
      </div>
      <p class="disclaimer" style="margin-bottom:24px">
        ${icon('info', 'ic ic-sm')} 你的紀錄只存在這台裝置上。換手機或清除瀏覽器資料就會消失，建議定期匯出備份。
      </p>`;

    $('#addRec').onclick = () => openRecordEditor(null);
    $('#exportBtn').onclick = exportBackup;
    $('#importBtn').onclick = importBackup;
    $('#clearAll').onclick = confirmClearAll;
  }

  /** 新增或編輯一筆歷史紀錄 */
  function openRecordEditor(rec) {
    const isNew = !rec;
    const now = Date.now();
    const r = rec || {
      lotName: '', startAt: now - 3600000, endAt: now, amount: null, floor: '', space: '',
    };

    openModal(isNew ? '手動補登停車紀錄' : '編輯停車紀錄', `
      <div class="field">
        <label for="rName">停車場名稱 <span class="req">*</span></label>
        <input type="text" id="rName" value="${esc(r.lotName)}" placeholder="例如：市民廣場地下停車場">
        <p class="err" id="rNameErr" hidden>請填寫停車場名稱</p>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="rStart">進場時間</label>
          <input type="datetime-local" id="rStart" value="${toLocalInput(r.startAt)}">
        </div>
        <div class="field">
          <label for="rEnd">出場時間</label>
          <input type="datetime-local" id="rEnd" value="${toLocalInput(r.endAt)}">
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="rFee">費用（元）</label>
          <input type="number" id="rFee" inputmode="numeric" min="0" value="${r.amount ?? ''}">
        </div>
        <div class="field">
          <label for="rFloor">樓層 / 車格</label>
          <input type="text" id="rFloor" value="${esc([r.floor, r.space].filter(Boolean).join(' '))}" placeholder="B2 215">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn grow" data-close>取消</button>
        <button class="btn primary grow" id="okRec">儲存</button>
      </div>
    `, () => {
      $('#okRec').onclick = () => {
        const name = $('#rName').value.trim();
        if (!name) {
          $('#rNameErr').hidden = false;
          $('#rName').setAttribute('aria-invalid', 'true');
          return;
        }
        const startAt = new Date($('#rStart').value).getTime();
        const endAt = new Date($('#rEnd').value).getTime();
        if (!(endAt > startAt)) { toast('出場時間要比進場時間晚'); return; }

        const [floor, space] = $('#rFloor').value.trim().split(/\s+/);
        const payload = {
          lotName: name,
          startAt, endAt,
          minutes: Math.ceil((endAt - startAt) / 60000),
          amount: $('#rFee').value === '' ? null : Number($('#rFee').value),
          floor: floor || '', space: space || '',
          estimated: false,
        };

        if (isNew) ST.history.add(payload);
        else ST.history.update(rec.id, payload);

        closeModal();
        renderHistory();
        toast(isNew ? '已補登一筆紀錄' : '紀錄已更新');
      };
    });
  }

  function confirmClearAll() {
    openModal('清空全部紀錄', `
      <p style="margin:0 0 8px;color:var(--alert);font-weight:600">這個動作沒辦法復原。</p>
      <p class="disclaimer" style="margin:0 0 4px">
        所有停車歷史紀錄都會被刪除。你的收藏、自建停車場和自訂費率不受影響。
      </p>
      <p class="disclaimer">建議先按「匯出備份」把資料存下來。</p>
      <div class="modal-actions">
        <button class="btn grow" data-close>取消</button>
        <button class="btn danger grow" id="okClear">確定全部刪除</button>
      </div>
    `, () => {
      $('#okClear').onclick = () => {
        ST.history.clear();
        closeModal();
        renderHistory();
        toast('已清空歷史紀錄');
      };
    });
  }

  // ============================================================
  // 匯出 / 匯入備份
  // ============================================================
  function exportBackup() {
    const data = ST.backup.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const d = new Date();
    const name = `我的停車備份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`已匯出 ${data.data.history.length} 筆紀錄`);
  }

  function importBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let payload;
        try { payload = JSON.parse(reader.result); }
        catch { toast('這個檔案看起來不是備份檔'); return; }

        openModal('匯入備份', `
          <p class="disclaimer" style="margin:0 0 14px">
            備份檔建立於 ${payload.exportedAt ? new Date(payload.exportedAt).toLocaleString('zh-TW') : '未知時間'}，
            含 ${payload.data?.history?.length ?? 0} 筆停車紀錄。
          </p>
          <div class="modal-actions" style="flex-direction:column">
            <button class="btn primary block" id="impMerge">合併（保留目前的紀錄）</button>
            <button class="btn danger block" id="impReplace">取代（刪掉目前的，換成備份的）</button>
            <button class="btn ghost block" data-close>取消</button>
          </div>
        `, () => {
          const run = (mode) => {
            try {
              const r = ST.backup.import(payload, mode);
              closeModal();
              loadLots(); renderLots(); renderHistory(); renderTimer();
              toast(`已匯入 ${r.history} 筆紀錄`);
            } catch (e) {
              toast(e.message);
            }
          };
          $('#impMerge').onclick = () => run('merge');
          $('#impReplace').onclick = () => run('replace');
        });
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ============================================================
  // 表單：新增 / 編輯停車場
  // ============================================================
  function openLotEditor(lot) {
    const isNew = !lot;
    const l = lot || {};
    const f = FE.toEditable(l.fare);
    // 手動新增停車場的人通常就是要順便設費率，預設選「計時收費」比較省事
    if (isNew && !l.fare) f.kind = 'hourly';

    openModal(isNew ? '新增停車場' : '編輯停車場資料', `
      <div class="field">
        <label for="lName">停車場名稱 <span class="req">*</span></label>
        <input type="text" id="lName" value="${esc(l.name)}" placeholder="例如：市民廣場地下停車場">
        <p class="err" id="lNameErr" hidden>請填寫停車場名稱</p>
      </div>
      <div class="field">
        <label for="lOp">經營公司</label>
        <input type="text" id="lOp" value="${esc(l.operator)}" placeholder="例如：台灣聯通、嘟嘟房">
      </div>
      <div class="field">
        <label for="lAddr">地址</label>
        <input type="text" id="lAddr" value="${esc(l.address)}" placeholder="例如：台北市信義區市府路 1 號">
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="lLat">緯度（選填）</label>
          <input type="number" id="lLat" step="0.000001" value="${l.lat ?? ''}" placeholder="25.0375">
        </div>
        <div class="field">
          <label for="lLng">經度（選填）</label>
          <input type="number" id="lLng" step="0.000001" value="${l.lng ?? ''}" placeholder="121.5637">
        </div>
      </div>
      <p class="hint" style="margin:-6px 0 14px">
        填了座標才能在「離我最近」裡被排序，也才能一鍵導航。
        可以從 Google 地圖的分享連結裡找到。
      </p>
      <div class="field">
        <label for="lTime">營業時間</label>
        <input type="text" id="lTime" value="${esc(l.serviceTime)}" placeholder="例如：0~24時 或 7-20">
      </div>

      <div class="field">
        <label for="lCard">信用卡／消費優惠</label>
        <input type="text" id="lCard" value="${esc(l.creditCard)}"
               placeholder="例如：國泰 CUBE 卡折抵 1 小時">
        <p class="hint">政府資料沒有這項，去過之後可以自己記下來。留空表示沒有優惠。</p>
      </div>
      <div class="field">
        <label for="lCardHours">這個優惠可以折抵幾小時</label>
        <input type="number" id="lCardHours" step="0.5" min="0" max="24"
               inputmode="decimal" value="${l.cardHours ?? ''}" placeholder="例如：1">
        <p class="hint">
          填了之後，開始停車時就可以勾選「使用優惠」，費用會自動扣掉這段時間。
          可以填 0.5 表示半小時。
        </p>
      </div>

      <label class="switch">
        <span>附設廁所</span>
        <input type="checkbox" id="lToilet" ${l.toilet ? 'checked' : ''}><i class="track"></i>
      </label>

      ${fareFieldsHtml(f)}

      <div class="modal-actions">
        <button class="btn grow" data-close>取消</button>
        <button class="btn primary grow" id="okLot">儲存</button>
      </div>
    `, () => {
      bindFareFields();
      $('#okLot').onclick = () => {
        const name = $('#lName').value.trim();
        if (!name) {
          $('#lNameErr').hidden = false;
          $('#lName').setAttribute('aria-invalid', 'true');
          $('#lName').focus();
          return;
        }
        const lat = $('#lLat').value === '' ? null : Number($('#lLat').value);
        const lng = $('#lLng').value === '' ? null : Number($('#lLng').value);

        const payload = {
          name,
          operator: $('#lOp').value.trim() || null,
          address: $('#lAddr').value.trim() || null,
          serviceTime: $('#lTime').value.trim() || null,
          creditCard: $('#lCard').value.trim() || null,
          cardHours: $('#lCardHours').value === '' ? null : Number($('#lCardHours').value),
          toilet: $('#lToilet').checked,
          lat, lng,
          fare: readFareFields(),
        };

        if (isNew) {
          ST.custom.add({ ...payload, city: '自訂', district: null, totalCar: null });
          toast('已新增停車場');
        } else if (l.isCustom) {
          ST.custom.update(l.id, payload);
          toast('已更新');
        } else {
          ST.overrides.set(l.id, payload);
          toast('已修改，之後都會用你的版本');
        }

        closeModal();
        loadLots();
        renderLots();
        if (!isNew) renderDetail(l.id);
      };
    });
  }

  /** 只編輯費率（詳情頁的「設定 / 修正費率」） */
  function openFareEditor(id) {
    const lot = findLot(id);
    if (!lot) return;
    const f = FE.toEditable(lot.fare);

    openModal('設定費率', `
      <p class="disclaimer" style="margin:0 0 16px">
        設定一次就會永久記住，之後這個停車場都用你的版本計算。
      </p>
      ${fareFieldsHtml(f)}
      <div class="modal-actions">
        <button class="btn grow" data-close>取消</button>
        <button class="btn primary grow" id="okFare">儲存</button>
      </div>
    `, () => {
      bindFareFields();
      $('#okFare').onclick = () => {
        const fare = readFareFields();
        if (lot.isCustom) ST.custom.update(id, { fare });
        else ST.overrides.set(id, { fare });
        closeModal();
        loadLots();
        renderDetail(id);
        renderTimer();
        toast('費率已更新');
      };
    });
  }

  /** 費率欄位（新增停車場和設定費率共用） */
  function fareFieldsHtml(f) {
    const hasCap = f.cap != null;
    const hasWk = !!f.weekend;
    const w = f.weekend || { fm: f.fm, fp: f.fp, um: f.um, up: f.up, cap: f.cap };

    return `
      <div class="field">
        <label for="fKind">收費方式</label>
        <select id="fKind">
          <option value="hourly" ${f.kind === 'hourly' ? 'selected' : ''}>計時收費</option>
          <option value="free" ${f.kind === 'free' ? 'selected' : ''}>免費停車</option>
          <option value="unknown" ${f.kind === 'unknown' ? 'selected' : ''}>不確定（先不計算）</option>
        </select>
      </div>

      <div id="fareBody" ${f.kind !== 'hourly' ? 'hidden' : ''}>
        <p class="hint" style="margin:0 0 10px">平日費率</p>
        <div class="grid-2">
          <div class="field">
            <label for="fFm">前幾分鐘</label>
            <select id="fFm">
              <option value="60" ${f.fm === 60 ? 'selected' : ''}>第 1 小時</option>
              <option value="30" ${f.fm === 30 ? 'selected' : ''}>前 30 分鐘</option>
              <option value="15" ${f.fm === 15 ? 'selected' : ''}>前 15 分鐘</option>
            </select>
          </div>
          <div class="field">
            <label for="fFp">收多少錢</label>
            <input type="number" id="fFp" inputmode="numeric" min="0" value="${f.fp}">
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="fUm">之後每</label>
            <select id="fUm">
              <option value="30" ${f.um === 30 ? 'selected' : ''}>每半小時</option>
              <option value="60" ${f.um === 60 ? 'selected' : ''}>每 1 小時</option>
              <option value="15" ${f.um === 15 ? 'selected' : ''}>每 15 分鐘</option>
            </select>
          </div>
          <div class="field">
            <label for="fUp">收多少錢</label>
            <input type="number" id="fUp" inputmode="numeric" min="0" value="${f.up}">
          </div>
        </div>

        <label class="switch">
          <span>有每日上限</span>
          <input type="checkbox" id="fHasCap" ${hasCap ? 'checked' : ''}><i class="track"></i>
        </label>
        <div class="field" id="capField" ${hasCap ? '' : 'hidden'}>
          <label for="fCap">每日最多收多少錢</label>
          <input type="number" id="fCap" inputmode="numeric" min="0" value="${f.cap ?? 200}">
        </div>

        <label class="switch">
          <span>假日（六、日）費率不同</span>
          <input type="checkbox" id="fHasWk" ${hasWk ? 'checked' : ''}><i class="track"></i>
        </label>
        <div id="wkField" ${hasWk ? '' : 'hidden'}>
          <p class="hint" style="margin:10px 0">假日費率</p>
          <div class="grid-2">
            <div class="field">
              <label for="wFm">前幾分鐘</label>
              <select id="wFm">
                <option value="60" ${w.fm === 60 ? 'selected' : ''}>第 1 小時</option>
                <option value="30" ${w.fm === 30 ? 'selected' : ''}>前 30 分鐘</option>
              </select>
            </div>
            <div class="field">
              <label for="wFp">收多少錢</label>
              <input type="number" id="wFp" inputmode="numeric" min="0" value="${w.fp}">
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="wUm">之後每</label>
              <select id="wUm">
                <option value="30" ${w.um === 30 ? 'selected' : ''}>每半小時</option>
                <option value="60" ${w.um === 60 ? 'selected' : ''}>每 1 小時</option>
              </select>
            </div>
            <div class="field">
              <label for="wUp">收多少錢</label>
              <input type="number" id="wUp" inputmode="numeric" min="0" value="${w.up}">
            </div>
          </div>
          <div class="field">
            <label for="wCap">假日每日上限（留空表示沒有）</label>
            <input type="number" id="wCap" inputmode="numeric" min="0" value="${w.cap ?? ''}">
          </div>
        </div>

        <p class="hint" id="farePreview" style="margin-top:6px"></p>
      </div>`;
  }

  function bindFareFields() {
    const sync = () => {
      const kind = $('#fKind').value;
      $('#fareBody').hidden = kind !== 'hourly';
      if (kind !== 'hourly') return;
      $('#capField').hidden = !$('#fHasCap').checked;
      $('#wkField').hidden = !$('#fHasWk').checked;

      // 即時預覽：停 1 小時 10 分要多少錢
      const f = readFareFields();
      if (f.kind === 'hourly') {
        const now = new Date();
        const r = FE.calcFee(f, now.getTime() - 70 * 60000, now.getTime());
        $('#farePreview').textContent =
          `${FE.describeRule(f)}　→　停 1 小時 10 分鐘約 $${r.amount}`;
      }
    };
    ['#fKind', '#fFm', '#fFp', '#fUm', '#fUp', '#fHasCap', '#fCap',
      '#fHasWk', '#wFm', '#wFp', '#wUm', '#wUp', '#wCap']
      .forEach((sel) => { const el = $(sel); if (el) el.oninput = el.onchange = sync; });
    sync();
  }

  function readFareFields() {
    const kind = $('#fKind')?.value || 'unknown';
    if (kind !== 'hourly') return { kind };

    const num = (sel, d = 0) => {
      const v = $(sel)?.value;
      return v === '' || v == null ? d : Number(v);
    };

    const fare = {
      kind: 'hourly',
      fm: num('#fFm', 60), fp: num('#fFp'),
      um: num('#fUm', 30), up: num('#fUp'),
      c: 'high',           // 你自己設定的，視為明確
    };
    if ($('#fHasCap')?.checked) fare.cap = num('#fCap');
    if ($('#fHasWk')?.checked) {
      fare.weekend = {
        fm: num('#wFm', 60), fp: num('#wFp'),
        um: num('#wUm', 30), up: num('#wUp'),
      };
      if ($('#wCap')?.value !== '') fare.weekend.cap = num('#wCap');
    }
    return fare;
  }

  // ============================================================
  // 對話框
  // ============================================================
  let lastFocus = null;

  function openModal(title, html, onReady) {
    lastFocus = document.activeElement;
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    $$('[data-close]', $('#modalBody')).forEach((b) => (b.onclick = closeModal));
    if (onReady) onReady();
    const first = $('#modalBody input, #modalBody select, #modalBody textarea');
    if (first) setTimeout(() => first.focus(), 60);
  }

  function closeModal() {
    $('#modal').classList.remove('open');
    $('#modalBody').innerHTML = '';
    document.body.style.overflow = '';
    if (lastFocus) { try { lastFocus.focus(); } catch (e) { /* 忽略 */ } }
  }

  // ============================================================
  // 分頁切換
  // ============================================================
  function go(tab) {
    state.tab = tab;
    $$('.page').forEach((p) => p.classList.remove('active'));
    $(`#page-${tab}`).classList.add('active');

    $$('.tabbar button').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.tab === tab)));

    // 詳情頁：左邊換成「返回」，圖示收起來不跟它擠
    const isDetail = tab === 'detail';
    $('#btnBack').hidden = !isDetail;
    $('#logo').hidden = isDetail;
    $('#btnAdd').hidden = tab !== 'lots';
    $('#appTitle').textContent = isDetail ? '停車場詳情' : 'TPE Parking';

    if (tab === 'timer') renderTimer(); else clearInterval(tick);
    if (tab === 'history') renderHistory();

    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // ============================================================
  // 定位
  // ============================================================
  function locateMe() {
    const btn = $('#fNear');
    if (state.nearMe) {   // 再按一次取消
      state.nearMe = false;
      btn.setAttribute('aria-pressed', 'false');
      state.lots.forEach((l) => delete l._d);
      renderLots();
      return;
    }

    if (!navigator.geolocation) {
      toast('這個瀏覽器不支援定位功能');
      return;
    }

    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.disabled = false;
        state.myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.nearMe = true;
        state.shown = PAGE_SIZE;
        btn.setAttribute('aria-pressed', 'true');
        renderLots();
        toast('已依距離重新排序');
      },
      (err) => {
        btn.disabled = false;
        toast(err.code === 1
          ? '你拒絕了定位權限，所以無法依距離排序'
          : '抓不到目前位置，請確認定位功能已開啟');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  // ============================================================
  // 事件
  // ============================================================
  function bindEvents() {
    // 分頁
    $$('.tabbar button').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
    $('#btnBack').onclick = () => go('lots');
    $('#btnAdd').onclick = () => openLotEditor(null);
    $('#modalClose').onclick = closeModal;
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
    document.onkeydown = (e) => {
      if (e.key === 'Escape' && $('#modal').classList.contains('open')) closeModal();
    };

    // 搜尋
    const q = $('#q');
    let timer = null;
    q.oninput = () => {
      $('#searchBox').classList.toggle('has-value', q.value !== '');
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = q.value;
        state.shown = PAGE_SIZE;
        renderLots();
      }, 160);
    };
    $('#qClear').onclick = () => {
      q.value = '';
      state.query = '';
      $('#searchBox').classList.remove('has-value');
      state.shown = PAGE_SIZE;
      renderLots();
      q.focus();
    };

    // 篩選
    $$('.chip[data-filter]').forEach((c) => {
      c.onclick = () => {
        const f = c.dataset.filter;
        if (state.filters.has(f)) state.filters.delete(f);
        else state.filters.add(f);
        c.setAttribute('aria-pressed', String(state.filters.has(f)));
        state.shown = PAGE_SIZE;
        renderLots();
      };
    });
    $('#fNear').onclick = locateMe;

    // 回到最上方：滑過一個螢幕高度才出現，免得一直擋在那裡
    const toTop = $('#toTop');
    toTop.hidden = false;
    const onScroll = () => {
      toTop.classList.toggle('show', window.scrollY > window.innerHeight * 0.8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    toTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

    // 歷史紀錄的範圍切換
    $$('#rangeSeg button').forEach((b) => {
      b.onclick = () => {
        state.range = b.dataset.range;
        $$('#rangeSeg button').forEach((x) =>
          x.setAttribute('aria-pressed', String(x === b)));
        renderHistory();
      };
    });

    // 用事件委派處理卡片上的按鈕
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) {
        if (e.target.id === 'more') {
          state.shown += PAGE_SIZE * 2;
          renderLots();
        }
        return;
      }
      const { act, id } = el.dataset;

      if (act === 'fav') {
        const added = ST.favorites.toggle(id);
        el.setAttribute('aria-pressed', String(added));
        el.setAttribute('aria-label', added ? '取消收藏' : '加入收藏');
        if (state.filters.has('fav')) renderLots();
      }
      else if (act === 'detail') { renderDetail(id); go('detail'); }
      else if (act === 'start') startParking(id);
      else if (act === 'editLot') openLotEditor(findLot(id));
      else if (act === 'editFare') openFareEditor(id);
      else if (act === 'resetLot') {
        ST.overrides.clear(id);
        loadLots(); renderDetail(id); renderLots();
        toast('已還原成官方資料');
      }
      else if (act === 'delLot') {
        openModal('刪除停車場', `
          <p class="disclaimer" style="margin:0">
            確定要刪除「${esc(findLot(id)?.name)}」嗎？這個動作沒辦法復原。
          </p>
          <div class="modal-actions">
            <button class="btn grow" data-close>取消</button>
            <button class="btn danger grow" id="okDel">確定刪除</button>
          </div>`, () => {
          $('#okDel').onclick = () => {
            ST.custom.remove(id);
            closeModal(); loadLots(); renderLots(); go('lots');
            toast('已刪除');
          };
        });
      }
      else if (act === 'editRec') {
        openRecordEditor(ST.history.all().find((r) => r.id === id));
      }
      else if (act === 'delRec') {
        openModal('刪除這筆紀錄', `
          <p class="disclaimer" style="margin:0">刪除後就找不回來了，確定嗎？</p>
          <div class="modal-actions">
            <button class="btn grow" data-close>取消</button>
            <button class="btn danger grow" id="okDelRec">確定刪除</button>
          </div>`, () => {
          $('#okDelRec').onclick = () => {
            ST.history.remove(id);
            closeModal(); renderHistory();
            toast('已刪除');
          };
        });
      }
    });
  }

  // ============================================================
  // 啟動
  // ============================================================
  function init() {
    if (!window.PARKING_DATA) {
      $('#lots').innerHTML = emptyState('info', '停車場資料載入失敗',
        '請確認 app/data/parking.js 檔案存在。');
      return;
    }

    loadLots();
    bindEvents();
    renderLots();

    // 打開 App 時如果有進行中的停車，直接跳到計時中
    if (ST.active.get()) {
      $('#timerBadge').hidden = false;
      go('timer');
    }

    if (!ST.isWorking()) {
      toast('這個瀏覽器不允許儲存資料，紀錄可能無法保存');
    }

    registerOffline();
  }

  /**
   * 啟用離線功能。
   * 直接用檔案總管打開（file://）時瀏覽器不允許，這時候略過就好，
   * 不影響其他功能。
   */
  function registerOffline() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;

    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('離線功能無法啟用', err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
