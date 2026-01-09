/*** SHEET NAMES ***/
const PLANS_SHEET_NAME = 'Plans';
// Використовуємо новий чистий лист, щоб не тягнути старі чекбокси/валидації.
const ORDERS_SHEET_NAME = 'OrdersClean';

/*** ORDERS COLUMNS (simple table) ***/
const ORDER_COLUMNS = [
  'date',       // Date
  'managerId',  // string
  'payer',      // string (назва)
  'region',     // string (область)
  'items',      // string (додаткові пункти/позиції)
  'comment',    // string (коментар)
  'amount',     // number (сума)
  'id'          // string (stable id)
];

/*** HELPERS ***/
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBody_(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return {};
    const raw = String(e.postData.contents || '');
    // Primary: JSON
    try {
      return JSON.parse(raw);
    } catch (jsonErr) {
      // Fallback: application/x-www-form-urlencoded or plain querystring
      // Example: action=deleteOrder&managerId=...&rowId=2
      const out = {};
      const parts = raw.split('&');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const k = decodeURIComponent(part.slice(0, eq).replace(/\+/g, ' '));
        const v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
        if (k) out[k] = v;
      }
      return out;
    }
  } catch (err) {
    return {};
  }
}

function safeString_(v) {
  return String(v == null ? '' : v).trim();
}

function normalizeAmount_(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizePlanPeriod_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM');
  }

  // Sheets can store dates as numeric serials (days since 1899-12-30).
  // If the cell isn't formatted as a date, getValues() returns a number.
  if (typeof v === 'number' && Number.isFinite(v)) {
    const serialMs = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(serialMs);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
    }
  }

  const s = String(v == null ? '' : v).trim();
  // If Sheets converted something into a verbose Date string, try parsing.
  if (!s) return '';

  // Numeric serial passed through JSON or stored as text.
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (Number.isFinite(serial)) {
      const serialMs = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(serialMs);
      if (!isNaN(d.getTime())) {
        return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
      }
    }
  }

  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  // Try parsing common verbose formats.
  // Example coming from some JSON/UI: "Mon Dec 01 2025 00:00:00 GMT+0200 (....)"
  const base = s.split(' (')[0].trim();
  let t = Date.parse(base);
  if (Number.isNaN(t)) t = Date.parse(s);
  if (!Number.isNaN(t)) {
    return Utilities.formatDate(new Date(t), Session.getScriptTimeZone(), 'yyyy-MM');
  }
  // If we can't normalize, treat as empty to avoid creating un-deletable duplicates.
  return '';
}

/*** PLANS SHEET (multi-plan) ***/
function getOrCreatePlansSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PLANS_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(PLANS_SHEET_NAME);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 5).setValues([['managerId', 'period', 'label', 'goal', 'updatedAt']]);
  }

  // Якщо стара шапка — оновимо.
  const header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 5)).getValues()[0];
  const needsRewrite = !(header[0] === 'managerId' && header[1] === 'period' && header[2] === 'label' && header[3] === 'goal');
  if (needsRewrite) {
    sh.clearContents();
    sh.getRange(1, 1, 1, 5).setValues([['managerId', 'period', 'label', 'goal', 'updatedAt']]);
  }
  return sh;
}

// Повний ресет листа Plans (обережно: видаляє всі плани)
function hardResetPlansSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PLANS_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(PLANS_SHEET_NAME);

  // Повне очищення
  sh.clearContents();
  sh.clearFormats();
  try {
    sh.getDataRange().clearDataValidations();
  } catch (e) {
    // ignore
  }

  // Мінімальна шапка
  const cols = 5;
  const existingCols = Math.max(sh.getLastColumn(), 1);
  const extra = existingCols - cols;
  if (extra > 0) {
    sh.deleteColumns(cols + 1, extra);
  } else if (extra < 0) {
    sh.insertColumnsAfter(existingCols, Math.abs(extra));
  }

  sh.getRange(1, 1, 1, cols).setValues([['managerId', 'period', 'label', 'goal', 'updatedAt']]);
  sh.setFrozenRows(1);
}

