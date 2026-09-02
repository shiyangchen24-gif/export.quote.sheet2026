/* ===================== 報價單匯出系統 - 前端邏輯 ===================== */

// 請將此網址換成你部署後的 GAS 執行網址（.../exec）
const GAS_URL = 'https://script.google.com/macros/s/AKfycby6_k1MtdA07FIN26lBYNkoYTpW-Hm4H7bJ4gkVkkCjZvonj7Lz4vKEjvOJV4ybZ2Oc/exec';

const TARGET_FIELDS = [
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
// 依「報價種類」與「最後匯出時間」計算到期日與是否已逾期（本期尚未匯出的提醒）
function computeDueInfo(c) {
  const days = QUOTE_CYCLE_DAYS[c.quoteType] || 7;
  const last = parseDateLoose(c.lastExportTime);
  if (!last) return { state: 'never', due: null };
  const due = new Date(last.getTime());
  due.setDate(due.getDate() + days);
  const now = new Date();
  return { state: now >= due ? 'overdue' : 'active', due };
}

let state = {
  customers: [],
  filter: 'all',
  search: '',
  wizard: null // 見 openWizard()
};

/* ---------------- API ---------------- */
// GET 一律走 JSONP：跨網域（GitHub Pages → Apps Script）直接用 fetch 讀取
// 在部分瀏覽器/行動裝置環境下會卡住不回應，改用 <script> 標籤讀取可穩定繞過。
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
    }, 15000);
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
function apiGet(action, params) {
  return jsonp(GAS_URL, Object.assign({ action }, params || {}));
}
function apiPost(action, payload) {
  const body = Object.assign({ action }, payload || {});
  return fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

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

/* ---------------- 統計與表格渲染 ---------------- */
function renderStats() {
  const total = state.customers.length;
  let neverN = 0, overdueN = 0, activeN = 0;
  state.customers.forEach(c => {
    const info = computeDueInfo(c);
    if (info.state === 'never') neverN++;
    else if (info.state === 'overdue') overdueN++;
    else activeN++;
  });
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statPending').textContent = neverN;
  document.getElementById('statOverdue').textContent = overdueN;
  document.getElementById('statDone').textContent = activeN;
}

function filteredCustomers() {
  const kw = state.search.trim().toLowerCase();
  return state.customers.filter(c => {
    const st = computeDueInfo(c).state;
    if (state.filter !== 'all' && st !== state.filter) return false;
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
    const info = computeDueInfo(c);
    let statusCell;
    if (info.state === 'never') {
      statusCell = `<span class="badge pending">尚未匯出過</span>`;
    } else if (info.state === 'overdue') {
      statusCell = `<span class="badge" style="background:var(--rust-100);color:var(--rust-600);">⚠ 本期已到期未匯出</span>
        <div class="hint" style="margin-top:3px;">到期日 ${formatDateShort(info.due)}</div>`;
    } else {
      statusCell = `<span class="badge done">已匯出</span>
        <div class="hint" style="margin-top:3px;">下期到期 ${formatDateShort(info.due)}</div>`;
    }
    const mapTag = c.mapping
      ? '<span class="mapping-tag set">✓ 已設定</span>'
      : '<span class="mapping-tag">未設定</span>';
    return `<tr${info.state === 'overdue' ? ' style="background:var(--rust-100);"' : ''}>
      <td class="code">${escapeHtml(c.code)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td class="mono" style="font-size:12.5px;">${escapeHtml(c.quoteType)}</td>
      <td>${statusCell}</td>
      <td>${mapTag}</td>
      <td class="actions">
        <button class="btn small" data-act="upload" data-code="${escapeHtml(c.code)}">上傳報價單</button>
        <button class="btn small" data-act="edit" data-code="${escapeHtml(c.code)}">編輯</button>
        ${info.state !== 'never' ? `<button class="btn small" data-act="unexport" data-code="${escapeHtml(c.code)}">清除匯出紀錄</button>` : ''}
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
  if (act === 'upload') openWizard(customer);
  else if (act === 'edit') openCustomerModal(customer);
  else if (act === 'unexport') unexportCustomer(customer);
});

async function unexportCustomer(customer) {
  if (!confirm(`確定要清除 ${customer.code} 的匯出紀錄嗎？清除後將視為「尚未匯出過」，到期日重新計算。`)) return;
  setLoading(true, '更新狀態…');
  try {
    const res = await apiPost('resetExportStatus', { code: customer.code });
    if (!res.ok) throw new Error(res.error || '更新失敗');
    upsertCustomer(res.customer);
    toast('ok', `已清除 ${customer.code} 的匯出紀錄`);
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
}

document.getElementById('searchInput').addEventListener('input', e => {
  state.search = e.target.value; renderTable();
});
document.getElementById('statusFilter').addEventListener('click', e => {
  const btn = e.target.closest('button[data-v]');
  if (!btn) return;
  state.filter = btn.getAttribute('data-v');
  document.querySelectorAll('#statusFilter button').forEach(b => b.classList.toggle('active', b === btn));
  renderTable();
});

document.getElementById('btnResetAll').addEventListener('click', async () => {
  if (!confirm('確定要清除「全部」客戶的匯出紀錄嗎？清除後全部客戶會變成「尚未匯出過」，到期日重新計算。')) return;
  setLoading(true, '重置中…');
  try {
    const res = await apiPost('resetAllExportStatus', {});
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
  document.getElementById('custModalTitle').textContent = customer ? '編輯客戶' : '新增客戶';
  document.getElementById('custCode').value = customer ? customer.code : '';
  document.getElementById('custCode').disabled = !!customer;
  document.getElementById('custName').value = customer ? customer.name : '';
  document.getElementById('custQuoteType').value = customer ? customer.quoteType : '7天';
  document.getElementById('custTradeStatus').value = customer ? customer.tradeStatus : '核准交易';
  openModal('ovCustomer');
}
document.getElementById('btnAddCustomer').addEventListener('click', () => openCustomerModal(null));

document.getElementById('btnSaveCustomer').addEventListener('click', async () => {
  const code = document.getElementById('custCode').value.trim();
  const name = document.getElementById('custName').value.trim();
  if (!code) { toast('err', '請輸入客戶代號'); return; }
  setLoading(true, '儲存中…');
  try {
    const res = await apiPost('saveCustomer', {
      customer: {
        code, name,
        quoteType: document.getElementById('custQuoteType').value,
        tradeStatus: document.getElementById('custTradeStatus').value
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
  ensureXLSX(); // 提前背景載入，讓使用者選檔案時已經準備好
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
    const res = await apiPost('batchImportCustomers', { customers: batchParsed });
    if (!res.ok) throw new Error(res.error || '匯入失敗');
    state.customers = res.customers;
    renderTable(); renderStats();
    closeModal('ovBatch');
    toast('ok', `已匯入 ${batchParsed.length} 筆客戶資料`);
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
});

/* ---------------- 上傳報價單精靈 ---------------- */
function colLetter(i) {
  let s = ''; i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function openWizard(customer) {
  state.wizard = { customer, rawRows: null, dataStartRowIdx: null, columnMap: {}, numCols: 0, convertedRecords: [], step: 1, usingSaved: false, fileName: '' };
  document.getElementById('wizardTitle').textContent = `上傳報價單 － ${customer.code} ${customer.name || ''}`;
  document.getElementById('wizardSub').textContent = customer.mapping
    ? '此客戶已設定欄位對應範本，上傳後將自動套用'
    : '首次上傳此客戶的報價單，需要設定欄位對應（之後可自動套用）';
  document.getElementById('wizFileInput').value = '';
  document.getElementById('wizSaveMapping').checked = true;
  goToWizStep(1);
  openModal('ovWizard');
  ensureXLSX(); // 提前背景載入解析用函式庫
  ensureExcelJS(); // 提前背景載入匯出用函式庫，避免到第3步才等待下載
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
    const { rows } = await readWorkbookRaw(file);
    state.wizard.rawRows = rows;
    state.wizard.fileName = file.name;
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

function guessHeaderRowIdx(rows) {
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const line = (rows[i] || []).join('');
    if (/單價/.test(line) && /(貨號|品號|產品編號|品名)/.test(line)) return i;
  }
  return -1;
}

function renderMappingStep() {
  const rows = state.wizard.rawRows;
  const headerGuessIdx = guessHeaderRowIdx(rows);
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
        ${TARGET_FIELDS.map(f => `<option value="${f.key}" ${current === f.key ? 'selected' : ''}>${f.label}</option>`).join('')}
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
  const { rawRows, dataStartRowIdx, columnMap } = state.wizard;
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
    if (!rec['貨號']) continue;
    rec._noQuote = !(rec['單價'] && rec['單價'].trim() !== '');
    recs.push(rec);
  }
  recs.sort((a, b) => (a._noQuote === b._noQuote) ? 0 : (a._noQuote ? 1 : -1));
  state.wizard.convertedRecords = recs;
}

function renderResultStep() {
  const recs = state.wizard.convertedRecords;
  const total = recs.length;
  const noQuote = recs.filter(r => r._noQuote).length;
  document.getElementById('wizResultSummary').innerHTML = `
    <div class="pill ok">共 ${total} 項</div>
    <div class="pill">正常報價 ${total - noQuote} 項</div>
    ${noQuote ? `<div class="pill warn">無報價 ${noQuote} 項（匯出時以黃底紅字標示並排至最後）</div>` : ''}
  `;
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
    return `<tr class="${rec._noQuote ? 'no-quote-row' : ''}">${cells}</tr>`;
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
    const missing = TARGET_FIELDS.filter(f => f.required && !assignedFields.has(f.key));
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
    const res = await apiPost('saveMapping', { code: state.wizard.customer.code, mapping });
    if (res.ok && res.customer) {
      state.wizard.customer = res.customer;
      upsertCustomer(res.customer);
    }
  } catch (err) { /* 靜默失敗，不影響匯出流程 */ }
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
    const priceVal = rec._noQuote ? null : toNumberIfPossible(rec['單價']);
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
      cell.font = rec._noQuote
        ? { name: FONT_NAME, size: FONT_SIZE, color: { argb: 'FFA5432C' } }
        : { name: FONT_NAME, size: FONT_SIZE };
      cell.border = BORDER;
      cell.alignment = { vertical: 'middle', horizontal: colNumber === 3 ? 'left' : undefined };
      if (rec._noQuote) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8B2' } };
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

document.getElementById('wizExport').addEventListener('click', async () => {
  const { customer, convertedRecords } = state.wizard;
  if (!convertedRecords.length) return;
  setLoading(true, '準備匯出元件…');
  try {
    await ensureExcelJS();
    setLoading(true, '產生匯出檔案…');
    const outName = await exportWorkbook(customer, convertedRecords);
    setLoading(true, '更新匯出狀態…');
    const res = await apiPost('markExported', { code: customer.code, fileName: outName, itemCount: convertedRecords.length });
    if (!res.ok) throw new Error(res.error || '更新狀態失敗');
    upsertCustomer(res.customer);
    closeModal('ovWizard');
    toast('ok', `已匯出 ${customer.code}，共 ${convertedRecords.length} 項，並標示為已匯出`);
  } catch (err) { toast('err', err.message); }
  finally { setLoading(false); }
});

/* ---------------- 初始化 ---------------- */
loadCustomers(true);
let pollTimer = setInterval(() => { if (!document.hidden) loadCustomers(false); }, 25000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadCustomers(false); // 回到分頁時立即補一次，不用等下一輪
});
