import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DB_PATH } from './config.js';

// Создаём папку если не существует
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

export const db = new Database(DB_PATH);

export function initDb() {
  // WAL-режим для защиты от потери данных при падении
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id            INTEGER UNIQUE NOT NULL,
      full_name              TEXT NOT NULL,
      username               TEXT,
      is_accountant          INTEGER NOT NULL DEFAULT 0,
      is_employee            INTEGER NOT NULL DEFAULT 0,
      is_admin               INTEGER NOT NULL DEFAULT 0,
      active_role            TEXT,
      notifications_enabled  INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sites (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id              INTEGER NOT NULL REFERENCES users(id),
      site_id                  INTEGER NOT NULL REFERENCES sites(id),
      accountant_id            INTEGER NOT NULL REFERENCES users(id),
      amount                   REAL NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'pending',
      confirmation_message_id  INTEGER,
      created_at               TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed_at             TEXT
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      created_by   INTEGER NOT NULL REFERENCES users(id),
      title        TEXT NOT NULL,
      items_text   TEXT NOT NULL,
      total_amount REAL NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS advance_requests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES users(id),
      site_id     INTEGER NOT NULL REFERENCES sites(id),
      amount      REAL NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS installments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL REFERENCES users(id),
      total_amount     REAL    NOT NULL,
      remaining_amount REAL    NOT NULL,
      status           TEXT    NOT NULL DEFAULT 'pending',
      created_by       INTEGER NOT NULL REFERENCES users(id),
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_telegram_id       ON users(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_payments_employee_id    ON payments(employee_id);
    CREATE INDEX IF NOT EXISTS idx_payments_site_id        ON payments(site_id);
    CREATE INDEX IF NOT EXISTS idx_advance_employee_id     ON advance_requests(employee_id);
    CREATE INDEX IF NOT EXISTS idx_inst_user_id            ON installments(user_id);
    CREATE INDEX IF NOT EXISTS idx_inst_status             ON installments(status);
  `);

  console.log('[DB] База данных инициализирована (WAL-режим включён)');
}
