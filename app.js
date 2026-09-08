/* ===================== 報價單匯出系統 - 前端邏輯（Supabase 版） ===================== */

// 請填入你的 Supabase 專案資訊：Supabase 後台 →「Project Settings」→「API」
//   - SUPABASE_URL：例如 https://abcdefghijklmnop.supabase.co（結尾不要加斜線 /，也不要自己加 /rest/v1 之類的路徑）
//   - SUPABASE_ANON_KEY：「Project API keys」裡的 anon / public key（不是 service_role！）
// 這把 anon key 之後會直接出現在網頁原始碼裡，這是正常且必要的（前端本來就要用它連線），
// 資料的存取權限由 Supabase 那邊的 Row Level Security 規則控制，不是靠隱藏這把 key 來保護。
const SUPABASE_URL = 'https://ovjdtzzvpafomivbuecb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92amR0enp2cGFmb21pdmJ1ZWNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTMyODUsImV4cCI6MjEwNDQyOTI4NX0.gJleE2ca_bPoKgAJsJqb6sn5RVBczIxHUxImxStjWDE';
const FRONTEND_VERSION = '2026-09-09-supabase-v4';

// 驗證是不是一個「看起來像樣」的 Supabase URL：https 開頭、能被解析成正常網址、
// 且不是還沒填的預設值。單純檢查字串開頭不是預設文字是不夠的——像是貼到多餘的空白、
// 斜線、引號，或是把 anon key 貼錯欄位，都可能造成 Supabase 用戶端內部組網址失敗，
// 出現「Invalid path specified in request URL」這種不容易懂的錯誤，所以這裡先擋掉。
function isConfiguredSupabaseUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.indexOf('YOUR_SUPABASE_URL') !== -1) return false;
  const trimmed = url.trim();
  if (trimmed !== url) return false; // 前後有多餘空白，代表複製貼上時可能出錯
  try {
    const u = new URL(trimmed);
    return u.protocol === 'https:' && u.hostname.length > 3 && (u.pathname === '' || u.pathname === '/');
  } catch (e) { return false; }
}
function isConfiguredSupabaseKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (key.indexOf('YOUR_SUPABASE_ANON_KEY') !== -1) return false;
  return key.trim() === key && key.length > 20;
}

const _sbConfigOk = typeof supabase !== 'undefined' && isConfiguredSupabaseUrl(SUPABASE_URL) && isConfiguredSupabaseKey(SUPABASE_ANON_KEY);
let sb = null;
let sbInitError = '';
if (_sbConfigOk) {
  try {
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    sbInitError = 'Supabase 用戶端建立失敗：' + err.message + '（請確認 SUPABASE_URL／SUPABASE_ANON_KEY 是否貼對、貼完整）';
  }
} else if (typeof supabase === 'undefined') {
  sbInitError = 'Supabase 函式庫沒有載入成功，請確認 index.html 裡的 supabase-js CDN 標籤沒被刪掉、網路也能連到 cdn.jsdelivr.net';
} else if (!isConfiguredSupabaseUrl(SUPABASE_URL)) {
  sbInitError = 'SUPABASE_URL 格式不正確或還沒填：請確認是完整的 https://xxxxxxxx.supabase.co（結尾不要有斜線、前後不要有空白或引號）';
} else if (!isConfiguredSupabaseKey(SUPABASE_ANON_KEY)) {
  sbInitError = 'SUPABASE_ANON_KEY 格式不正確或還沒填：請確認貼的是 Project Settings → API 裡的 anon / public key';
}

function assertSb() {
  if (!sb) throw new Error(sbInitError || '尚未設定 Supabase 連線資訊，請在 app.js 開頭填入 SUPABASE_URL 與 SUPABASE_ANON_KEY');
}

const TARGET_FIELDS_BASE = [
  { key: '貨號',     label: '客戶貨號 *',   required: true },
  { key: '品名',     label: '客戶商品名稱', required: false },
  { key: '單位',     label: '客戶規格單位', required: false },
  { key: '單價',     label: '單價 *',       required: true },
  { key: '備註',     label: '備註',         required: false },
  { key: '產區品種', label: '產區/品種',    required: false },
  { key: '裝箱方式', label: '裝箱方式',     required: false },
  { key: '包裝資材', label: '包裝資材',     required: false },
  { key: '產地',     label: '產地',         required: false },
  { key: '不報價原因', label: '不報價原因', required: false },
  { key: '變價原因', label: '變價原因',     required: false }
];
// 「無貨號」客戶改用商品名稱當識別欄位；必填標記需要跟著換
function getTargetFields(productCodeMode) {
  const noCode = productCodeMode === '無貨號';
  return TARGET_FIELDS_BASE.map(f => {
    if (f.key === '貨號') return Object.assign({}, f, { required: !noCode, label: noCode ? '客戶貨號（無則留空）' : '客戶貨號 *' });
    if (f.key === '品名') return Object.assign({}, f, { required: noCode, label: noCode ? '客戶商品名稱 *' : '客戶商品名稱' });
    return f;
  });
}
function getIdentityField(productCodeMode) {
  return productCodeMode === '無貨號' ? '品名' : '貨號';
}

const OUTPUT_HEADERS = ['*客戶代號','客戶名稱','*客戶貨號','客戶商品名稱','客戶規格單位','*單價','備註','產區/品種','裝箱方式','包裝資材','產地','不報價原因','變價原因'];
const OUTPUT_FIELD_ORDER = [null, null, '貨號', '品名', '單位', '單價', '備註', '產區品種', '裝箱方式', '包裝資材', '產地', '不報價原因', '變價原因'];

const QUOTE_CYCLE_DAYS = { '7天': 7, '10天': 10, '15天': 15, '30天': 30 };

// Supabase 的 timestamptz 欄位回傳的是標準 ISO 字串（例如 2026-09-06T01:43:00+00:00），
// 用原生 Date 建構子就能正確解析，不再需要自己拼格式，也不會有 Google Sheets 自動轉型的問題。
function parseDateLoose(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function formatDateShort(d) {
  if (!d) return '';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
// 依「報價週期」與「最後匯出時間」計算到期日：never(從沒匯出過) / active(有效期內) / overdue(逾期未匯出)
function computeDueInfo(c) {
  const days = QUOTE_CYCLE_DAYS[c.quoteCycle] || 7;
  const last = parseDateLoose(c.lastExportTime);
  if (!last) return { state: 'never', due: null };
  const due = new Date(last.getTime());
  due.setDate(due.getDate() + days);
  const now = new Date();
  return { state: now >= due ? 'overdue' : 'active', due };
}
// 匯出狀態徽章：二元顯示（已匯出/尚未匯出），never 與 overdue 都視為「尚未匯出」
function computeExportBadge(c) {
  const info = computeDueInfo(c);
  if (info.state === 'active') return { label: '已匯出', cls: 'badge-green', due: info.due, overdue: false };
  return { label: '尚未匯出', cls: 'badge-red', due: info.due, overdue: info.state === 'overdue' };
}

let state = {
  customers: [],
  activeTab: 'hasCode', // hasCode | noCode
  statFilter: 'all', // all | exported | notExported | notConfigured
  cycleFilter: 'all', // all | 7天 | 10天 | 15天 | 30天
  search: '',
  masterItems: [], // {itemCode, itemName, unit}[] — 全公司共用，切到「無貨號客戶」頁籤時載入
  wizard: null, // 見 openWizard()
  lookupWizard: null // 見 openLookupWizard()（無貨號客戶：上傳料號對照表）
};

/* ---------------- 資料列轉換：Supabase 的 snake_case 欄位 → 前端慣用的 camelCase ---------------- */
function rowToCustomer(row) {
  return {
    code: row.code,
    name: row.name || '',
    quoteCycle: row.quote_cycle || '7天',
    tradeStatus: row.trade_status || '核准交易',
    exportStatus: row.export_status || '未匯出',
    lastExportTime: row.last_export_time || '',
    lastExportFileName: row.last_export_filename || '',
    mapping: row.mapping || null,
    productCodeMode: row.product_code_mode || '有貨號',
    lastExportItemCount: row.last_export_item_count || 0,
    itemCodeLookupCount: row.item_code_lookup_count || 0
  };
}

/* ---------------- API（Supabase：讀取） ---------------- */
async function loadCustomers(showLoading) {
  if (showLoading) setLoading(true, '載入客戶資料…');
  try {
    assertSb();
    // last_item_codes／item_code_lookup 故意不列在這裡：這兩個欄位只有匯出/比對當下才需要，
    // 客戶數一多、每次輪詢都帶著全部客戶的完整清單會浪費頻寬，改成用到才單獨查
    // （見 fetchPreviousCodes／fetchItemCodeLookup）。item_code_lookup_count 只是筆數，很輕量，直接帶著沒關係。
    const { data, error } = await sb
      .from('customers')
      .select('code,name,quote_cycle,trade_status,export_status,last_export_time,last_export_filename,mapping,product_code_mode,last_export_item_count,item_code_lookup_count')
      .order('code');
    if (error) throw new Error(error.message);
    state.customers = (data || []).map(rowToCustomer);
    renderTable();
    renderStats();
  } catch (err) {
    toast('err', '載入失敗：' + err.message);
  } finally {
    if (showLoading) setLoading(false);
  }
}

// Realtime：資料在任何裝置異動時，Supabase 會主動推播通知，收到就重新整理一次，
// 不必再像過去那樣高度依賴輪詢；下面仍保留一個低頻率輪詢當作保險（例如忘了在後台開 Realtime 時）。
let realtimeChannel = null;
function setupRealtime() {
  if (!sb || realtimeChannel) return;
  try {
    realtimeChannel = sb.channel('customers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
        loadCustomers(false);
      })
      .subscribe();
  } catch (err) {
    console.warn('Realtime 訂閱失敗（不影響基本功能，仍會靠輪詢同步）：', err);
  }
}

/* ---------------- 共用 UI 工具 ---------------- */
function setLoading(on, text) {
  const ov = document.getElementById('loadingOverlay');
  if (text) document.getElementById('loadingText').textContent = text;
  ov.classList.toggle('open', !!on);
}
function toast(kind, msg) {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 260); }, 3200);
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
});
document.querySelectorAll('.overlay').forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov.id); });
});

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toNumberIfPossible(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : v;
}