function listPlans_(managerId) {
  const sh = getOrCreatePlansSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const range = sh.getRange(2, 1, lastRow - 1, 5).getValues();
  const byPeriod = {};
  for (let i = 0; i < range.length; i++) {
    const row = range[i];
    if (String(row[0]) !== String(managerId)) continue;
    const period = normalizePlanPeriod_(row[1]);
    const plan = {
      period: period,
      label: String(row[2] || ''),
      goal: Number(row[3]) || 0,
      updatedAt: row[4] ? new Date(row[4]).toISOString() : null
    };

    // Dedupe by period (keep latest updatedAt)
    const existing = byPeriod[period];
    if (!existing) {
      byPeriod[period] = plan;
    } else {
      const a = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
      const b = plan.updatedAt ? Date.parse(plan.updatedAt) : 0;
      if (b >= a) byPeriod[period] = plan;
    }
  }
  return Object.keys(byPeriod).map(k => byPeriod[k]);
}

function upsertPlan_(managerId, period, label, goal) {
  const sh = getOrCreatePlansSheet_();
  const now = new Date();
  const safePeriod = normalizePlanPeriod_(period);
  const safeLabel = String(label || '').trim();
  const safeGoal = Number(goal);

  if (!safePeriod) return;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    sh.appendRow([managerId, safePeriod, safeLabel, safeGoal, now]);
    return;
  }

  // Enforce uniqueness: for (managerId, period) keep exactly one row.
  const values = sh.getRange(2, 1, lastRow - 1, 2).getValues(); // managerId + period
  const matches = [];
  for (let i = 0; i < values.length; i++) {
    const rowManager = String(values[i][0] || '');
    const rowPeriod = normalizePlanPeriod_(values[i][1]);
    if (rowManager === String(managerId) && rowPeriod === safePeriod) {
      matches.push(i + 2);
    }
  }

  if (!matches.length) {
    sh.appendRow([managerId, safePeriod, safeLabel, safeGoal, now]);
    return;
  }

  // Update the first match
  sh.getRange(matches[0], 1, 1, 5).setValues([[managerId, safePeriod, safeLabel, safeGoal, now]]);

  // Delete duplicates (bottom-up)
  for (let i = matches.length - 1; i >= 1; i--) {
    sh.deleteRow(matches[i]);
  }
}

function deletePlan_(managerId, period) {
  const sh = getOrCreatePlansSheet_();
  const safePeriod = normalizePlanPeriod_(period);
  if (!safePeriod) return false;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return false;

  const values = sh.getRange(2, 1, lastRow - 1, 2).getValues(); // managerId + period
  let deleted = 0;
  // Delete bottom-up to keep indices stable
  for (let i = values.length - 1; i >= 0; i--) {
    const rowManager = String(values[i][0] || '');
    const rowPeriod = normalizePlanPeriod_(values[i][1]);
    if (rowManager === String(managerId) && rowPeriod === safePeriod) {
      sh.deleteRow(i + 2);
      deleted++;
    }
  }
  return deleted > 0;
}

/*** ORDERS SHEET ***/
function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};

  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  header.forEach((name, idx) => {
    const key = String(name || '').trim();
    if (key) map[key] = idx;
  });
  return map;
}

