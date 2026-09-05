/* ===================== 報價單匯出系統 - 前端邏輯 ===================== */

// 請將此網址換成你部署後的 GAS 執行網址（.../exec）
const GAS_URL = 'https://script.google.com/macros/s/AKfycby6_k1MtdA07FIN26lBYNkoYTpW-Hm4H7bJ4gkVkkCjZvonj7Lz4vKEjvOJV4ybZ2Oc/exec';
const FRONTEND_VERSION = '2026-09-06-v9';
const EXPECTED_BACKEND_VERSION = '2026-09-06-v9'; // 要跟 Code.gs 裡的 BACKEND_VERSION 一致

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

// 解析後端存的 "yyyy/MM/dd HH:mm" 字串為 Date
function parseDateLoose(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
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
  statFilter: 'all', // all | exported | notExported | notConfigured
  cycleFilter: 'all', // all | 7天 | 10天 | 15天 | 30天
  search: '',
  wizard: null // 見 openWizard()
};

/* ---------------- API ---------------- */
// 一律走 JSONP：跨網域（GitHub Pages → Apps Script）直接用 fetch 讀寫在部分瀏覽器/行動裝置環境下
// 會卡住不回應，改用 <script> 標籤讀取可穩定繞過（讀取與寫入都走這個管道）。
function jsonp(url, params) {
  return new Promise((resolve, reject) => {
    const cbName = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const qs = new URLSearchParams(Object.assign({}, params || {}, { callback: cbName })).toString();
    const script = document.createElement('script');
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('連線逾時，請確認 GAS_URL 是否正確、部署存取權限是否為「任何人」'));
    }, 25000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      script.remove();
    }
    window[cbName] = data => {
      if (done) return;
      done = true;
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('無法連線到後端服務，請確認 GAS_URL 是否正確'));
    };
    script.src = url + '?' + qs;
    document.body.appendChild(script);
  });
}
function apiCall(action, params) {
  const encoded = {};
  Object.entries(params || {}).forEach(([k, v]) => {
    encoded[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
  });
  return jsonp(GAS_URL, Object.assign({ action }, encoded)).then(res => {
    if (res && res.backendVersion) checkVersionMismatch(res.backendVersion);
    return res;
  }).catch(err => {
    // 寫入類動作若沒收到回應，伺服器端有可能其實已經執行成功（只是回應沒送達瀏覽器）。
    // 背景分幾次重新讀取最新資料，讓畫面在數秒到十幾秒內自動校正，不用使用者手動重新整理。
    if (action !== 'getData') {
      loadCustomers(false);
      setTimeout(() => loadCustomers(false), 4000);
      setTimeout(() => loadCustomers(false), 10000);
    }
    throw err;
  });
}
function apiGet(action, params) { return apiCall(action, params); }

async function loadCustomers(showLoading) {
  if (showLoading) setLoading(true, '載入客戶資料…');
  try {
    const res = await apiGet('getData');
    if (!res.ok) throw new Error(res.error || '讀取失敗');
    state.customers = res.customers || [];
    renderTable();
    renderStats();
  } catch (err) {
    toast('err', '載入失敗：' + err.message);
  } finally {
    if (showLoading) setLoading(false);
  }
}

// 版本比對：後端版本跟前端預期不同，代表 Code.gs 沒有部署新版本，或瀏覽器還在用舊快取的 app.js
let versionWarned = false;
function checkVersionMismatch(backendVersion) {
  const banner = document.getElementById('versionBanner');
  if (!banner) return;
  if (backendVersion && backendVersion !== EXPECTED_BACKEND_VERSION) {
    banner.style.display = 'flex';
    banner.querySelector('span').textContent =
      `⚠ 偵測到版本不一致：網頁預期後端版本「${EXPECTED_BACKEND_VERSION}」，但目前 Apps Script 實際回應的是「${backendVersion}」。這通常代表 Code.gs 只存檔、還沒「部署新版本」。請到 Apps Script →「部署」→「管理部署作業」→ 編輯 → 版本選「新版本」→ 部署。`;
    if (!versionWarned) { versionWarned = true; toast('err', '偵測到後端版本不是最新，請重新部署 Apps Script（詳見畫面上方提示）'); }
  } else {
    banner.style.display = 'none';
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
    const res = await apiCall('getItemCodes', { code });
    return (res && res.ok && Array.isArray(res.codes)) ? res.codes : [];
  } catch (err) { return []; }
}

// 核心轉換：套用欄位對應 + 無單價自動補0 + 與上次匯出比對新增品項，回傳排序後的紀錄陣列
function buildConvertedRecords(rawRows, dataStartRowIdx, columnMap, productCodeMode, previousCodes) {
  const identityField = getIdentityField(productCodeMode);
  const prevSet = new Set(previousCodes || []);
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
    rec._isNew = prevSet.size > 0 ? !prevSet.has(rec[identityField]) : false;
    recs.push(rec);
  }
  recs.sort((a, b) => (a._isNew === b._isNew) ? 0 : (a._isNew ? 1 : -1));
  return recs;
}