/* ---------------- 延遲載入大型函式庫（加快首次進入頁面速度） ---------------- */
const _loadedScripts = {};
function loadScriptOnce(url) {
  if (_loadedScripts[url]) return _loadedScripts[url];
  _loadedScripts[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => { delete _loadedScripts[url]; reject(new Error('資源載入失敗：' + url)); };
    document.head.appendChild(s);
  });
  return _loadedScripts[url];
}
function ensureXLSX() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  return loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
}
function ensureExcelJS() {
  return Promise.all([
    typeof ExcelJS !== 'undefined' ? Promise.resolve() : loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'),
    typeof saveAs !== 'undefined' ? Promise.resolve() : loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js')
  ]);
}

/* ---------------- 讀取 Excel 檔為原始二維陣列 ---------------- */
async function readWorkbookRaw(file) {
  await ensureXLSX();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array', cellDates: false });
        const firstSheetName = wb.SheetNames[0];
        const ws = wb.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        resolve({ sheetName: firstSheetName, rows });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('檔案讀取失敗'));
    reader.readAsArrayBuffer(file);
  });
}

/* ---------------- 品項清單（用於比對新增品項） ---------------- */
async function fetchPreviousCodes(code) {
  try {
    assertSb();
    const { data, error } = await sb.from('customers').select('last_item_codes').eq('code', code).maybeSingle();
    if (error || !data) return [];
    return Array.isArray(data.last_item_codes) ? data.last_item_codes : [];
  } catch (err) { return []; }
}

/* ---------------- 無貨號客戶：料號對照（客戶品名 → 忠欣料號） ---------------- */
async function fetchItemCodeLookup(code) {
  try {
    assertSb();
    const { data, error } = await sb.from('customers').select('item_code_lookup').eq('code', code).maybeSingle();
    if (error || !data) return [];
    return Array.isArray(data.item_code_lookup) ? data.item_code_lookup : [];
  } catch (err) { return []; }
}
// 整份取代（不是合併）：使用者重新上傳，代表要用新的那份為準
async function saveItemCodeLookup(code, lookupArray) {
  assertSb();
  const { data, error } = await sb.from('customers').update({
    item_code_lookup: lookupArray, updated_at: new Date().toISOString()
  }).eq('code', code).select('code,name,quote_cycle,trade_status,export_status,last_export_time,last_export_filename,mapping,product_code_mode,last_export_item_count,item_code_lookup_count').single();
  if (error) throw new Error(error.message);
  return rowToCustomer(data);
}

/* ---------------- 忠欣品項主檔（全公司共用） ---------------- */
async function loadMasterItems() {
  try {
    assertSb();
    const { data, error } = await sb.from('master_items').select('item_code,item_name,unit').order('item_code');
    if (error) throw new Error(error.message);
    state.masterItems = (data || []).map(r => ({ itemCode: r.item_code, itemName: r.item_name || '', unit: r.unit || '' }));
    const countEl = document.getElementById('masterItemsCount');
    if (countEl) countEl.textContent = state.masterItems.length;
  } catch (err) {
    toast('err', '載入忠欣品項主檔失敗：' + err.message);
  }
}
// 整份取代：刪掉舊的、寫入新的（主檔用 code 當 key，這裡直接整批 upsert；
// 若使用者上傳的檔案刪掉了某些舊料號，舊料號仍會留著，畢竟不確定是真的下架還是漏帶，
// 由使用者自行到 Supabase 後台刪除比較保險）
async function saveMasterItems(rows) {
  assertSb();
  const payload = rows.map(r => ({ item_code: r.itemCode, item_name: r.itemName, unit: r.unit, updated_at: new Date().toISOString() }));
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK);
    const { error } = await sb.from('master_items').upsert(chunk, { onConflict: 'item_code' });
    if (error) throw new Error(error.message);
  }
  await loadMasterItems();
}

// 核心轉換：套用欄位對應 + 無單價自動補0 + 與上次匯出比對新增品項，回傳排序後的紀錄陣列
// itemCodeLookup：該客戶自己的「客戶品名 → 忠欣料號」對照（只有無貨號客戶會用到）
// masterItems：忠欣品項主檔（全公司共用），用比對到的料號回填官方單位
function buildConvertedRecords(rawRows, dataStartRowIdx, columnMap, productCodeMode, previousCodes, itemCodeLookup, masterItems) {
  const identityField = getIdentityField(productCodeMode);
  const prevSet = new Set(previousCodes || []);
  const noCode = productCodeMode === '無貨號';
  const lookupMap = new Map((itemCodeLookup || []).map(x => [x.name, x.code]));
  const masterMap = new Map((masterItems || []).map(m => [m.itemCode, m]));
  const recs = [];
  for (let r = dataStartRowIdx; r < rawRows.length; r++) {
    const row = rawRows[r] || [];
    if (row.every(c => String(c == null ? '' : c).trim() === '')) continue;
    const rec = {};
    Object.keys(columnMap).forEach(idxStr => {
      const idx = +idxStr, field = columnMap[idxStr];
      let v = row[idx]; v = v == null ? '' : String(v).trim();
      rec[field] = v;
    });
    if (!rec[identityField]) continue;
    if (!rec['單價'] || !String(rec['單價']).trim()) rec['單價'] = '0'; // 無單價自動補0
    if (noCode) {
      const matchedCode = lookupMap.get(rec['品名']);
      if (matchedCode) {
        rec['貨號'] = matchedCode;
        rec._unmatched = false;
        const master = masterMap.get(matchedCode);
        if (master && !rec['單位']) rec['單位'] = master.unit; // 客戶沒填單位時，用忠欣官方單位補上
      } else {
        rec['貨號'] = '';
        rec._unmatched = true;
      }
    }
    rec._isNew = prevSet.size > 0 ? !prevSet.has(rec[identityField]) : false;
    recs.push(rec);
  }
  // 排序：一般品項 → 新增品項(黃底) → 比對不到料號(橘底，最需要處理，排最後最顯眼)
  recs.sort((a, b) => {
    const rank = x => x._unmatched ? 2 : (x._isNew ? 1 : 0);
    return rank(a) - rank(b);
  });
  return recs;
}

