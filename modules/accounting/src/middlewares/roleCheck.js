import { States } from '../states.js';

const UNREGISTERED_ALLOWED = new Set(['/start']);

/**
 * Проверяет регистрацию пользователя.
 * Если не зарегистрирован — запускает регистрацию.
 * Кладёт ctx.user для хендлеров.
 */
export async function roleCheckMiddleware(ctx, next) {
  const fromUser = ctx.from;
  if (!fromUser) return next();

  const text = ctx.message?.text ?? '';

  // Пропускаем /start
  if (UNREGISTERED_ALLOWED.has(text.trim())) return next();

  const state = ctx.session.botState.state ?? '';

  // Если уже в процессе регистрации — пропускаем
  if (state.startsWith('registration:')) return next();

  const user = ctx.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(fromUser.id);

  if (!user) {
    if (ctx.message) {
      await ctx.reply(
        '👋 Добро пожаловать! Для начала работы необходимо зарегистрироваться.\n\nВведите ваше полное имя:'
      );
      ctx.session.botState.state = States.REGISTRATION_WAITING_NAME;
    } else if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Пожалуйста, начните с /start', show_alert: true });
    }
    return;
  }

  ctx.user = user;
  return next();
}