async function exportWorkbook(customer, records) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('匯入格式');
  const FONT_NAME = '微軟正黑體';
  const FONT_SIZE = 11;
  const THIN = { style: 'thin', color: { argb: 'FF000000' } };
  const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

  const headerRow = ws.addRow(OUTPUT_HEADERS);
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = { name: FONT_NAME, size: FONT_SIZE };
    cell.border = BORDER;
    cell.alignment = { vertical: 'middle', horizontal: colNumber === 3 ? 'left' : undefined };
  });

  const widths = [12, 16, 12, 26, 14, 10, 16, 14, 14, 14, 10, 14, 14];
  ws.columns = widths.map(w => ({ width: w }));

  records.forEach(rec => {
    const priceVal = toNumberIfPossible(rec['單價']);
    const row = ws.addRow([
      customer.code,
      customer.name || '',
      rec['貨號'] || '',
      rec['品名'] || '',
      rec['單位'] || '',
      priceVal,
      rec['備註'] || '',
      rec['產區品種'] || '',
      rec['裝箱方式'] || '',
      rec['包裝資材'] || '',
      rec['產地'] || '',
      rec['不報價原因'] || '',
      rec['變價原因'] || ''
    ]);
    row.getCell(3).numFmt = '@';
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = rec._isNew
        ? { name: FONT_NAME, size: FONT_SIZE, color: { argb: 'FFFF524D' } }
        : { name: FONT_NAME, size: FONT_SIZE };
      cell.border = BORDER;
      cell.alignment = { vertical: 'middle', horizontal: colNumber === 3 ? 'left' : undefined };
      if (rec._isNew) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFDE5A' } };
      }
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
// 清單較小時直接跟著 markExported 一起送；太大時（網址長度限制）先標記狀態，再分批 append。
async function persistExportResult(customer, records, outName) {
  const identityField = getIdentityField(customer.productCodeMode);
  const codes = records.map(r => r[identityField]).filter(Boolean);
  const codesJson = JSON.stringify(codes);
  let res;
  if (codesJson.length <= 1400) {
    res = await apiCall('markExported', { code: customer.code, fileName: outName, itemCount: records.length, itemCodes: codesJson });
  } else {
    res = await apiCall('markExported', { code: customer.code, fileName: outName, itemCount: records.length });
    const CHUNK = 100;
    for (let i = 0; i < codes.length; i += CHUNK) {
      const chunk = codes.slice(i, i + CHUNK);
      await apiCall('appendItemCodes', { code: customer.code, codes: chunk, isFirst: i === 0 });
    }
  }
  return res;
}

/* ---------------- 統計與表格渲染 ---------------- */
function renderStats() {
  const total = state.customers.length;
  let exportedN = 0, notExportedN = 0, notConfiguredN = 0;
  state.customers.forEach(c => {
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
  return state.customers.filter(c => {
    const info = computeDueInfo(c);
    if (state.statFilter === 'exported' && info.state !== 'active') return false;
    if (state.statFilter === 'notExported' && info.state === 'active') return false;
    if (state.statFilter === 'notConfigured' && c.mapping) return false;
    if (state.cycleFilter !== 'all' && c.quoteCycle !== state.cycleFilter) return false;
    if (kw && !(String(c.code).toLowerCase().includes(kw) || String(c.name).toLowerCase().includes(kw))) return false;
    return true;
  });
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
    return `<tr>
      <td class="code">${escapeHtml(c.code)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td class="mono" style="font-size:12.5px;">${escapeHtml(c.productCodeMode)}</td>
      <td class="mono" style="font-size:12.5px;">${escapeHtml(c.quoteCycle)}</td>
      <td>${mapBadge}</td>
      <td>${expBadge}</td>
      <td class="actions">
        ${actionBtn}
        <button class="btn small btn-ghost" data-act="history" data-code="${escapeHtml(c.code)}">查看紀錄</button>
        <button class="btn-icon" data-act="menu" data-code="${escapeHtml(c.code)}">⋮</button>
      </td>
    </tr>`;
  }).join('');
}

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
  } catch (err) {
    toast('err', '操作失敗，頁面可能不是最新版本，請重新整理或確認部署檔案是否為最新：' + err.message);
  }
});