function applyOrderSheetEnhancements_(sheet) {
  try {
    sheet.setFrozenRows(1);

    const headerMap = getHeaderMap_(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const rows = lastRow - 1;
    if (headerMap.date !== undefined) {
      sheet.getRange(2, headerMap.date + 1, rows, 1).setNumberFormat('yyyy-mm-dd');
    }
    if (headerMap.amount !== undefined) {
      sheet.getRange(2, headerMap.amount + 1, rows, 1).setNumberFormat('#,##0.00');
    }
  } catch (e) {
    // ignore
  }
}

function ensureOrderIds_(sheet, headerMap) {
  try {
    if (sheet.getLastRow() < 2) return;
    if (headerMap.id === undefined) return;

    const rows = sheet.getLastRow() - 1;
    const idCol = headerMap.id + 1;
    const ids = sheet.getRange(2, idCol, rows, 1).getValues();

    let changed = false;
    for (let r = 0; r < ids.length; r++) {
      const v = String(ids[r][0] || '').trim();
      if (!v) {
        ids[r][0] = Utilities.getUuid();
        changed = true;
      }
    }

    if (changed) sheet.getRange(2, idCol, rows, 1).setValues(ids);
  } catch (e) {
    // ignore
  }
}

function findOrderRowById_(sheet, headerMap, managerId, orderId) {
  if (!orderId) return 0;
  if (sheet.getLastRow() < 2) return 0;
  if (headerMap.id === undefined || headerMap.managerId === undefined) return 0;

  const rows = sheet.getLastRow() - 1;
  const data = sheet.getRange(2, 1, rows, ORDER_COLUMNS.length).getValues();
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const mId = String(row[headerMap.managerId] || '');
    const id = String(row[headerMap.id] || '');
    if (String(mId) === String(managerId) && String(id) === String(orderId)) {
      return i + 2;
    }
  }
  return 0;
}

function ensureOrderHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ORDER_COLUMNS.length).setValues([ORDER_COLUMNS]);
    applyOrderSheetEnhancements_(sheet);
    return;
  }

  // Force header to our simple schema.
  const existingCols = Math.max(sheet.getLastColumn(), 1);
  if (existingCols < ORDER_COLUMNS.length) {
    sheet.insertColumnsAfter(existingCols, ORDER_COLUMNS.length - existingCols);
  }
  sheet.getRange(1, 1, 1, ORDER_COLUMNS.length).setValues([ORDER_COLUMNS]);

  // Remove extra columns to keep the table "simple".
  const extra = sheet.getLastColumn() - ORDER_COLUMNS.length;
  if (extra > 0) sheet.deleteColumns(ORDER_COLUMNS.length + 1, extra);

   // Clear validations/formats below header to avoid legacy FALSE/checkbox artifacts.
  if (sheet.getLastRow() > 1) {
    const rows = sheet.getLastRow() - 1;
    sheet.getRange(2, 1, rows, ORDER_COLUMNS.length).clearDataValidations();
  }

  applyOrderSheetEnhancements_(sheet);
}

function getOrCreateOrdersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Прибираємо старий лист 'Orders', щоб не плодилися чекбокси з минулих версій.
  const legacy = ss.getSheetByName('Orders');
  if (legacy) ss.deleteSheet(legacy);

  let sheet = ss.getSheetByName(ORDERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(ORDERS_SHEET_NAME);
  ensureOrderHeader_(sheet);
  return sheet;
}

function setupOrdersSheet() {
  getOrCreateOrdersSheet_();
}

function myFunction() {
  setupOrdersSheet();
}

// Якщо в листі залишились старі колонки/чекбокси — запустіть цю функцію один раз вручну.
function hardResetOrdersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ORDERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ORDERS_SHEET_NAME);
  }

  // Повне очищення
  sheet.clearContents();
  sheet.clearFormats();
  try {
    const rng = sheet.getDataRange();
    rng.clearDataValidations();
  } catch (e) {
    // ignore
  }

  // Прибираємо зайві колонки та виставляємо рівно потрібну кількість
  const existingCols = Math.max(sheet.getLastColumn(), 1);
  const extra = existingCols - ORDER_COLUMNS.length;
  if (extra > 0) {
    sheet.deleteColumns(ORDER_COLUMNS.length + 1, extra);
  } else if (extra < 0) {
    const need = ORDER_COLUMNS.length - existingCols;
    sheet.insertColumnsAfter(existingCols, need);
  }

  // Заголовок
  sheet.getRange(1, 1, 1, ORDER_COLUMNS.length).setValues([ORDER_COLUMNS]);
  applyOrderSheetEnhancements_(sheet);
}

