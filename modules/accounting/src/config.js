import 'dotenv/config';
import path from 'path';

export const BOT_TOKEN      = process.env.BOT_TOKEN ?? '';
export const BACKUP_CHAT_ID = process.env.BACKUP_CHAT_ID ? Number(process.env.BACKUP_CHAT_ID) : 0;
export const DB_PATH        = process.env.DB_PATH ?? './data/accounting.db';
export const BACKUP_DIR     = process.env.BACKUP_DIR ?? './backups';
export const SECRET_CODE    = '337137';
