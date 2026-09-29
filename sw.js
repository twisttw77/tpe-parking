/**
 * 離線支援
 * ============================================================
 * 讓 App 在沒有網路的時候也能用 —— 地下停車場常常收不到訊號，
 * 這時候還是要能查費率、看計時、記錄停車。
 *
 * 做法：第一次打開時把程式和停車場資料存在手機裡，
 * 之後優先從手機裡讀，同時在背景偷偷檢查有沒有新版本。
 *
 * 注意：改版時一定要把 VERSION 加一，否則使用者會一直看到舊版。
 */

const VERSION = 'v2';
const CACHE = `tpe-parking-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.png',
  './app/css/style.css',
  './app/js/fare-engine.js',
  './app/js/store.js',
  './app/js/app.js',
  './app/data/parking.js',
];

// 安裝：把需要的檔案全部存起來
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('離線檔案儲存失敗', err))
  );
});

// 啟用：把舊版本的快取清掉，避免佔空間
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('tpe-parking-') && k !== CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/**
 * 停車場資料檔很大（約 2MB）但內容不常變，
 * 程式檔很小但每次更新都必須馬上生效。所以兩者用不同策略。
 */
function isBigData(url) {
  return url.pathname.includes('/app/data/') || url.pathname.endsWith('.png');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只處理自己的檔案，外部連結（例如 Google 地圖）不攔截
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    isBigData(url) ? cacheFirst(req) : networkFirst(req)
  );
});

/**
 * 程式檔：有網路就拿最新的，沒網路才用存檔。
 * 這樣更新之後打開就是新版，不會還要重整第二次才生效。
 */
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    return cached || offlineFallback(req);
  }
}

/**
 * 大檔案：先用存檔（開得快），同時在背景偷偷更新，
 * 下次打開就會是新資料。
 */
async function cacheFirst(req) {
  const cached = await caches.match(req);

  const fresh = fetch(req)
    .then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => null);

  if (cached) return cached;
  return (await fresh) || offlineFallback(req);
}

/** 完全沒網路又沒存檔時，至少回傳首頁而不是錯誤畫面 */
function offlineFallback(req) {
  if (req.mode === 'navigate') return caches.match('./index.html');
  return new Response('離線中，這個檔案還沒有存到手機裡。', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
