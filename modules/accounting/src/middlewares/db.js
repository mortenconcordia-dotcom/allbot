import { db } from '../database.js';

/**
 * Middleware: добавляет db в ctx.db для всех обработчиков.
 * better-sqlite3 синхронный, поэтому просто прокидываем объект.
 */
export function dbMiddleware(ctx, next) {
  ctx.db = db;
  return next();
}
