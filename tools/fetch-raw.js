/**
 * 抓取雙北停車場的原始開放資料，存到 data/raw/
 *
 * 這些原始檔不會存進版本紀錄（.gitignore 已排除），
 * 因為檔案大且隨時可以重新下載。
 */

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'data', 'raw');

const SOURCES = [
  {
    key: 'taipei-lots',
    label: '臺北市停車場基本資料',
    url: 'https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json',
    file: 'taipei-lots.json',
  },
  {
    key: 'taipei-available',
    label: '臺北市即時剩餘車位',
    url: 'https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_allavailable.json',
    file: 'taipei-available.json',
  },
  {
    key: 'newtaipei-lots',
    label: '新北市路外公共停車場資訊',
    // 新北市平台一次最多回 1000 筆，需要翻頁
    url: 'https://data.ntpc.gov.tw/api/datasets/b1464ef0-9c7c-4a6f-abf7-6bdf32847e68/json',
    file: 'newtaipei-lots.json',
    paged: true,
  },
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error('伺服器回傳的不是資料（可能被擋下來了）');
  }
  return JSON.parse(text);
}

/** 新北市要一頁一頁抓，直到抓不到新的為止 */
async function getPaged(baseUrl) {
  const all = [];
  const size = 1000;
  for (let page = 0; page < 50; page++) {
    const rows = await getJson(`${baseUrl}?page=${page}&size=${size}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  for (const src of SOURCES) {
    process.stdout.write(`正在下載 ${src.label} ... `);
    try {
      const data = src.paged ? await getPaged(src.url) : await getJson(src.url);
      const out = path.join(RAW_DIR, src.file);
      fs.writeFileSync(out, JSON.stringify(data), 'utf8');

      const count = Array.isArray(data)
        ? data.length
        : data?.data?.park?.length ?? '?';
      console.log(`完成，${count} 筆`);
    } catch (err) {
      console.log(`失敗：${err.message}`);
      process.exitCode = 1;
    }
  }
}

main();
