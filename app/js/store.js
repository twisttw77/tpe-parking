/**
 * 本機儲存
 * ============================================================
 * 你的停車紀錄、收藏、自建停車場、自訂費率都存在這裡。
 *
 * 存放位置是「這台裝置的瀏覽器」，不會上傳到任何地方，
 * 也因此換手機或清除瀏覽器資料就會不見 —— 所以一定要搭配匯出備份功能。
 *
 * 每個讀寫都包了防護：在無痕視窗、或瀏覽器禁止儲存時不會整個當掉。
 */

(function (global) {
  'use strict';

  const PREFIX = 'tpe-parking:';
  const KEYS = {
    history: PREFIX + 'history',     // 歷史停車紀錄
    active: PREFIX + 'active',       // 進行中的停車（同時只會有一筆）
    custom: PREFIX + 'custom',       // 自己新增的停車場
    favorites: PREFIX + 'favorites', // 收藏的停車場 id
    overrides: PREFIX + 'overrides', // 對官方資料的修改（含自訂費率）
    notes: PREFIX + 'notes',         // 個人備註
    settings: PREFIX + 'settings',   // 偏好設定
  };

  let storageWorks = true;

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      storageWorks = false;
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      storageWorks = false;
      console.warn('無法儲存資料', e);
      return false;
    }
  }

  /** 產生一個不會重複的編號 */
  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  // ============================================================
  // 進行中的停車
  // ============================================================
  const active = {
    get() { return read(KEYS.active, null); },
    /**
     * 開始停車
     * @param {object} lot 停車場
     * @param {number} [startAt] 進場時間，不給就是現在
     */
    start(lot, startAt) {
      const session = {
        id: uid('s'),
        lotId: lot.id,
        lotName: lot.name,
        operator: lot.operator || null,
        startAt: startAt ? new Date(startAt).getTime() : Date.now(),
        floor: '',
        space: '',
      };
      write(KEYS.active, session);
      return session;
    },
    update(patch) {
      const cur = active.get();
      if (!cur) return null;
      const next = { ...cur, ...patch };
      write(KEYS.active, next);
      return next;
    },
    clear() { write(KEYS.active, null); },
  };

  // ============================================================
  // 歷史紀錄
  // ============================================================
  const history = {
    all() {
      const list = read(KEYS.history, []);
      return Array.isArray(list) ? list.sort((a, b) => b.endAt - a.endAt) : [];
    },
    add(record) {
      const list = read(KEYS.history, []);
      const item = { id: uid('h'), ...record };
      list.push(item);
      write(KEYS.history, list);
      return item;
    },
    update(id, patch) {
      const list = read(KEYS.history, []);
      const i = list.findIndex((r) => r.id === id);
      if (i < 0) return null;
      list[i] = { ...list[i], ...patch };
      write(KEYS.history, list);
      return list[i];
    },
    remove(id) {
      write(KEYS.history, read(KEYS.history, []).filter((r) => r.id !== id));
    },
    clear() { write(KEYS.history, []); },
  };

  // ============================================================
  // 收藏
  // ============================================================
  const favorites = {
    all() {
      const v = read(KEYS.favorites, []);
      return Array.isArray(v) ? v : [];
    },
    has(id) { return favorites.all().includes(id); },
    toggle(id) {
      const list = favorites.all();
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1); else list.push(id);
      write(KEYS.favorites, list);
      return i < 0; // true 表示剛剛加入收藏
    },
  };

  // ============================================================
  // 自己新增的停車場
  // ============================================================
  const custom = {
    all() {
      const v = read(KEYS.custom, []);
      return Array.isArray(v) ? v : [];
    },
    add(lot) {
      const list = custom.all();
      const item = { ...lot, id: lot.id || uid('c'), isCustom: true };
      list.push(item);
      write(KEYS.custom, list);
      return item;
    },
    update(id, patch) {
      const list = custom.all();
      const i = list.findIndex((l) => l.id === id);
      if (i < 0) return null;
      list[i] = { ...list[i], ...patch };
      write(KEYS.custom, list);
      return list[i];
    },
    remove(id) {
      write(KEYS.custom, custom.all().filter((l) => l.id !== id));
    },
  };

  // ============================================================
  // 對官方資料的修改
  // 使用者改過的欄位存在這裡，顯示時會蓋在官方資料上面。
  // 這讓「還原成官方資料」變得很簡單：把這筆刪掉就好。
  // ============================================================
  const overrides = {
    all() { return read(KEYS.overrides, {}) || {}; },
    get(id) { return overrides.all()[id] || null; },
    set(id, patch) {
      const map = overrides.all();
      map[id] = { ...(map[id] || {}), ...patch };
      write(KEYS.overrides, map);
      return map[id];
    },
    clear(id) {
      const map = overrides.all();
      delete map[id];
      write(KEYS.overrides, map);
    },
    count() { return Object.keys(overrides.all()).length; },
  };

  // ============================================================
  // 個人備註
  // ============================================================
  const notes = {
    all() { return read(KEYS.notes, {}) || {}; },
    get(id) { return notes.all()[id] || ''; },
    set(id, text) {
      const map = notes.all();
      if (text && text.trim()) map[id] = text.trim();
      else delete map[id];
      write(KEYS.notes, map);
    },
  };

  // ============================================================
  // 偏好設定
  // ============================================================
  const settings = {
    all() { return read(KEYS.settings, {}) || {}; },
    get(key, fallback) {
      const v = settings.all()[key];
      return v === undefined ? fallback : v;
    },
    set(key, value) {
      const s = settings.all();
      s[key] = value;
      write(KEYS.settings, s);
    },
  };

  // ============================================================
  // 匯出 / 匯入備份
  // ============================================================
  const backup = {
    /** 把所有個人資料打包成一個物件 */
    export() {
      return {
        format: 'tpe-parking-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
          history: history.all(),
          active: active.get(),
          custom: custom.all(),
          favorites: favorites.all(),
          overrides: overrides.all(),
          notes: notes.all(),
          settings: settings.all(),
        },
      };
    },

    /**
     * 讀回備份
     * @param {object} payload 備份檔內容
     * @param {'replace'|'merge'} mode replace = 蓋掉現有資料，merge = 合併
     */
    import(payload, mode = 'replace') {
      if (!payload || payload.format !== 'tpe-parking-backup') {
        throw new Error('這不是 TPE Parking 的備份檔');
      }
      const d = payload.data || {};

      if (mode === 'replace') {
        write(KEYS.history, d.history || []);
        write(KEYS.custom, d.custom || []);
        write(KEYS.favorites, d.favorites || []);
        write(KEYS.overrides, d.overrides || {});
        write(KEYS.notes, d.notes || {});
        write(KEYS.settings, d.settings || {});
        write(KEYS.active, d.active || null);
      } else {
        // 合併：用紀錄編號去重，不會重複疊加
        const seen = new Set(history.all().map((r) => r.id));
        const merged = [...history.all(), ...(d.history || []).filter((r) => !seen.has(r.id))];
        write(KEYS.history, merged);

        const seenC = new Set(custom.all().map((l) => l.id));
        write(KEYS.custom, [...custom.all(), ...(d.custom || []).filter((l) => !seenC.has(l.id))]);

        write(KEYS.favorites, [...new Set([...favorites.all(), ...(d.favorites || [])])]);
        write(KEYS.overrides, { ...overrides.all(), ...(d.overrides || {}) });
        write(KEYS.notes, { ...notes.all(), ...(d.notes || {}) });
      }

      return {
        history: (d.history || []).length,
        custom: (d.custom || []).length,
        favorites: (d.favorites || []).length,
        overrides: Object.keys(d.overrides || {}).length,
      };
    },

    /** 清空所有個人資料 */
    clearAll() {
      Object.values(KEYS).forEach((k) => {
        try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ }
      });
    },
  };

  global.Store = {
    active, history, favorites, custom, overrides, notes, settings, backup,
    uid,
    /** 瀏覽器是否允許儲存（無痕模式可能不行） */
    isWorking: () => storageWorks,
  };
})(typeof window !== 'undefined' ? window : globalThis);