async function exportWorkbook(customer, records) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('匯入格式');
  const FONT_NAME = '微軟正黑體';
  const FONT_SIZE = 11;
  // 效能關鍵：樣式物件在迴圈外先建立好、重複參照使用，不要每個儲存格都 new 一個新物件——
  // 幾百列 x 13 欄下來，光是物件配置(GC 壓力)就佔掉不少時間。ExcelJS 支援共用同一個樣式物件參照。
  const THIN = { style: 'thin', color: { argb: 'FF000000' } };
  const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  const FONT_NORMAL = { name: FONT_NAME, size: FONT_SIZE };
  const FONT_NEW = { name: FONT_NAME, size: FONT_SIZE, color: { argb: 'FFFF524D' } };
  const FONT_UNMATCHED = { name: FONT_NAME, size: FONT_SIZE, color: { argb: 'FFB35400' } };
  const ALIGN_DEFAULT = { vertical: 'middle' };
  const ALIGN_LEFT = { vertical: 'middle', horizontal: 'left' };
  const FILL_NEW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFDE5A' } };
  const FILL_UNMATCHED = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE6D1' } };

  const headerRow = ws.addRow(OUTPUT_HEADERS);
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = FONT_NORMAL;
    cell.border = BORDER;
    cell.alignment = colNumber === 3 ? ALIGN_LEFT : ALIGN_DEFAULT;
  });

  const widths = [12, 16, 12, 26, 14, 10, 16, 14, 14, 14, 10, 14, 14];
  ws.columns = widths.map(w => ({ width: w }));

  // 效能關鍵：先把所有列的值組成二維陣列，一次用 addRows 批次插入，
  // 比逐列呼叫 addRow 快上不少（ExcelJS 內部對批次插入有做優化）。
  const rowValues = records.map(rec => [
    customer.code,
    customer.name || '',
    rec['貨號'] || '',
    rec['品名'] || '',
    rec['單位'] || '',
    toNumberIfPossible(rec['單價']),
    rec['備註'] || '',
    rec['產區品種'] || '',
    rec['裝箱方式'] || '',
    rec['包裝資材'] || '',
    rec['產地'] || '',
    rec['不報價原因'] || '',
    rec['變價原因'] || ''
  ]);
  const addedRows = ws.addRows(rowValues);
  addedRows.forEach((row, i) => {
    const rec = records[i];
    row.getCell(3).numFmt = '@';
    const font = rec._unmatched ? FONT_UNMATCHED : (rec._isNew ? FONT_NEW : FONT_NORMAL);
    const fill = rec._unmatched ? FILL_UNMATCHED : (rec._isNew ? FILL_NEW : null);
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = font;
      cell.border = BORDER;
      cell.alignment = colNumber === 3 ? ALIGN_LEFT : ALIGN_DEFAULT;
      if (fill) cell.fill = fill;
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  const today = new Date();
  const stamp = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
  const outName = `${customer.code}_${customer.name || ''}_報價單匯入_${stamp}.xlsx`;
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), outName);
  return outName;
}

// 匯出成功後：更新匯出狀態，並把這次的品項識別值存起來供下次比對「新增品項」用。
// Supabase 的 jsonb 欄位沒有 GAS 網址長度那種限制，一次寫入即可，不用再分批。
async function persistExportResult(customer, records, outName) {
  assertSb();
  const identityField = getIdentityField(customer.productCodeMode);
  const codes = records.map(r => r[identityField]).filter(Boolean);
  const { data, error } = await sb.from('customers').update({
    export_status: '已匯出',
    last_export_time: new Date().toISOString(),
    last_export_filename: outName,
    last_export_item_count: records.length,
    last_item_codes: codes,
    updated_at: new Date().toISOString()
  }).eq('code', customer.code).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, customer: rowToCustomer(data) };
}

/* ---------------- 統計與表格渲染 ---------------- */
function renderStats() {
  const wantMode = state.activeTab === 'noCode' ? '無貨號' : '有貨號';
  const inTab = state.customers.filter(c => c.productCodeMode === wantMode);
  const total = inTab.length;
  let exportedN = 0, notExportedN = 0, notConfiguredN = 0;
  inTab.forEach(c => {
    const info = computeDueInfo(c);
    if (info.state === 'active') exportedN++; else notExportedN++;
    if (!c.mapping) notConfiguredN++;
  });
  const setN = (sel, v) => { const el = document.querySelector(sel); if (el) el.textContent = v; };
  setN('#statCards [data-filter="all"] .n', total);
  setN('#statCards [data-filter="exported"] .n', exportedN);
  setN('#statCards [data-filter="notExported"] .n', notExportedN);
  setN('#statCards [data-filter="notConfigured"] .n', notConfiguredN);
}

function filteredCustomers() {
  const kw = state.search.trim().toLowerCase();
  const wantMode = state.activeTab === 'noCode' ? '無貨號' : '有貨號';
  return state.customers.filter(c => {
    if (c.productCodeMode !== wantMode) return false;
    const info = computeDueInfo(c);
    if (state.statFilter === 'exported' && info.state !== 'active') return false;
    if (state.statFilter === 'notExported' && info.state === 'active') return false;
    if (state.statFilter === 'notConfigured' && c.mapping) return false;
    if (state.cycleFilter !== 'all' && c.quoteCycle !== state.cycleFilter) return false;
    if (kw && !(String(c.code).toLowerCase().includes(kw) || String(c.name).toLowerCase().includes(kw))) return false;
    return true;
  });
}

// 兩個頁籤欄位不一樣（無貨號多一欄「料號對照表」、少一欄「報價種類」，報價種類已經由頁籤本身區分），
// 用頁籤決定要渲染哪一版表頭，而不是寫兩份幾乎重複的 HTML。
function renderTableHead() {
  const thead = document.getElementById('tableHead');
  if (!thead) return;
  const cycleFilterBtn = `
    <button class="th-filter-btn" data-filter-col="quoteCycle" aria-label="篩選報價週期" title="篩選">
      <svg viewBox="0 0 16 16" width="11" height="11"><path d="M1 2h14l-5 6v5l-4 2v-7z" fill="currentColor"/></svg>
    </button>`;
  if (state.activeTab === 'noCode') {
    thead.innerHTML = `<tr>
      <th style="width:110px;">客戶代號</th>
      <th>客戶名稱</th>
      <th style="width:110px;">報價週期 ${cycleFilterBtn}</th>
      <th style="width:110px;">料號對照表</th>
      <th style="width:110px;">匯出格式</th>
      <th style="width:160px;">匯出狀態</th>
      <th style="width:320px;text-align:right;">操作</th>
    </tr>`;
  } else {
    thead.innerHTML = `<tr>
      <th style="width:110px;">客戶代號</th>
      <th>客戶名稱</th>
      <th style="width:110px;">報價週期 ${cycleFilterBtn}</th>
      <th style="width:110px;">匯出格式</th>
      <th style="width:160px;">匯出狀態</th>
      <th style="width:260px;text-align:right;">操作</th>
    </tr>`;
  }
  updateFilterIconStates();
}

function renderTable() {
  const list = filteredCustomers();
  const tbody = document.getElementById('custTbody');
  const empty = document.getElementById('emptyState');
  if (!list.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('h3').textContent = state.customers.length ? '找不到符合的客戶' : '還沒有客戶資料';
    empty.querySelector('p').textContent = state.customers.length ? '試試調整搜尋或篩選條件' : '請先「新增客戶」或「批次匯入客戶」建立客戶主檔';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = list.map(c => {
    const exp = computeExportBadge(c);
    const mapSet = !!c.mapping;
    const mapBadge = mapSet ? `<span class="badge badge-green">已設定</span>` : `<span class="badge badge-red">尚未設定</span>`;
    const expBadge = `<span class="badge ${exp.cls}">${exp.label}</span>` +
      (exp.due ? `<div class="hint" style="margin-top:3px;">${exp.overdue ? '⚠ 已逾期 ' : '到期 '}${formatDateShort(exp.due)}</div>` : '');
    const actionBtn = mapSet
      ? `<button class="btn small btn-export" data-act="export" data-code="${escapeHtml(c.code)}">匯出報價單</button>`
      : `<button class="btn small btn-upload" data-act="upload" data-code="${escapeHtml(c.code)}">上傳報價單</button>`;
    const historyMenuBtns = `
        <button class="btn small btn-ghost" data-act="history" data-code="${escapeHtml(c.code)}">查看紀錄</button>
        <button class="btn-icon" data-act="menu" data-code="${escapeHtml(c.code)}">⋮</button>`;

    if (state.activeTab === 'noCode') {
      const lookupCount = c.itemCodeLookupCount || 0;
      const lookupBadge = lookupCount > 0
        ? `<span class="badge badge-green">已設定</span><div class="hint" style="margin-top:3px;">${lookupCount} 筆</div>`
        : `<span class="badge badge-red">尚未設定</span>`;
      return `<tr>
        <td class="code">${escapeHtml(c.code)}</td>
        <td>${escapeHtml(c.name)}</td>
        <td class="mono" style="font-size:12.5px;">${escapeHtml(c.quoteCycle)}</td>
        <td>${lookupBadge}</td>
        <td>${mapBadge}</td>
        <td>${expBadge}</td>
        <td class="actions">
          <button class="btn small btn-secondary" data-act="lookup" data-code="${escapeHtml(c.code)}">上傳料號對照表</button>
          ${actionBtn}
          ${historyMenuBtns}
        </td>
      </tr>`;
    }
    return `<tr>
      <td class="code">${escapeHtml(c.code)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td class="mono" style="font-size:12.5px;">${escapeHtml(c.quoteCycle)}</td>
      <td>${mapBadge}</td>
      <td>${expBadge}</td>
      <td class="actions">
        ${actionBtn}
        ${historyMenuBtns}
      </td>
    </tr>`;
  }).join('');
}

/* ---------------- 頁籤切換（有貨號／無貨號客戶） ---------------- */
document.getElementById('tabRow').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  const tab = btn.getAttribute('data-tab');
  if (tab === state.activeTab) return;
  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
  document.getElementById('masterItemsPanel').style.display = tab === 'noCode' ? 'flex' : 'none';
  // 統計卡篩選跟表頭欄位篩選都是「頁籤內」的概念，切頁籤時重置，避免帶著上個頁籤的篩選條件卻找不到東西
  state.statFilter = 'all';
  state.cycleFilter = 'all';
  document.querySelectorAll('#statCards .stat-card').forEach(c => c.classList.toggle('active', c.getAttribute('data-filter') === 'all'));
  renderTableHead();
  renderTable();
  renderStats();
  if (tab === 'noCode' && !state.masterItems.length) loadMasterItems();
});


