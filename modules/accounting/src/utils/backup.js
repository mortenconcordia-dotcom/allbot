import fs from 'fs';
import path from 'path';
import { DB_PATH, BACKUP_DIR, BACKUP_CHAT_ID } from '../config.js';

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function cleanupOldBackups(keep = 30) {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);

  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
      console.log(`[Backup] Удалён старый бэкап: ${f.name}`);
    } catch (e) {
      console.warn(`[Backup] Не удалось удалить бэкап ${f.name}:`, e.message);
    }
  }
}

export function createLocalBackup() {
  try {
    ensureBackupDir();
    const dbPath = path.resolve(DB_PATH);
    if (!fs.existsSync(dbPath)) {
      console.warn('[Backup] Файл БД не найден, бэкап пропущен');
      return null;
    }

    const ts         = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(BACKUP_DIR, `accounting_${ts}.db`);

    fs.copyFileSync(dbPath, backupPath);

    // WAL-файлы если есть
    for (const ext of ['-wal', '-shm']) {
      const src = dbPath + ext;
      if (fs.existsSync(src)) fs.copyFileSync(src, backupPath + ext);
    }

    cleanupOldBackups();
    console.log(`[Backup] Локальный бэкап создан: ${path.basename(backupPath)}`);
    return backupPath;
  } catch (e) {
    console.error('[Backup] Ошибка создания локального бэкапа:', e.message);
    return null;
  }
}

export async function sendTelegramBackup(bot) {
  if (!BACKUP_CHAT_ID) {
    console.warn('[Backup] BACKUP_CHAT_ID не задан, Telegram-бэкап пропущен');
    return false;
  }

  try {
    const dbPath = path.resolve(DB_PATH);
    if (!fs.existsSync(dbPath)) {
      console.warn('[Backup] Файл БД не найден для Telegram-бэкапа');
      return false;
    }

    const data     = fs.readFileSync(dbPath);
    const sizeKb   = (data.length / 1024).toFixed(1);
    const ts       = new Date().toLocaleString('ru-RU');
    const fileName = `accounting_backup_${new Date().toISOString().slice(0, 10)}.db`;

    await bot.api.sendDocument(
      BACKUP_CHAT_ID,
      new File([data], fileName),
      {
        caption: `🗄 <b>Резервная копия БД</b>\n📅 ${ts}\n📦 Размер: ${sizeKb} КБ`,
        parse_mode: 'HTML',
      }
    );

    console.log(`[Backup] Telegram-бэкап отправлен в чат ${BACKUP_CHAT_ID}`);
    return true;
  } catch (e) {
    console.error('[Backup] Ошибка отправки Telegram-бэкапа:', e.message);
    return false;
  }
}

export async function runScheduledLocalBackup() {
  console.log('[Backup] Запуск планового локального бэкапа...');
  createLocalBackup();
}

export async function runScheduledTelegramBackup(bot) {
  console.log('[Backup] Запуск планового Telegram-бэкапа...');
  createLocalBackup();
  await sendTelegramBackup(bot);
}
