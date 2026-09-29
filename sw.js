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

const VERSION = 'v1';
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

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只處理自己的檔案，外部連結（例如 Google 地圖）不攔截
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      // 背景更新：就算有存檔，也順便去看看有沒有新版
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => null);

      // 有存檔就先用存檔（快），沒有才等網路
      return cached || fresh.then((res) => res || offlineFallback(req));
    })
  );
});

/** 完全沒網路又沒存檔時，至少回傳首頁而不是錯誤畫面 */
function offlineFallback(req) {
  if (req.mode === 'navigate') return caches.match('./index.html');
  return new Response('離線中，這個檔案還沒有存到手機裡。', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