// 用單一客戶物件更新本地狀態並重繪，避免每次操作都要整份清單往返
function upsertCustomer(customer) {
  if (!customer) return;
  const idx = state.customers.findIndex(c => c.code === customer.code);
  if (idx === -1) state.customers.push(customer);
  else state.customers[idx] = customer;
  renderTable();
  renderStats();
}

document.getElementById('custTbody').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const code = btn.getAttribute('data-code');
  const customer = state.customers.find(c => c.code === code);
  if (!customer) return;
  const act = btn.getAttribute('data-act');
  try {
    if (act === 'upload' || act === 'export') openWizard(customer);
    else if (act === 'history') openHistoryModal(customer);
    else if (act === 'menu') openRowMenu(btn, code);
    else if (act === 'lookup') openLookupWizard(customer);
  } catch (err) {
    toast('err', '操作失敗，頁面可能不是最新版本，請重新整理或確認部署檔案是否為最新：' + err.message);
  }
});

async function unexportCustomer(customer) {
  if (!confirm(`確定要清除 ${customer.code} 的匯出紀錄嗎？清除後將視為「尚未匯出過」，到期日重新計算。`)) return;
  setLoading(true, '更新狀態…');
  try {
    assertSb();
    const { data, error } = await sb.from('customers').update({
      export_status: '未匯出', last_export_time: null, last_export_filename: '', updated_at: new Date().toISOString()
    }).eq('code', customer.code).select().single();
    if (error) throw new Error(error.message);
    upsertCustomer(rowToCustomer(data));
    toast('ok', `已清除 ${customer.code} 的匯出紀錄`);
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
}

async function reconfigureMapping(customer) {
  if (!confirm(`確定要清除 ${customer.code} 已設定的欄位對應範本嗎？下次上傳時需要重新設定。`)) return;
  setLoading(true, '清除設定中…');
  try {
    assertSb();
    const { data, error } = await sb.from('customers').update({
      mapping: null, updated_at: new Date().toISOString()
    }).eq('code', customer.code).select().single();
    if (error) throw new Error(error.message);
    upsertCustomer(rowToCustomer(data));
    toast('ok', `已清除 ${customer.code} 的欄位對應設定`);
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
}

/* ---------------- 三點選單 ---------------- */
const rowMenuEl = document.getElementById('rowMenu');
let rowMenuCode = null;
function openRowMenu(btn, code) {
  rowMenuCode = code;
  const customer = state.customers.find(c => c.code === code);
  const unexportBtn = rowMenuEl.querySelector('[data-menu-act="unexport"]');
  const info = customer ? computeDueInfo(customer) : { state: 'never' };
  if (unexportBtn) unexportBtn.style.display = info.state !== 'never' ? 'block' : 'none';
  rowMenuEl.style.display = 'flex';
  const rect = btn.getBoundingClientRect();
  const menuRect = rowMenuEl.getBoundingClientRect();
  let top = rect.bottom + 6;
  if (top + menuRect.height > window.innerHeight) top = rect.top - menuRect.height - 6;
  let left = rect.right - menuRect.width;
  if (left < 8) left = 8;
  rowMenuEl.style.top = top + 'px';
  rowMenuEl.style.left = left + 'px';
}
function closeRowMenu() { rowMenuEl.style.display = 'none'; rowMenuCode = null; }
document.addEventListener('click', e => {
  if (e.target.closest('#rowMenu') || e.target.closest('[data-act="menu"]')) return;
  closeRowMenu();
});
rowMenuEl.addEventListener('click', e => {
  const btn = e.target.closest('button[data-menu-act]');
  if (!btn || !rowMenuCode) return;
  const customer = state.customers.find(c => c.code === rowMenuCode);
  const act = btn.getAttribute('data-menu-act');
  closeRowMenu();
  if (!customer) return;
  if (act === 'edit') openCustomerModal(customer);
  else if (act === 'reconfigure') reconfigureMapping(customer);
  else if (act === 'unexport') unexportCustomer(customer);
});

/* ---------------- 查看紀錄 Modal ---------------- */
function openHistoryModal(customer) {
  const info = computeDueInfo(customer);
  const rows = [
    ['客戶代號', customer.code],
    ['客戶名稱', customer.name || '—'],
    ['報價種類', customer.productCodeMode],
    ['報價週期', customer.quoteCycle],
    ['匯出格式', customer.mapping ? '已設定' : '尚未設定'],
    ['匯出狀態', info.state === 'active' ? '已匯出' : '尚未匯出'],
    ['最後匯出時間', customer.lastExportTime || '—'],
    ['最後匯出檔名', customer.lastExportFileName || '—'],
    ['最後匯出品項數', customer.lastExportItemCount || 0],
    ['到期日', info.due ? formatDateShort(info.due) : '—']
  ];
  if (customer.productCodeMode === '無貨號') {
    rows.splice(4, 0, ['料號對照表', customer.itemCodeLookupCount ? `已設定（${customer.itemCodeLookupCount} 筆）` : '尚未設定']);
  }
  document.getElementById('historyTitle').textContent = `匯出紀錄－${customer.code} ${customer.name || ''}`;
  document.getElementById('historyTable').innerHTML = rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('');
  openModal('ovHistory');
}

/* ---------------- 忠欣品項主檔：上傳/更新 ---------------- */
let masterItemsParsed = [];
document.getElementById('btnMasterItems').addEventListener('click', () => {
  ensureXLSX();
  masterItemsParsed = [];
  document.getElementById('masterItemsPreviewWrap').style.display = 'none';
  document.getElementById('masterItemsFileInput').value = '';
  document.getElementById('btnConfirmMasterItems').disabled = true;
  openModal('ovMasterItems');
});
setupDropzone('masterItemsDropzone', 'masterItemsFileInput', async file => {
  try {
    const { rows } = await readWorkbookRaw(file);
    if (!rows.length) { toast('err', '檔案沒有資料'); return; }
    const headerRow = rows[0].map(h => String(h || '').trim());
    const codeIdx = headerRow.findIndex(h => /料號|品號|產品編號/.test(h));
    const nameIdx = headerRow.findIndex(h => /品名|名稱|品項/.test(h));
    const unitIdx = headerRow.findIndex(h => /單位/.test(h));
    if (codeIdx === -1 || nameIdx === -1) { toast('err', '找不到「料號」或「品項名稱」欄位，請確認第一列是標題列'); return; }
    masterItemsParsed = [];
    for (let i = 1; i < rows.length; i++) {
      const itemCode = String(rows[i][codeIdx] || '').trim();
      if (!itemCode) continue;
      masterItemsParsed.push({
        itemCode,
        itemName: String(rows[i][nameIdx] || '').trim(),
        unit: unitIdx > -1 ? String(rows[i][unitIdx] || '').trim() : ''
      });
    }
    document.getElementById('masterItemsSummary').textContent = `辨識到 ${masterItemsParsed.length} 筆品項，確認後會整份取代目前的忠欣品項主檔`;
    const table = document.getElementById('masterItemsPreviewTable');
    table.innerHTML = '<thead><tr><th>料號</th><th>品項名稱</th><th>單位</th></tr></thead><tbody>' +
      masterItemsParsed.slice(0, 200).map(m => `<tr><td class="mono">${escapeHtml(m.itemCode)}</td><td>${escapeHtml(m.itemName)}</td><td>${escapeHtml(m.unit)}</td></tr>`).join('') +
      '</tbody>';
    document.getElementById('masterItemsPreviewWrap').style.display = 'block';
    document.getElementById('btnConfirmMasterItems').disabled = masterItemsParsed.length === 0;
  } catch (err) { toast('err', '解析失敗：' + err.message); }
});
document.getElementById('btnConfirmMasterItems').addEventListener('click', async () => {
  if (!masterItemsParsed.length) return;
  setLoading(true, '寫入忠欣品項主檔中…');
  try {
    await saveMasterItems(masterItemsParsed);
    closeModal('ovMasterItems');
    toast('ok', `已更新忠欣品項主檔，共 ${masterItemsParsed.length} 筆`);
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
});

/* ---------------- 客戶料號對照表：上傳（每個無貨號客戶各自一份） ---------------- */
let lookupParsed = [];
let lookupTargetCustomer = null;
function openLookupWizard(customer) {
  lookupTargetCustomer = customer;
  lookupParsed = [];
  document.getElementById('lookupTitle').textContent = `上傳料號對照表 － ${customer.code} ${customer.name || ''}`;
  document.getElementById('lookupPreviewWrap').style.display = 'none';
  document.getElementById('lookupFileInput').value = '';
  document.getElementById('btnConfirmLookup').disabled = true;
  ensureXLSX();
  openModal('ovLookup');
}
setupDropzone('lookupDropzone', 'lookupFileInput', async file => {
  try {
    const { rows } = await readWorkbookRaw(file);
    if (!rows.length) { toast('err', '檔案沒有資料'); return; }
    const headerRow = rows[0].map(h => String(h || '').trim());
    const nameIdx = headerRow.findIndex(h => /品名|名稱/.test(h));
    const codeIdx = headerRow.findIndex(h => /料號|貨號|品號/.test(h));
    if (nameIdx === -1 || codeIdx === -1) { toast('err', '找不到「客戶品名」或「料號」欄位，請確認第一列是標題列'); return; }
    lookupParsed = [];
    for (let i = 1; i < rows.length; i++) {
      const name = String(rows[i][nameIdx] || '').trim();
      const code = String(rows[i][codeIdx] || '').trim();
      if (!name || !code) continue;
      lookupParsed.push({ name, code });
    }
    document.getElementById('lookupSummary').textContent = `辨識到 ${lookupParsed.length} 筆對應，確認後會整份取代這個客戶目前的料號對照表`;
    const table = document.getElementById('lookupPreviewTable');
    table.innerHTML = '<thead><tr><th>客戶品名</th><th>忠欣料號</th></tr></thead><tbody>' +
      lookupParsed.slice(0, 200).map(x => `<tr><td>${escapeHtml(x.name)}</td><td class="mono">${escapeHtml(x.code)}</td></tr>`).join('') +
      '</tbody>';
    document.getElementById('lookupPreviewWrap').style.display = 'block';
    document.getElementById('btnConfirmLookup').disabled = lookupParsed.length === 0;
  } catch (err) { toast('err', '解析失敗：' + err.message); }
});
document.getElementById('btnConfirmLookup').addEventListener('click', async () => {
  if (!lookupParsed.length || !lookupTargetCustomer) return;
  setLoading(true, '寫入料號對照表中…');
  try {
    const customer = await saveItemCodeLookup(lookupTargetCustomer.code, lookupParsed);
    upsertCustomer(customer);
    closeModal('ovLookup');
    toast('ok', `已更新 ${customer.code} 的料號對照表，共 ${lookupParsed.length} 筆`);
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
});

/* ---------------- 篩選列（搜尋 / 統計卡 / 欄位篩選 icon） ---------------- */
document.getElementById('searchInput').addEventListener('input', e => {
  state.search = e.target.value; renderTable();
});
document.getElementById('statCards').addEventListener('click', e => {
  const card = e.target.closest('.stat-card');
  if (!card) return;
  state.statFilter = card.getAttribute('data-filter');
  document.querySelectorAll('#statCards .stat-card').forEach(c => c.classList.toggle('active', c === card));
  renderTable();
});

/* 表頭欄位篩選（報價週期旁的篩選 icon；報價種類現在由頁籤區分，不需要再篩選） */
const COLUMN_FILTER_OPTIONS = {
  quoteCycle: { stateKey: 'cycleFilter', options: [['all', '全部週期'], ['7天', '7天'], ['10天', '10天'], ['15天', '15天'], ['30天', '30天']] }
};
const colFilterMenuEl = document.getElementById('colFilterMenu');
let colFilterCurrentCol = null;

function updateFilterIconStates() {
  document.querySelectorAll('.th-filter-btn[data-filter-col]').forEach(btn => {
    const col = btn.getAttribute('data-filter-col');
    const cfg = COLUMN_FILTER_OPTIONS[col];
    if (!cfg) return;
    btn.classList.toggle('active', state[cfg.stateKey] !== 'all');
  });
}

function openColFilterMenu(btn, col) {
  const cfg = COLUMN_FILTER_OPTIONS[col];
  if (!cfg) return;
  colFilterCurrentCol = col;
  const current = state[cfg.stateKey];
  colFilterMenuEl.innerHTML = cfg.options.map(([value, label]) => `
    <label>
      <input type="radio" name="colFilterRadio" value="${value}" ${current === value ? 'checked' : ''}>
      ${escapeHtml(label)}
    </label>
  `).join('');
  colFilterMenuEl.style.display = 'flex';
  const rect = btn.getBoundingClientRect();
  const menuRect = colFilterMenuEl.getBoundingClientRect();
  let top = rect.bottom + 6;
  if (top + menuRect.height > window.innerHeight) top = rect.top - menuRect.height - 6;
  let left = rect.left;
  if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
  colFilterMenuEl.style.top = top + 'px';
  colFilterMenuEl.style.left = left + 'px';
}
function closeColFilterMenu() { colFilterMenuEl.style.display = 'none'; colFilterCurrentCol = null; }

document.querySelectorAll('.th-filter-btn[data-filter-col]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    closeRowMenu(); // 避免跟三點選單同時開著
    const col = btn.getAttribute('data-filter-col');
    if (colFilterCurrentCol === col && colFilterMenuEl.style.display === 'flex') { closeColFilterMenu(); return; }
    openColFilterMenu(btn, col);
  });
});
colFilterMenuEl.addEventListener('change', e => {
  const radio = e.target.closest('input[name="colFilterRadio"]');
  if (!radio || !colFilterCurrentCol) return;
  const cfg = COLUMN_FILTER_OPTIONS[colFilterCurrentCol];
  state[cfg.stateKey] = radio.value;
  updateFilterIconStates();
  renderTable();
  closeColFilterMenu();
});
document.addEventListener('click', e => {
  if (e.target.closest('#colFilterMenu') || e.target.closest('[data-filter-col]')) return;
  closeColFilterMenu();
});

document.getElementById('btnResetAll').addEventListener('click', async () => {
  if (!confirm('確定要清除「全部」客戶的匯出紀錄嗎？清除後全部客戶會變成「尚未匯出過」，到期日重新計算。')) return;
  setLoading(true, '重置中…');
  try {
    assertSb();
    const { data, error } = await sb.from('customers').update({
      export_status: '未匯出', last_export_time: null, last_export_filename: '', updated_at: new Date().toISOString()
    }).not('code', 'is', null).select();
    if (error) throw new Error(error.message);
    state.customers = (data || []).map(rowToCustomer);
    renderTable(); renderStats();
    toast('ok', '已清除全部客戶的匯出紀錄');
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
});

/* ---------------- 新增/編輯客戶 Modal ---------------- */
let editingCode = null;
function openCustomerModal(customer) {
  editingCode = customer ? customer.code : null;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; else console.warn('找不到欄位 #' + id + '，頁面可能不是最新版本'); };
  document.getElementById('custModalTitle').textContent = customer ? '編輯客戶' : '新增客戶';
  setVal('custCode', customer ? customer.code : '');
  document.getElementById('custCode').disabled = !!customer;
  setVal('custName', customer ? customer.name : '');
  setVal('custProductCodeMode', customer ? customer.productCodeMode : '有貨號');
  setVal('custQuoteCycle', customer ? customer.quoteCycle : '7天');
  setVal('custExportStatus', customer ? (customer.exportStatus === '已匯出' ? '已匯出' : '未匯出') : '未匯出');
  openModal('ovCustomer');
}
document.getElementById('btnAddCustomer').addEventListener('click', () => openCustomerModal(null));

// 新增/編輯客戶寫入邏輯：只有「匯出狀態」真的有變動時才動到 last_export_time，
// 避免只是改個名字之類的無關編輯，卻不小心把到期日重新起算。
async function saveCustomerToBackend(payload) {
  assertSb();
  const { data: existing, error: selErr } = await sb.from('customers').select('export_status').eq('code', payload.code).maybeSingle();
  if (selErr) throw new Error(selErr.message);
  const desired = payload.exportStatus === '已匯出' ? '已匯出' : '未匯出';
  const nowIso = new Date().toISOString();

  const upsertRow = {
    code: payload.code,
    name: payload.name || '',
    product_code_mode: payload.productCodeMode === '無貨號' ? '無貨號' : '有貨號',
    quote_cycle: ['7天', '10天', '15天', '30天'].includes(payload.quoteCycle) ? payload.quoteCycle : '7天',
    updated_at: nowIso
  };
  if (!existing) {
    upsertRow.export_status = desired;
    upsertRow.last_export_time = desired === '已匯出' ? nowIso : null;
  } else if (desired !== (existing.export_status || '未匯出')) {
    upsertRow.export_status = desired;
    if (desired === '已匯出') {
      upsertRow.last_export_time = nowIso;
    } else {
      upsertRow.last_export_time = null;
      upsertRow.last_export_filename = '';
    }
  }
  const { data, error } = await sb.from('customers').upsert(upsertRow, { onConflict: 'code' }).select().single();
  if (error) throw new Error(error.message);
  return rowToCustomer(data);
}

document.getElementById('btnSaveCustomer').addEventListener('click', async () => {
  const code = document.getElementById('custCode').value.trim();
  const name = document.getElementById('custName').value.trim();
  if (!code) { toast('err', '請輸入客戶代號'); return; }
  setLoading(true, '儲存中…');
  try {
    const customer = await saveCustomerToBackend({
      code, name,
      productCodeMode: document.getElementById('custProductCodeMode').value,
      quoteCycle: document.getElementById('custQuoteCycle').value,
      exportStatus: document.getElementById('custExportStatus').value
    });
    upsertCustomer(customer);
    closeModal('ovCustomer');
    toast('ok', '客戶資料已儲存');
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
});

/* ---------------- 批次匯入客戶 Modal ---------------- */
let batchParsed = [];
function setupDropzone(zoneId, inputId, onFile) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); });
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) onFile(f); });
}
function setupMultiDropzone(zoneId, inputId, onFiles) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files.length) onFiles(Array.from(input.files)); });
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', e => { const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []); if (files.length) onFiles(files); });
}