/*** API ***/
function doGet(e) {
  const managerId = e && e.parameter ? String(e.parameter.managerId || '') : '';
  const action = e && e.parameter ? String(e.parameter.action || '') : '';

  if (!managerId) return json_({ error: 'managerId is required' });

  if (action === 'getConfig') {
    const plans = listPlans_(managerId);
    return json_({ plans });
  }
  if (action === 'getPlans') {
    const plans = listPlans_(managerId);
    return json_({ plans });
  }

  const sheet = getOrCreateOrdersSheet_();
  const headerMap = getHeaderMap_(sheet);
  ensureOrderIds_(sheet, headerMap);

  const data = sheet.getDataRange().getValues();
  data.shift();

  const managerCol = headerMap.managerId;
  const dateCol = headerMap.date;
  const payerCol = headerMap.payer;
  const regionCol = headerMap.region;
  const itemsCol = headerMap.items;
  const commentCol = headerMap.comment;
  const amountCol = headerMap.amount;
  const idCol = headerMap.id;

  let total = 0;
  const history = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowManagerId = managerCol !== undefined ? String(row[managerCol] || '') : '';
    if (String(rowManagerId) !== String(managerId)) continue;

    const date = dateCol !== undefined ? row[dateCol] : row[0];
    const payer = payerCol !== undefined ? row[payerCol] : row[2];
    const region = regionCol !== undefined ? row[regionCol] : '';
    const items = itemsCol !== undefined ? row[itemsCol] : '';
    const comment = commentCol !== undefined ? row[commentCol] : '';
    const amount = amountCol !== undefined ? row[amountCol] : row[3];
    const id = idCol !== undefined ? row[idCol] : '';

    total += Number(amount) || 0;

    let dateOut = date;
    try {
      if (date instanceof Date && !isNaN(date.getTime())) {
        dateOut = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
    } catch (e) {
      // ignore
    }

    history.push({
      rowId: i + 2,
      date: dateOut,
      id: String(id || ''),
      payer: payer,
      region: region,
      items: items,
      comment: comment,
      amount: amount
    });
  }

  return json_({
    total: total,
    history: history,
    plans: listPlans_(managerId)
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const params = parseBody_(e);

    const action = String(params.action || '');

    // If an action is provided but not supported, do NOT fall through to order creation.
    // This prevents cases where delete/update requests accidentally create blank rows.
    const allowedActions = {
      deleteOrder: true,
      updateOrder: true,
      setConfig: true,
      setPlan: true,
      deletePlan: true
    };
    if (action && !allowedActions[action]) {
      return json_({ ok: false, error: 'unknown action' });
    }

    if (action === 'deleteOrder' || action === 'updateOrder') {
      const managerId = String(params.managerId || '');
      const orderId = safeString_(params.id || params.orderId);
      const rowId = Number(params.rowId);
      if (!managerId) return json_({ ok: false, error: 'managerId is required' });

      const sheet = getOrCreateOrdersSheet_();
      const headerMap = getHeaderMap_(sheet);
      ensureOrderIds_(sheet, headerMap);

      let resolvedRowId = 0;
      if (orderId) resolvedRowId = findOrderRowById_(sheet, headerMap, managerId, orderId);
      if (!resolvedRowId) {
        // Backward-compatible fallback
        if (!Number.isFinite(rowId) || rowId < 2) return json_({ ok: false, error: 'rowId is required' });
        resolvedRowId = rowId;
      }

      const lastRow = sheet.getLastRow();
      if (resolvedRowId > lastRow) return json_({ ok: false, error: 'rowId out of range' });

      const row = sheet.getRange(resolvedRowId, 1, 1, ORDER_COLUMNS.length).getValues()[0];
      const rowManagerId = headerMap.managerId !== undefined ? String(row[headerMap.managerId] || '') : '';
      if (String(rowManagerId) !== String(managerId)) return json_({ ok: false, error: 'forbidden' });

      if (action === 'deleteOrder') {
        sheet.deleteRow(resolvedRowId);
        return json_({ ok: true });
      }

      // updateOrder
      const payer = safeString_(params.payer);
      if (!payer) return json_({ ok: false, error: 'payer is required' });

      const region = safeString_(params.region);
      const items = safeString_(params.items);
      const comment = safeString_(params.comment);
      const amount = normalizeAmount_(params.amount);

      let dateVal = row[headerMap.date] || new Date();
      const dateStr = safeString_(params.date);
      if (dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        if (!isNaN(d.getTime())) dateVal = d;
      }

      if (headerMap.date !== undefined) row[headerMap.date] = dateVal;
      if (headerMap.payer !== undefined) row[headerMap.payer] = payer;
      if (headerMap.region !== undefined) row[headerMap.region] = region;
      if (headerMap.items !== undefined) row[headerMap.items] = items;
      if (headerMap.comment !== undefined) row[headerMap.comment] = comment;
      if (headerMap.amount !== undefined) row[headerMap.amount] = amount;

      sheet.getRange(resolvedRowId, 1, 1, ORDER_COLUMNS.length).setValues([row]);
      applyOrderSheetEnhancements_(sheet);
      return json_({ ok: true });
    }

    if (action === 'setConfig' || action === 'setPlan') {
      const managerId = String(params.managerId || '');
      if (!managerId) return json_({ ok: false, error: 'managerId is required' });

      const period = params.period || params.month || '';
      const label = params.label || params.periodLabel || params.month || '';
      const goal = params.goal;
      upsertPlan_(managerId, period, label, goal);
      return json_({ ok: true });
    }

    if (action === 'deletePlan') {
      const managerId = String(params.managerId || '');
      if (!managerId) return json_({ ok: false, error: 'managerId is required' });

      const period = String(params.period || params.month || '').trim();
      if (!period) return json_({ ok: false, error: 'period is required' });

      const ok = deletePlan_(managerId, period);
      return json_({ ok: ok });
    }

    const managerId = String(params.managerId || '');
    if (!managerId) return json_({ ok: false, error: 'managerId is required' });

    if (!params.payer) return json_({ ok: false, error: 'payer is required' });

    const sheet = getOrCreateOrdersSheet_();
    const headerMap = getHeaderMap_(sheet);

    const now = new Date();
    let dateVal = now;
    const dateStr = safeString_(params.date);
    if (dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      if (!isNaN(d.getTime())) dateVal = d;
    }
    const payer = safeString_(params.payer);
    const region = safeString_(params.region);
    const items = safeString_(params.items);
    const comment = safeString_(params.comment);
    const amount = normalizeAmount_(params.amount);

    // Allow caller to provide a stable id (e.g. Firestore doc id) so that
    // delete/update requests can reliably find the row later.
    const providedId = safeString_(params.id || params.orderId);
    const id = providedId || Utilities.getUuid();

    const row = new Array(ORDER_COLUMNS.length).fill('');

    if (headerMap.date !== undefined) row[headerMap.date] = dateVal;
    if (headerMap.managerId !== undefined) row[headerMap.managerId] = managerId;
    if (headerMap.payer !== undefined) row[headerMap.payer] = payer;
    if (headerMap.region !== undefined) row[headerMap.region] = region;
    if (headerMap.items !== undefined) row[headerMap.items] = items;
    if (headerMap.comment !== undefined) row[headerMap.comment] = comment;
    if (headerMap.amount !== undefined) row[headerMap.amount] = amount;
    if (headerMap.id !== undefined) row[headerMap.id] = id;

    // If we already have this id, update in place to avoid duplicates.
    if (providedId) {
      ensureOrderIds_(sheet, headerMap);
      const existingRowId = findOrderRowById_(sheet, headerMap, managerId, id);
      if (existingRowId) {
        sheet.getRange(existingRowId, 1, 1, row.length).setValues([row]);
        applyOrderSheetEnhancements_(sheet);
        return json_({ ok: true, id: id, updated: true });
      }
    }

    // New orders at the top (row 2)
    sheet.insertRowAfter(1);
    sheet.getRange(2, 1, 1, row.length).setValues([row]);
    applyOrderSheetEnhancements_(sheet);

    return json_({ ok: true, id: id, created: true });
  } finally {
    lock.releaseLock();
  }
}
