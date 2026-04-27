import { SECRET_CODE } from '../config.js';
import { States } from '../states.js';
import { adminMenuKeyboard } from '../keyboards/admin.js';

/**
 * Перехватывает секретный код 337137 в любом состоянии.
 * Сохраняет снапшот текущего состояния для восстановления при выходе.
 */
export async function secretAdminMiddleware(ctx, next) {
  const text = ctx.message?.text?.trim();
  if (!text || text !== SECRET_CODE) return next();

  const state = ctx.session.botState.state ?? '';

  // Не входим в админку если уже в ней
  if (state.startsWith('admin:')) return next();

  // Снапшот текущего состояния
  ctx.session.botState._preAdminState = state;
  ctx.session.botState._preAdminData  = { ...ctx.session.botState };

  ctx.session.botState.state = States.ADMIN_MENU;

  await ctx.reply('🔐 <b>Панель администратора</b>\n\nВыберите действие:', {
    parse_mode: 'HTML',
    reply_markup: adminMenuKeyboard(),
  });

  console.log(`[Admin] Пользователь ${ctx.from.id} вошёл в панель администратора`);
  // Прерываем цепочку — обычные хендлеры не вызываются
}