setupDropzone('batchDropzone', 'batchFileInput', async file => {
  try {
    const { rows } = await readWorkbookRaw(file);
    if (!rows.length) { toast('err', '檔案沒有資料'); return; }
    const headerRow = rows[0].map(h => String(h || '').trim());
    const codeIdx = headerRow.findIndex(h => h.includes('客戶代號') || h.includes('代號'));
    const nameIdx = headerRow.findIndex(h => h.includes('客戶名稱') || h.includes('名稱'));
    const modeIdx = headerRow.findIndex(h => h.includes('報價種類') || h.includes('種類'));
    const cycleIdx = headerRow.findIndex(h => h.includes('報價週期') || h.includes('週期'));
    const statusIdx = headerRow.findIndex(h => h.includes('匯出狀態'));
    if (codeIdx === -1) { toast('err', '找不到「客戶代號」欄位，請確認第一列為標題列'); return; }
    batchParsed = [];
    for (let i = 1; i < rows.length; i++) {
      const code = String(rows[i][codeIdx] || '').trim();
      if (!code) continue;
      const name = nameIdx > -1 ? String(rows[i][nameIdx] || '').trim() : '';
      const modeRaw = modeIdx > -1 ? String(rows[i][modeIdx] || '').trim() : '';
      const cycleRaw = cycleIdx > -1 ? String(rows[i][cycleIdx] || '').trim() : '';
      const statusRaw = statusIdx > -1 ? String(rows[i][statusIdx] || '').trim() : '';
      const productCodeMode = modeRaw === '無貨號' ? '無貨號' : '有貨號';
      const quoteCycle = ['7天', '10天', '15天', '30天'].includes(cycleRaw) ? cycleRaw : '7天';
      const exportStatus = statusRaw === '已匯出' ? '已匯出' : '未匯出'; // 「尚未匯出」「未匯出」或空白都視為未匯出
      batchParsed.push({ code, name, productCodeMode, quoteCycle, exportStatus });
    }
    document.getElementById('batchSummary').textContent = `辨識到 ${batchParsed.length} 筆客戶資料，確認後將新增或更新客戶主檔` +
      (modeIdx === -1 || cycleIdx === -1 || statusIdx === -1 ? '（檔案缺少部分欄位，缺的部分會用預設值：有貨號／7天／尚未匯出）' : '');
    const table = document.getElementById('batchPreviewTable');
    table.innerHTML = '<thead><tr><th>客戶代號</th><th>客戶名稱</th><th>報價種類</th><th>報價週期</th><th>匯出狀態</th></tr></thead><tbody>' +
      batchParsed.slice(0, 200).map(c => `<tr><td class="mono">${escapeHtml(c.code)}</td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.productCodeMode)}</td><td>${escapeHtml(c.quoteCycle)}</td><td>${escapeHtml(c.exportStatus === '已匯出' ? '已匯出' : '尚未匯出')}</td></tr>`).join('') +
      '</tbody>';
    document.getElementById('batchPreviewWrap').style.display = 'block';
    document.getElementById('btnConfirmBatch').disabled = batchParsed.length === 0;
  } catch (err) { toast('err', '解析失敗：' + err.message); }
});

