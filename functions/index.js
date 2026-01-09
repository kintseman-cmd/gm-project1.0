/* eslint-disable */
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
  onDocumentWritten
} = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');

const admin = require('firebase-admin');

setGlobalOptions({ region: 'europe-west1' });

if (!admin.apps.length) {
  admin.initializeApp();
}

function requireEnv_(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function toIsoDate_(v) {
  if (!v) return '';
  try {
    if (typeof v === 'string') return v.slice(0, 10);
    if (typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 10);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch (e) {}
  return '';
}

async function postToAppsScript_(payload) {
  const SCRIPT_URL = requireEnv_('SCRIPT_URL');

  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });

  // Apps Script returns JSON, but we keep this tolerant.
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) {}

  if (!res.ok) {
    throw new Error(`Apps Script HTTP ${res.status}: ${text}`);
  }
  if (parsed && parsed.ok === false) {
    throw new Error(`Apps Script error: ${parsed.error || text}`);
  }
  return parsed || { ok: true };
}

function orderPayload_(managerId, orderId, data) {
  return {
    managerId,
    id: orderId,
    date: toIsoDate_(data?.date),
    payer: String(data?.payer || ''),
    region: String(data?.region || ''),
    items: String(data?.items || ''),
    comment: String(data?.comment || ''),
    amount: Number(data?.amount) || 0
  };
}

exports.syncOrderCreate = onDocumentCreated('managers/{managerId}/orders/{orderId}', async (event) => {
  const managerId = event.params.managerId;
  const orderId = event.params.orderId;
  const data = event.data ? event.data.data() : null;

  const payload = orderPayload_(managerId, orderId, data);
  if (!payload.payer) {
    logger.warn('skip syncOrderCreate: missing payer', { managerId, orderId });
    return;
  }

  logger.info('syncOrderCreate -> Apps Script', { managerId, orderId });
  await postToAppsScript_(payload);
});

exports.syncOrderUpdate = onDocumentUpdated('managers/{managerId}/orders/{orderId}', async (event) => {
  const managerId = event.params.managerId;
  const orderId = event.params.orderId;
  const data = event.data ? event.data.after.data() : null;

  const payload = orderPayload_(managerId, orderId, data);
  if (!payload.payer) {
    logger.warn('skip syncOrderUpdate: missing payer', { managerId, orderId });
    return;
  }

  logger.info('syncOrderUpdate -> Apps Script', { managerId, orderId });
  await postToAppsScript_({ action: 'updateOrder', ...payload });
});

exports.syncOrderDelete = onDocumentDeleted('managers/{managerId}/orders/{orderId}', async (event) => {
  const managerId = event.params.managerId;
  const orderId = event.params.orderId;

  logger.info('syncOrderDelete -> Apps Script', { managerId, orderId });
  await postToAppsScript_({ action: 'deleteOrder', managerId, id: orderId });
});

exports.syncPlanWrite = onDocumentWritten('managers/{managerId}/plans/{period}', async (event) => {
  const managerId = event.params.managerId;
  const period = event.params.period;

  // Delete
  if (!event.data || !event.data.after.exists) {
    logger.info('syncPlanDelete -> Apps Script', { managerId, period });
    await postToAppsScript_({ action: 'deletePlan', managerId, period });
    return;
  }

  // Create / Update
  const data = event.data.after.data() || {};
  const label = String(data.label || data.period || period);
  const goal = Number(data.goal) || 0;

  logger.info('syncPlanUpsert -> Apps Script', { managerId, period });
  await postToAppsScript_({ action: 'setPlan', managerId, period, label, goal });
});
