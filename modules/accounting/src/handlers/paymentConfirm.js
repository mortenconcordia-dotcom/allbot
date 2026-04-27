import { States } from '../states.js';
import { goRoot } from '../core/navigation.js';
import { accountantMenuKeyboard } from '../keyboards/accountant.js';

export function registerPaymentConfirmHandlers(bot) {
  // ── Сотрудник нажал «Подтвердить» ─────────────────────────
  bot.callbackQuery(/^pay_confirm_(\d+)$/, async (ctx) => {
    const paymentId = Number(ctx.match[1]);
    const payment = ctx.db.prepare(`
      SELECT p.*, e.telegram_id AS emp_tg, e.full_name AS emp_name,
             a.telegram_id AS acc_tg, a.full_name AS acc_name,
             s.name AS site_name
      FROM payments p
      JOIN users e ON e.id = p.employee_id
      JOIN users a ON a.id = p.accountant_id
      JOIN sites s ON s.id = p.site_id
      WHERE p.id = ?
    `).get(paymentId);

    if (!payment) return ctx.answerCallbackQuery({ text: '⚠️ Выплата не найдена.', show_alert: true });

    // Только адресат может подтверждать
    if (ctx.from.id !== payment.emp_tg) {
      return ctx.answerCallbackQuery({ text: '⛔ Это не ваша выплата.', show_alert: true });
    }

    // Защита от повторного нажатия
    if (payment.status !== 'pending') {
      await ctx.answerCallbackQuery({ text: 'ℹ️ Выплата уже обработана.', show_alert: true });
      await ctx.editMessageReplyMarkup();
      return;
    }

    const now = new Date().toISOString();
    ctx.db.prepare("UPDATE payments SET status='confirmed', confirmed_at=? WHERE id=?").run(now, paymentId);

    await ctx.editMessageReplyMarkup();
    await ctx.answerCallbackQuery({ text: '✅ Вы подтвердили получение выплаты!', show_alert: true });

    const ruDate = new Date(now).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

    // Уведомление сотруднику
    await ctx.reply(
      `✅ <b>Получение подтверждено</b>\n\n💰 Сумма: <b>${payment.amount.toLocaleString('ru')} ₽</b>\n🏗 Объект: ${payment.site_name}`,
      { parse_mode: 'HTML' }
    );

    // Уведомление бухгалтеру
    try {
      await ctx.api.sendMessage(
        payment.acc_tg,
        `✅ <b>${payment.emp_name}</b> подтвердил получение <b>${payment.amount.toLocaleString('ru')} ₽</b>\n🏗 Объект: ${payment.site_name}\n🕐 ${ruDate}`,
        { parse_mode: 'HTML', reply_markup: accountantMenuKeyboard() }
      );
    } catch (e) {
      console.error('[PayConfirm] Не удалось уведомить бухгалтера:', e.message);
    }

    // Сбрасываем FSM бухгалтера в меню
    try {
      const sessionKey = String(payment.acc_tg);
      const storage = ctx.parallaxStorage;
      if (storage) {
        const session = await storage.read(sessionKey) ?? {};
        if (!session.botState) session.botState = {};
        session.botState.state = States.ACC_MENU;
        session.botState._nav_stack = [];
        await storage.write(sessionKey, session);
      }
    } catch (e) {
      console.error('[PayConfirm] Не удалось сбросить FSM бухгалтера:', e.message);
    }
  });

  // ── Сотрудник нажал «Не подтверждать» ────────────────────
  bot.callbackQuery(/^pay_reject_(\d+)$/, async (ctx) => {
    const paymentId = Number(ctx.match[1]);
    const payment = ctx.db.prepare(`
      SELECT p.*, e.telegram_id AS emp_tg, e.full_name AS emp_name,
             a.telegram_id AS acc_tg,
             s.name AS site_name
      FROM payments p
      JOIN users e ON e.id = p.employee_id
      JOIN users a ON a.id = p.accountant_id
      JOIN sites s ON s.id = p.site_id
      WHERE p.id = ?
    `).get(paymentId);

    if (!payment) return ctx.answerCallbackQuery({ text: '⚠️ Выплата не найдена.', show_alert: true });
    if (ctx.from.id !== payment.emp_tg) {
      return ctx.answerCallbackQuery({ text: '⛔ Это не ваша выплата.', show_alert: true });
    }
    if (payment.status !== 'pending') {
      await ctx.answerCallbackQuery({ text: 'ℹ️ Выплата уже обработана.', show_alert: true });
      await ctx.editMessageReplyMarkup();
      return;
    }

    ctx.db.prepare("UPDATE payments SET status='rejected' WHERE id=?").run(paymentId);

    await ctx.editMessageReplyMarkup();
    await ctx.answerCallbackQuery({ text: 'Вы отклонили выплату.', show_alert: true });

    await ctx.reply(
      `❌ <b>Выплата отклонена</b>\n\n💰 Сумма: <b>${payment.amount.toLocaleString('ru')} ₽</b>\n🏗 Объект: ${payment.site_name}`,
      { parse_mode: 'HTML' }
    );

    try {
      await ctx.api.sendMessage(
        payment.acc_tg,
        `❌ <b>${payment.emp_name}</b> отклонил выплату <b>${payment.amount.toLocaleString('ru')} ₽</b>\n🏗 Объект: ${payment.site_name}\n\nВыплата не записана в систему.`,
        { parse_mode: 'HTML', reply_markup: accountantMenuKeyboard() }
      );
    } catch (e) {
      console.error('[PayReject] Не удалось уведомить бухгалтера:', e.message);
    }

    // Сбрасываем FSM бухгалтера
    try {
      const sessionKey = String(payment.acc_tg);
      const storage = ctx.parallaxStorage;
      if (storage) {
        const session = await storage.read(sessionKey) ?? {};
        if (!session.botState) session.botState = {};
        session.botState.state = States.ACC_MENU;
        session.botState._nav_stack = [];
        await storage.write(sessionKey, session);
      }
    } catch (e) {
      console.error('[PayReject] Не удалось сбросить FSM бухгалтера:', e.message);
    }
  });
}