document.getElementById('btnBatchImport').addEventListener('click', () => {
  ensureXLSX();
  batchParsed = [];
  document.getElementById('batchPreviewWrap').style.display = 'none';
  document.getElementById('batchFileInput').value = '';
  document.getElementById('btnConfirmBatch').disabled = true;
  openModal('ovBatch');
});

document.getElementById('btnConfirmBatch').addEventListener('click', async () => {
  if (!batchParsed.length) return;
  setLoading(true, '匯入客戶中…');
  try {
    assertSb();
    const nowIso = new Date().toISOString();
    // Postgres 的 upsert 沒有 GAS 網址長度那種限制，可以一次送一大批；
    // 這裡仍保留適度分批（300 筆一批）純粹是避免單次請求過大，不是為了繞過什麼限制。
    const CHUNK = 300;
    const allRows = [];
    for (let i = 0; i < batchParsed.length; i += CHUNK) {
      const chunk = batchParsed.slice(i, i + CHUNK);
      setLoading(true, `匯入客戶中… (${Math.min(i + CHUNK, batchParsed.length)}/${batchParsed.length})`);
      const payload = chunk.map(c => ({
        code: c.code,
        name: c.name,
        product_code_mode: c.productCodeMode,
        quote_cycle: c.quoteCycle,
        export_status: c.exportStatus,
        // 檔案沒有實際匯出時間可用，「已匯出」就用現在時間起算到期日；重複匯入同一批已匯出的客戶
        // 會讓到期日重新起算，這是這個批次匯入工具的已知取捨（主要設計給初次建立客戶清單用）
        last_export_time: c.exportStatus === '已匯出' ? nowIso : null,
        updated_at: nowIso
      }));
      const { data, error } = await sb.from('customers').upsert(payload, { onConflict: 'code' }).select('code,name,quote_cycle,trade_status,export_status,last_export_time,last_export_filename,mapping,product_code_mode,last_export_item_count,item_code_lookup_count');
      if (error) throw new Error(error.message);
      allRows.push(...(data || []));
    }
    allRows.forEach(row => upsertCustomer(rowToCustomer(row)));
    closeModal('ovBatch');
    toast('ok', `已匯入 ${batchParsed.length} 筆客戶資料`);
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
});

/* ---------------- 批次匯入報價單（依檔名比對客戶） ---------------- */
let batchQuotesFiles = [];
function matchCustomersByFilename(filename) {
  const configured = state.customers.filter(c => c.mapping);
  const lower = filename.toLowerCase();
  return configured.filter(c => {
    const codeHit = c.code && lower.includes(String(c.code).toLowerCase());
    const nameHit = c.name && c.name.trim() && lower.includes(c.name.trim().toLowerCase());
    return codeHit || nameHit;
  });
}

document.getElementById('btnBatchQuotes').addEventListener('click', () => {
  ensureXLSX();
  batchQuotesFiles = [];
  document.getElementById('batchQuotesPreviewWrap').style.display = 'none';
  document.getElementById('batchQuotesProgressWrap').style.display = 'none';
  document.getElementById('batchQuotesFileInput').value = '';
  document.getElementById('btnConfirmBatchQuotes').disabled = true;
  openModal('ovBatchQuotes');
});

setupMultiDropzone('batchQuotesDropzone', 'batchQuotesFileInput', files => {
  batchQuotesFiles = files.map(file => {
    const matches = matchCustomersByFilename(file.name);
    let status, customer = null;
    if (matches.length === 1) { status = 'matched'; customer = matches[0]; }
    else if (matches.length === 0) { status = 'unmatched'; }
    else { status = 'ambiguous'; }
    return { file, matches, status, customer };
  });
  renderBatchQuotesPreview();
});

function renderBatchQuotesPreview() {
  const okCount = batchQuotesFiles.filter(f => f.status === 'matched').length;
  document.getElementById('batchQuotesSummary').textContent = `共 ${batchQuotesFiles.length} 個檔案，可辨識並匯出 ${okCount} 筆`;
  const table = document.getElementById('batchQuotesPreviewTable');
  table.innerHTML = '<thead><tr><th>檔案名稱</th><th>比對到的客戶</th><th>狀態</th></tr></thead><tbody>' +
    batchQuotesFiles.map(f => {
      let matchText, statusText;
      if (f.status === 'matched') { matchText = `${f.customer.code} ${f.customer.name || ''}`; statusText = '<span class="badge badge-green">可匯出</span>'; }
      else if (f.status === 'unmatched') { matchText = '—'; statusText = '<span class="badge badge-red">找不到相符客戶</span>'; }
      else { matchText = f.matches.map(m => m.code).join('、'); statusText = '<span class="badge badge-red">比對到多個客戶</span>'; }
      return `<tr><td>${escapeHtml(f.file.name)}</td><td>${escapeHtml(matchText)}</td><td>${statusText}</td></tr>`;
    }).join('') + '</tbody>';
  document.getElementById('batchQuotesPreviewWrap').style.display = 'block';
  document.getElementById('btnConfirmBatchQuotes').disabled = okCount === 0;
}

document.getElementById('btnConfirmBatchQuotes').addEventListener('click', async () => {
  const jobs = batchQuotesFiles.filter(f => f.status === 'matched');
  if (!jobs.length) return;
  document.getElementById('batchQuotesProgressWrap').style.display = 'block';
  document.getElementById('btnConfirmBatchQuotes').disabled = true;
  let okN = 0, failN = 0;
  const failLog = [];
  try {
    await ensureExcelJS();
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      document.getElementById('batchQuotesProgress').textContent = `處理中 ${i + 1}/${jobs.length}：${job.customer.code} ${job.customer.name || ''}`;
      try {
        const { rows } = await readWorkbookRaw(job.file);
        const noCode = job.customer.productCodeMode === '無貨號';
        const previousCodes = await fetchPreviousCodes(job.customer.code);
        const itemCodeLookup = noCode ? await fetchItemCodeLookup(job.customer.code) : [];
        if (noCode && !itemCodeLookup.length) throw new Error('這個客戶還沒有上傳「料號對照表」');
        if (noCode && !state.masterItems.length) await loadMasterItems();
        const records = buildConvertedRecords(rows, job.customer.mapping.dataStartRowIdx, job.customer.mapping.columnMap, job.customer.productCodeMode, previousCodes, itemCodeLookup, state.masterItems);
        if (!records.length) throw new Error('沒有解析到任何品項，請確認欄位對應是否仍然正確');
        const outName = await exportWorkbook(job.customer, records);
        const res = await persistExportResult(job.customer, records, outName);
        if (!res.ok) throw new Error(res.error || '更新狀態失敗');
        upsertCustomer(res.customer);
        okN++;
      } catch (err) {
        failN++;
        failLog.push(`${job.customer.code}：${err.message}`);
      }
    }
  } finally {
    document.getElementById('batchQuotesProgress').textContent =
      `完成：成功 ${okN} 筆，失敗 ${failN} 筆${failLog.length ? '（' + failLog.join('；') + '）' : ''}`;
    document.getElementById('btnConfirmBatchQuotes').disabled = false;
    toast(failN ? 'err' : 'ok', `批次匯出完成：成功 ${okN} 筆${failN ? ('，失敗 ' + failN + ' 筆') : ''}`);
  }
});

