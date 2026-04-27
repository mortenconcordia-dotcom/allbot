'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH =
  process.env.DB_PATH ||
  (fs.existsSync('/data') ? '/data/deliveries.db' : 'deliveries.db');

let db;

function getDb() {
  if (!db) db = new Database(DB_PATH);
  return db;
}

// ---------- init ----------

function initDb() {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      created_by_chat_id INTEGER NOT NULL,
      created_by_name TEXT,
      supplier_chat_id INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,

      site_address TEXT NOT NULL,
      delivery_dt TEXT NOT NULL DEFAULT '',
      contact_person TEXT NOT NULL,
      contact_phone TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL,
      comment TEXT,

      accepted_at TEXT,
      closed_at TEXT,
      undelivered_items TEXT,
      supplier_note TEXT,

      delivery_car_info TEXT,
      delivery_eta TEXT,
      status_set_by_chat_id INTEGER,
      status_set_by_name TEXT,
      status_set_at TEXT
    );

    CREATE TABLE IF NOT EXISTS request_additions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_by_chat_id INTEGER NOT NULL,
      supplier_chat_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SENT',
      supplier_note TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // migrations
  const cols = d.pragma('table_info(requests)').map(r => r.name);
  const migrations = [
    'supplier_chat_id', 'accepted_at', 'closed_at', 'undelivered_items',
    'supplier_note', 'delivery_car_info', 'delivery_eta',
    'status_set_by_chat_id', 'status_set_by_name', 'status_set_at',
  ];
  for (const col of migrations) {
    if (!cols.includes(col)) {
      try { d.exec(`ALTER TABLE requests ADD COLUMN ${col} TEXT`); } catch (_) {}
    }
  }
}

// ---------- settings ----------

function getSetting(key, defaultVal = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : defaultVal;
}

function setSetting(key, value) {
  getDb()
    .prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value);
}

// ---------- users ----------

function upsertUser(chatId, role, name) {
  getDb()
    .prepare(`INSERT INTO users (chat_id, role, name, created_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(chat_id) DO UPDATE SET role=excluded.role, name=excluded.name`)
    .run(chatId, role, name, new Date().toISOString());
}

function getUser(chatId) {
  return getDb().prepare('SELECT * FROM users WHERE chat_id=?').get(chatId) || null;
}

function listSuppliers(limit = 50) {
  return getDb()
    .prepare(`SELECT chat_id, role, name FROM users WHERE role='SUPPLIER' ORDER BY name IS NULL, name ASC LIMIT ?`)
    .all(limit)
    .map(r => ({ chat_id: r.chat_id, role: r.role, name: r.name || String(r.chat_id) }));
}

function listSupplierChatIds() {
  return getDb()
    .prepare(`SELECT chat_id FROM users WHERE role='SUPPLIER'`)
    .all()
    .map(r => r.chat_id);
}

function listUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at ASC').all();
}

function setUserRole(chatId, role) {
  getDb().prepare('UPDATE users SET role=? WHERE chat_id=?').run(role, chatId);
}

function deleteUser(chatId) {
  getDb().prepare('DELETE FROM users WHERE chat_id=?').run(chatId);
}

// ---------- requests ----------

function createRequest({ createdByChatId, createdByName, supplierChatId, siteAddress, deliveryDt, contactPerson, contactPhone, items, comment }) {
  const info = getDb().prepare(`
    INSERT INTO requests (
      created_at, created_by_chat_id, created_by_name, supplier_chat_id, status,
      site_address, delivery_dt, contact_person, contact_phone, items, comment,
      accepted_at, closed_at, undelivered_items, supplier_note,
      delivery_car_info, delivery_eta, status_set_by_chat_id, status_set_by_name, status_set_at
    ) VALUES (?, ?, ?, ?, 'SENT', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
  `).run(
    new Date().toISOString(),
    createdByChatId, createdByName, supplierChatId,
    siteAddress, deliveryDt || '', contactPerson, contactPhone || '',
    items, comment || ''
  );
  return info.lastInsertRowid;
}

function getRequest(reqId) {
  return getDb().prepare('SELECT * FROM requests WHERE id=?').get(reqId) || null;
}

function listActiveForUser(chatId, limit = 20) {
  return getDb().prepare(`
    SELECT * FROM requests
    WHERE created_by_chat_id=?
      AND status IN ('SENT','ACCEPTED','QUESTION','SHORTAGE','ASSEMBLING','DELAYED','SHIPPED','ON_ROUTE')
    ORDER BY id ASC LIMIT ?
  `).all(chatId, limit);
}