async function unexportCustomer(customer) {
  if (!confirm(`確定要清除 ${customer.code} 的匯出紀錄嗎？清除後將視為「尚未匯出過」，到期日重新計算。`)) return;
  setLoading(true, '更新狀態…');
  try {
    const res = await apiCall('resetExportStatus', { code: customer.code });
    if (!res.ok) throw new Error(res.error || '更新失敗');
    upsertCustomer(res.customer);
    toast('ok', `已清除 ${customer.code} 的匯出紀錄`);
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
}

async function reconfigureMapping(customer) {
  if (!confirm(`確定要清除 ${customer.code} 已設定的欄位對應範本嗎？下次上傳時需要重新設定。`)) return;
  setLoading(true, '清除設定中…');
  try {
    const res = await apiCall('clearMapping', { code: customer.code });
    if (!res.ok) throw new Error(res.error || '清除失敗');
    upsertCustomer(res.customer);
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
  document.getElementById('historyTitle').textContent = `匯出紀錄－${customer.code} ${customer.name || ''}`;
  document.getElementById('historyTable').innerHTML = rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('');
  openModal('ovHistory');
}

/* ---------------- 篩選列（搜尋 / 週期 / 統計卡） ---------------- */
document.getElementById('searchInput').addEventListener('input', e => {
  state.search = e.target.value; renderTable();
});
document.getElementById('cycleFilter').addEventListener('change', e => {
  state.cycleFilter = e.target.value; renderTable();
});
document.getElementById('statCards').addEventListener('click', e => {
  const card = e.target.closest('.stat-card');
  if (!card) return;
  state.statFilter = card.getAttribute('data-filter');
  document.querySelectorAll('#statCards .stat-card').forEach(c => c.classList.toggle('active', c === card));
  renderTable();
});

document.getElementById('btnResetAll').addEventListener('click', async () => {
  if (!confirm('確定要清除「全部」客戶的匯出紀錄嗎？清除後全部客戶會變成「尚未匯出過」，到期日重新計算。')) return;
  setLoading(true, '重置中…');
  try {
    const res = await apiCall('resetAllExportStatus', {});
    if (!res.ok) throw new Error(res.error || '重置失敗');
    state.customers = res.customers;
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

document.getElementById('btnSaveCustomer').addEventListener('click', async () => {
  const code = document.getElementById('custCode').value.trim();
  const name = document.getElementById('custName').value.trim();
  if (!code) { toast('err', '請輸入客戶代號'); return; }
  setLoading(true, '儲存中…');
  try {
    const res = await apiCall('saveCustomer', {
      customer: {
        code, name,
        productCodeMode: document.getElementById('custProductCodeMode').value,
        quoteCycle: document.getElementById('custQuoteCycle').value,
        exportStatus: document.getElementById('custExportStatus').value
      }
    });
    if (!res.ok) throw new Error(res.error || '儲存失敗');
    upsertCustomer(res.customer);
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
    if (codeIdx === -1) { toast('err', '找不到「客戶代號」欄位，請確認第一列為標題列'); return; }
    batchParsed = [];
    for (let i = 1; i < rows.length; i++) {
      const code = String(rows[i][codeIdx] || '').trim();
      if (!code) continue;
      const name = nameIdx > -1 ? String(rows[i][nameIdx] || '').trim() : '';
      batchParsed.push({ code, name });
    }
    document.getElementById('batchSummary').textContent = `辨識到 ${batchParsed.length} 筆客戶資料，確認後將新增或更新客戶主檔`;
    const table = document.getElementById('batchPreviewTable');
    table.innerHTML = '<thead><tr><th>客戶代號</th><th>客戶名稱</th></tr></thead><tbody>' +
      batchParsed.slice(0, 200).map(c => `<tr><td class="mono">${escapeHtml(c.code)}</td><td>${escapeHtml(c.name)}</td></tr>`).join('') +
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
    const CHUNK = 60;
    let lastRes = null;
    for (let i = 0; i < batchParsed.length; i += CHUNK) {
      const chunk = batchParsed.slice(i, i + CHUNK);
      setLoading(true, `匯入客戶中… (${Math.min(i + CHUNK, batchParsed.length)}/${batchParsed.length})`);
      lastRes = await apiCall('batchImportCustomers', { customers: chunk });
      if (!lastRes.ok) throw new Error(lastRes.error || '匯入失敗');
    }
    if (lastRes) { state.customers = lastRes.customers; renderTable(); renderStats(); }
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
        const previousCodes = await fetchPreviousCodes(job.customer.code);
        const records = buildConvertedRecords(rows, job.customer.mapping.dataStartRowIdx, job.customer.mapping.columnMap, job.customer.productCodeMode, previousCodes);
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
  state.wizard = { customer, rawRows: null, dataStartRowIdx: null, columnMap: {}, numCols: 0, convertedRecords: [], step: 1, usingSaved: false, fileName: '', previousCodes: [], isFirstEverExport: true };
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
    const [{ rows }, previousCodes] = await Promise.all([
      readWorkbookRaw(file),
      fetchPreviousCodes(state.wizard.customer.code)
    ]);
    state.wizard.rawRows = rows;
    state.wizard.fileName = file.name;
    state.wizard.previousCodes = previousCodes;
    state.wizard.isFirstEverExport = !previousCodes.length;
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
  const { rawRows, dataStartRowIdx, columnMap, customer, previousCodes } = state.wizard;
  state.wizard.convertedRecords = buildConvertedRecords(rawRows, dataStartRowIdx, columnMap, customer.productCodeMode, previousCodes);
}

function renderResultStep() {
  const recs = state.wizard.convertedRecords;
  const total = recs.length;
  const newCount = recs.filter(r => r._isNew).length;
  let extraPill;
  if (state.wizard.isFirstEverExport) {
    extraPill = `<div class="pill">首次匯出，之後上傳可自動比對新增品項</div>`;
  } else if (newCount) {
    extraPill = `<div class="pill warn">新增品項 ${newCount} 項（與上次匯出比較，黃底紅字並排至最後）</div>`;
  } else {
    extraPill = `<div class="pill">與上次匯出比較，沒有新增品項</div>`;
  }
  document.getElementById('wizResultSummary').innerHTML = `<div class="pill ok">共 ${total} 項</div>${extraPill}`;
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
    return `<tr class="${rec._isNew ? 'new-item-row' : ''}">${cells}</tr>`;
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
    const mapping = { dataStartRowIdx: state.wizard.dataStartRowIdx, columnMap: state.wizard.columnMap };
    const res = await apiCall('saveMapping', { code: state.wizard.customer.code, mapping });
    if (res.ok && res.customer) {
      state.wizard.customer = res.customer;
      upsertCustomer(res.customer);
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
    // 檔案已經下載成功，只是這次沒收到雲端狀態更新的回應（伺服器端很可能其實已寫入成功）。
    // apiCall 內部已觸發背景重新整理，這裡再補提示，表格幾秒內應該會自動校正。
    toast('err', `檔案已下載，但狀態更新沒有收到回應，正在背景重新確認最新狀態…（${err.message}）`);
  } finally {
    setLoading(false);
  }
});

/* ---------------- 初始化 ---------------- */
const _fvStamp = document.getElementById('frontendVersionStamp');
if (_fvStamp) _fvStamp.textContent = FRONTEND_VERSION; else console.warn('找不到版本標示欄位，頁面可能不是最新版本');
loadCustomers(true);
let pollTimer = setInterval(() => { if (!document.hidden) loadCustomers(false); }, 25000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadCustomers(false); // 回到分頁時立即補一次，不用等下一輪
});