/* ---------------- 上傳報價單精靈 ---------------- */
function colLetter(i) {
  let s = ''; i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function openWizard(customer) {
  state.wizard = { customer, rawRows: null, dataStartRowIdx: null, columnMap: {}, numCols: 0, convertedRecords: [], step: 1, usingSaved: false, fileName: '', previousCodes: [], itemCodeLookup: [], isFirstEverExport: true };
  document.getElementById('wizardTitle').textContent = `${customer.mapping ? '匯出報價單' : '上傳報價單'} － ${customer.code} ${customer.name || ''}`;
  document.getElementById('wizardSub').textContent = customer.mapping
    ? '此客戶已設定欄位對應範本，上傳後將自動套用並匯出'
    : '首次上傳此客戶的報價單，需要設定欄位對應（之後可自動套用）';
  document.getElementById('wizFileInput').value = '';
  document.getElementById('wizSaveMapping').checked = true;
  goToWizStep(1);
  openModal('ovWizard');
  ensureXLSX();
  ensureExcelJS();
  if (customer.productCodeMode === '無貨號' && !state.masterItems.length) loadMasterItems();
}

function goToWizStep(n) {
  state.wizard.step = n;
  document.querySelectorAll('.wiz-panel').forEach(p => { p.style.display = (+p.getAttribute('data-panel') === n) ? 'block' : 'none'; });
  document.querySelectorAll('.wizard-steps .step').forEach(s => {
    const sn = +s.getAttribute('data-step');
    s.classList.toggle('active', sn === n);
    s.classList.toggle('done', sn < n);
  });
  document.getElementById('wizBack').style.display = n > 1 ? 'inline-flex' : 'none';
  document.getElementById('wizNext').style.display = n < 3 ? 'inline-flex' : 'none';
  document.getElementById('wizExport').style.display = n === 3 ? 'inline-flex' : 'none';
}

setupDropzone('wizDropzone', 'wizFileInput', async file => {
  try {
    setLoading(true, '解析檔案中…');
    const noCode = state.wizard.customer.productCodeMode === '無貨號';
    const [{ rows }, previousCodes, itemCodeLookup] = await Promise.all([
      readWorkbookRaw(file),
      fetchPreviousCodes(state.wizard.customer.code),
      noCode ? fetchItemCodeLookup(state.wizard.customer.code) : Promise.resolve([])
    ]);
    state.wizard.rawRows = rows;
    state.wizard.fileName = file.name;
    state.wizard.previousCodes = previousCodes;
    state.wizard.itemCodeLookup = itemCodeLookup;
    state.wizard.isFirstEverExport = !previousCodes.length;
    if (noCode && !itemCodeLookup.length) {
      setLoading(false);
      toast('err', '這個客戶還沒有上傳「料號對照表」，請先在客戶列表點「上傳料號對照表」設定好，才能比對出料號');
      return;
    }
    setLoading(false);
    if (!rows.length) { toast('err', '檔案沒有資料'); return; }
    const customer = state.wizard.customer;
    if (customer.mapping && customer.mapping.columnMap && Object.keys(customer.mapping.columnMap).length) {
      state.wizard.dataStartRowIdx = customer.mapping.dataStartRowIdx;
      state.wizard.columnMap = Object.assign({}, customer.mapping.columnMap);
      state.wizard.usingSaved = true;
      computeConverted();
      if (!state.wizard.convertedRecords.length) {
        toast('err', '套用已存範本後沒有解析到任何品項，請重新設定欄位對應');
        state.wizard.usingSaved = false;
        state.wizard.columnMap = {};
        state.wizard.dataStartRowIdx = null;
        renderMappingStep();
        goToWizStep(2);
        return;
      }
      renderResultStep();
      goToWizStep(3);
    } else {
      state.wizard.usingSaved = false;
      renderMappingStep();
      goToWizStep(2);
    }
  } catch (err) { setLoading(false); toast('err', '解析失敗：' + err.message); }
});

function guessHeaderRowIdx(rows, productCodeMode) {
  const noCode = productCodeMode === '無貨號';
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const line = (rows[i] || []).join('');
    if (noCode) {
      if (/單價/.test(line) && /(品名|規格|名稱)/.test(line)) return i;
    } else {
      if (/單價/.test(line) && /(貨號|品號|產品編號|品名)/.test(line)) return i;
    }
  }
  return -1;
}

function renderMappingStep() {
  const rows = state.wizard.rawRows;
  const productCodeMode = state.wizard.customer.productCodeMode;
  const headerGuessIdx = guessHeaderRowIdx(rows, productCodeMode);
  if (state.wizard.dataStartRowIdx == null) {
    state.wizard.dataStartRowIdx = headerGuessIdx >= 0 ? headerGuessIdx + 1 : 0;
  }
  const previewRows = rows.slice(0, Math.min(30, rows.length));
  const maxCols = previewRows.reduce((m, r) => Math.max(m, r.length), 0);
  state.wizard.numCols = Math.max(maxCols, 1);

  if (!Object.keys(state.wizard.columnMap).length && headerGuessIdx >= 0) {
    const headerRow = rows[headerGuessIdx] || [];
    headerRow.forEach((txt, idx) => {
      const t = String(txt || '');
      let field = null;
      if (/貨號|品號|產品編號/.test(t)) field = '貨號';
      else if (/單價|價格|報價/.test(t)) field = '單價';
      else if (/單位/.test(t)) field = '單位';
      else if (/品名|規格|名稱/.test(t)) field = '品名';
      if (field) state.wizard.columnMap[idx] = field;
    });
  }
  renderMapPreviewTable();
  renderMapGrid();
}