function listActiveForSupplier(_supplierChatId, limit = 20) {
  return getDb().prepare(`
    SELECT * FROM requests
    WHERE status IN ('SENT','ACCEPTED','QUESTION','SHORTAGE','ASSEMBLING','DELAYED','SHIPPED','ON_ROUTE')
    ORDER BY id ASC LIMIT ?
  `).all(limit);
}

function listOpenDeliveriesForSupplier(supplierChatId, limit = 50) {
  return getDb().prepare(`
    SELECT * FROM requests
    WHERE supplier_chat_id=?
      AND status NOT IN ('CLOSED','REJECTED')
    ORDER BY id ASC LIMIT ?
  `).all(supplierChatId, limit);
}

function setRequestStatus(reqId, status, supplierNote = null) {
  getDb().prepare('UPDATE requests SET status=?, supplier_note=? WHERE id=?').run(status, supplierNote, reqId);
}

function setRequestProgress(reqId, status, { setByOhatId, setByName, deliveryCarInfo = null, deliveryEta = null } = {}) {
  getDb().prepare(`
    UPDATE requests
    SET status=?,
        delivery_car_info=COALESCE(?, delivery_car_info),
        delivery_eta=COALESCE(?, delivery_eta),
        status_set_by_chat_id=?,
        status_set_by_name=?,
        status_set_at=?
    WHERE id=?
  `).run(status, deliveryCarInfo, deliveryEta, setByOhatId, setByName, new Date().toISOString(), reqId);
}

function setRequestSupplier(reqId, supplierChatId) {
  getDb().prepare('UPDATE requests SET supplier_chat_id=? WHERE id=?').run(supplierChatId, reqId);
}

function markClosed(reqId) {
  getDb().prepare(`UPDATE requests SET status='CLOSED', closed_at=? WHERE id=?`).run(new Date().toISOString(), reqId);
}

function setUndelivered(reqId, undeliveredItems) {
  getDb().prepare(`UPDATE requests SET status='SHORTAGE', undelivered_items=? WHERE id=?`).run(undeliveredItems, reqId);
}

function appendItems(reqId, extraItems) {
  const row = getDb().prepare('SELECT items FROM requests WHERE id=?').get(reqId);
  if (!row) return;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const updated = (row.items || '').trim() + `\n\n➕ ДОПОЛНЕНИЕ (${stamp}):\n` + extraItems.trim();
  getDb().prepare('UPDATE requests SET items=? WHERE id=?').run(updated, reqId);
}

function listAllRequests() {
  return getDb().prepare('SELECT * FROM requests ORDER BY id ASC').all();
}

const EDITABLE_FIELDS = new Set([
  'status', 'supplier_chat_id', 'site_address', 'delivery_dt',
  'contact_person', 'contact_phone', 'items', 'comment',
  'supplier_note', 'undelivered_items', 'delivery_car_info',
  'delivery_eta', 'status_set_by_chat_id', 'status_set_by_name', 'status_set_at',
]);

function updateRequestField(reqId, field, value) {
  if (!EDITABLE_FIELDS.has(field)) throw new Error('Field not editable');
  getDb().prepare(`UPDATE requests SET ${field}=? WHERE id=?`).run(value, reqId);
}

// ---------- additions ----------

function createAddition({ requestId, createdByChatId, supplierChatId, text }) {
  const info = getDb().prepare(`
    INSERT INTO request_additions (request_id, created_at, created_by_chat_id, supplier_chat_id, text, status, supplier_note)
    VALUES (?, ?, ?, ?, ?, 'SENT', NULL)
  `).run(requestId, new Date().toISOString(), createdByChatId, supplierChatId, text);
  return info.lastInsertRowid;
}

function getAddition(addId) {
  return getDb().prepare('SELECT * FROM request_additions WHERE id=?').get(addId) || null;
}

function setAdditionStatus(addId, status, supplierNote = null) {
  getDb().prepare('UPDATE request_additions SET status=?, supplier_note=? WHERE id=?').run(status, supplierNote, addId);
}

function listAdditionsForRequest(requestId, limit = 10) {
  return getDb().prepare(`
    SELECT id, created_at, status, supplier_note, text
    FROM request_additions
    WHERE request_id=?
    ORDER BY id ASC LIMIT ?
  `).all(requestId, limit);
}

module.exports = {
  DB_PATH,
  initDb,
  getSetting, setSetting,
  upsertUser, getUser, listSuppliers, listSupplierChatIds,
  listUsers, setUserRole, deleteUser,
  createRequest, getRequest,
  listActiveForUser, listActiveForSupplier, listOpenDeliveriesForSupplier,
  setRequestStatus, setRequestProgress, setRequestSupplier,
  markClosed, setUndelivered, appendItems,
  listAllRequests, updateRequestField,
  createAddition, getAddition, setAdditionStatus, listAdditionsForRequest,
};