function renderMapPreviewTable() {
  const rows = state.wizard.rawRows;
  const n = state.wizard.numCols;
  const previewRows = rows.slice(0, Math.min(30, rows.length));
  const thead = '<thead><tr><th></th>' + Array.from({ length: n }).map((_, i) => `<th>${colLetter(i)}</th>`).join('') + '</tr></thead>';
  const body = '<tbody>' + previewRows.map((r, idx) => {
    const cls = idx >= state.wizard.dataStartRowIdx ? 'marked-start' : '';
    const cells = Array.from({ length: n }).map((_, ci) => `<td>${escapeHtml(r[ci] != null ? r[ci] : '')}</td>`).join('');
    return `<tr class="header-row-pick ${cls}" data-row-idx="${idx}"><td class="mono" style="color:var(--ink-soft);">#${idx + 1}</td>${cells}</tr>`;
  }).join('') + '</tbody>';
  const table = document.getElementById('wizMapPreviewTable');
  table.innerHTML = thead + body;
  table.querySelectorAll('tr[data-row-idx]').forEach(tr => {
    tr.addEventListener('click', () => {
      state.wizard.dataStartRowIdx = +tr.getAttribute('data-row-idx');
      renderMapPreviewTable();
      renderMapGrid();
    });
  });
}

function renderMapGrid() {
  const rows = state.wizard.rawRows;
  const sampleRowIdx = state.wizard.dataStartRowIdx != null ? state.wizard.dataStartRowIdx : 0;
  const sampleRow = rows[sampleRowIdx] || [];
  const n = state.wizard.numCols;
  const targetFields = getTargetFields(state.wizard.customer.productCodeMode);
  const grid = document.getElementById('wizMapGrid');
  let html = '';
  for (let i = 0; i < n; i++) {
    const sample = sampleRow[i] != null ? String(sampleRow[i]) : '';
    const current = state.wizard.columnMap[i] || '';
    html += `<div>
      <div class="col-label">欄位 ${colLetter(i)}</div>
      <div class="col-sample" title="${escapeHtml(sample)}">${escapeHtml(sample) || '（空）'}</div>
      <select data-col-idx="${i}" class="mapSelect">
        <option value="">（不使用）</option>
        ${targetFields.map(f => `<option value="${f.key}" ${current === f.key ? 'selected' : ''}>${f.label}</option>`).join('')}
      </select>
    </div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.mapSelect').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = +sel.getAttribute('data-col-idx');
      if (sel.value) state.wizard.columnMap[idx] = sel.value; else delete state.wizard.columnMap[idx];
    });
  });
}

function computeConverted() {
  const { rawRows, dataStartRowIdx, columnMap, customer, previousCodes, itemCodeLookup } = state.wizard;
  state.wizard.convertedRecords = buildConvertedRecords(rawRows, dataStartRowIdx, columnMap, customer.productCodeMode, previousCodes, itemCodeLookup, state.masterItems);
}

function renderResultStep() {
  const recs = state.wizard.convertedRecords;
  const total = recs.length;
  const newCount = recs.filter(r => r._isNew).length;
  const unmatchedCount = recs.filter(r => r._unmatched).length;
  let extraPill;
  if (state.wizard.isFirstEverExport) {
    extraPill = `<div class="pill">首次匯出，之後上傳可自動比對新增品項</div>`;
  } else if (newCount) {
    extraPill = `<div class="pill warn">新增品項 ${newCount} 項（與上次匯出比較，黃底紅字並排至最後）</div>`;
  } else {
    extraPill = `<div class="pill">與上次匯出比較，沒有新增品項</div>`;
  }
  const unmatchedPill = unmatchedCount
    ? `<div class="pill" style="background:#ffe6d1;color:var(--orange-action);">比對不到料號 ${unmatchedCount} 項（橘底，仍會匯出但貨號留空，請補上料號對照表後重新匯出）</div>`
    : '';
  document.getElementById('wizResultSummary').innerHTML = `<div class="pill ok">共 ${total} 項</div>${extraPill}${unmatchedPill}`;
  const table = document.getElementById('wizResultPreviewTable');
  const customer = state.wizard.customer;
  const thead = '<thead><tr>' + OUTPUT_HEADERS.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
  const body = '<tbody>' + recs.map(rec => {
    const cells = OUTPUT_FIELD_ORDER.map((f, i) => {
      let v;
      if (i === 0) v = customer.code;
      else if (i === 1) v = customer.name;
      else v = rec[f] || '';
      return `<td>${escapeHtml(v)}</td>`;
    }).join('');
    const rowCls = rec._unmatched ? 'unmatched-row' : (rec._isNew ? 'new-item-row' : '');
    return `<tr class="${rowCls}">${cells}</tr>`;
  }).join('') + '</tbody>';
  table.innerHTML = thead + body;
}

document.getElementById('wizNext').addEventListener('click', () => {
  const step = state.wizard.step;
  if (step === 1) {
    if (!state.wizard.rawRows) { toast('err', '請先上傳檔案'); return; }
    if (state.wizard.usingSaved) { renderResultStep(); goToWizStep(3); return; }
    renderMappingStep();
    goToWizStep(2);
  } else if (step === 2) {
    const assignedFields = new Set(Object.values(state.wizard.columnMap));
    const targetFields = getTargetFields(state.wizard.customer.productCodeMode);
    const missing = targetFields.filter(f => f.required && !assignedFields.has(f.key));
    if (missing.length) { toast('err', '請先設定：' + missing.map(f => f.label).join('、')); return; }
    computeConverted();
    if (!state.wizard.convertedRecords.length) { toast('err', '依目前設定沒有解析到任何品項，請確認起始列與欄位對應'); return; }
    if (document.getElementById('wizSaveMapping').checked) saveMappingForCustomer();
    renderResultStep();
    goToWizStep(3);
  }
});

document.getElementById('wizBack').addEventListener('click', () => {
  const step = state.wizard.step;
  if (step === 3) {
    if (state.wizard.usingSaved) {
      state.wizard.usingSaved = false;
      renderMappingStep();
    }
    goToWizStep(2);
  } else if (step === 2) {
    goToWizStep(1);
  }
});

async function saveMappingForCustomer() {
  try {
    assertSb();
    const mapping = { dataStartRowIdx: state.wizard.dataStartRowIdx, columnMap: state.wizard.columnMap };
    const { data, error } = await sb.from('customers').update({
      mapping, updated_at: new Date().toISOString()
    }).eq('code', state.wizard.customer.code).select().single();
    if (!error && data) {
      const customer = rowToCustomer(data);
      state.wizard.customer = customer;
      upsertCustomer(customer);
    }
  } catch (err) { /* 靜默失敗，不影響匯出流程 */ }
}

document.getElementById('wizExport').addEventListener('click', async () => {
  const { customer, convertedRecords } = state.wizard;
  if (!convertedRecords.length) return;
  setLoading(true, '準備匯出元件…');
  let outName;
  try {
    await ensureExcelJS();
    setLoading(true, '產生匯出檔案…');
    outName = await exportWorkbook(customer, convertedRecords);
  } catch (err) {
    setLoading(false);
    toast('err', '產生匯出檔案失敗：' + err.message);
    return;
  }
  setLoading(true, '更新匯出狀態…');
  try {
    const res = await persistExportResult(customer, convertedRecords, outName);
    if (!res.ok) throw new Error(res.error || '更新狀態失敗');
    upsertCustomer(res.customer);
    closeModal('ovWizard');
    toast('ok', `已匯出 ${customer.code}，共 ${convertedRecords.length} 項，並標示為已匯出`);
  } catch (err) {
    // 檔案已經下載成功，只是這次狀態更新失敗（Supabase 走標準 REST API，這種情況比過去用
    // Google Apps Script/JSONP 時少見很多，但仍保留一次背景重新整理當保險）。
    loadCustomers(false);
    toast('err', `檔案已下載，但狀態更新失敗，已重新整理最新狀態，請確認表格是否正確（${err.message}）`);
  } finally {
    setLoading(false);
  }
});

/* ---------------- 初始化 ---------------- */
const _fvStamp = document.getElementById('frontendVersionStamp');
if (_fvStamp) _fvStamp.textContent = FRONTEND_VERSION; else console.warn('找不到版本標示欄位，頁面可能不是最新版本');
renderTableHead();
if (!sb) {
  toast('err', sbInitError || '尚未設定 Supabase 連線資訊，請在 app.js 開頭填入 SUPABASE_URL 與 SUPABASE_ANON_KEY 後再重新整理');
  console.error('[Supabase 設定問題]', sbInitError);
} else {
  loadCustomers(true);
  setupRealtime();
  // Realtime 是主要同步機制，這裡的輪詢降為低頻率保險，避免忘了在 Supabase 後台開 Realtime 時完全沒有同步
  let pollTimer = setInterval(() => { if (!document.hidden) loadCustomers(false); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadCustomers(false); // 回到分頁時立即補一次，不用等下一輪
  });
}
