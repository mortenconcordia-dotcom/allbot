import { States } from '../../states.js';
import { goTo } from '../../core/navigation.js';
import { backInline } from '../../keyboards/common.js';
import { employeeMenuKeyboard } from '../../keyboards/employee.js';

// ── Вспомогательная ────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n).toLocaleString('ru', { minimumFractionDigits: 2 });
}

function hasActiveInst(db, userId) {
  return db.prepare(
    "SELECT 1 FROM installments WHERE user_id = ? AND status = 'active' LIMIT 1"
  ).get(userId) !== undefined;
}

// ── Регистрация ──────────────────────────────────────────────────────────────

export function registerEmpInstallmentHandlers(bot) {

  // ── Подтверждение рассрочки сотрудником ──────────────────────────────────
  // Регистрируется ПЕРВЫМ (до проверки ролей), т.к. коллбэк приходит
  // в любом состоянии FSM (из уведомления).
  bot.callbackQuery(/^inst_confirm_(\d+)$/, async (ctx) => {
    const instId = Number(ctx.match[1]);
    const inst   = ctx.db.prepare('SELECT * FROM installments WHERE id = ?').get(instId);

    if (!inst) return ctx.answerCallbackQuery({ text: '⚠️ Рассрочка не найдена.', show_alert: true });
    if (inst.status !== 'pending') {
      return ctx.answerCallbackQuery({ text: 'Рассрочка уже обработана.', show_alert: true });
    }

    // Проверяем, что кнопку нажал именно тот сотрудник
    const employee = ctx.db.prepare('SELECT * FROM users WHERE id = ? AND telegram_id = ?')
      .get(inst.user_id, ctx.from.id);
    if (!employee) {
      return ctx.answerCallbackQuery({ text: '⛔ Это не ваша рассрочка.', show_alert: true });
    }

    ctx.db.prepare(`
      UPDATE installments SET status = 'active', updated_at = datetime('now') WHERE id = ?
    `).run(instId);

    await ctx.answerCallbackQuery({ text: '✅ Рассрочка подтверждена!', show_alert: true });
    await ctx.editMessageText(
      `✅ <b>Рассрочка подтверждена</b>\n\n` +
      `Сумма: <b>${fmt(inst.total_amount)} ₽</b>\n` +
      `Остаток: <b>${fmt(inst.remaining_amount)} ₽</b>`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    // Уведомляем бухгалтера
    const accountant = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(inst.created_by);
    if (accountant) {
      try {
        await ctx.api.sendMessage(
          accountant.telegram_id,
          `✅ <b>${employee.full_name}</b> подтвердил рассрочку на сумму <b>${fmt(inst.total_amount)} ₽</b>.\nСтатус: Активна.`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        console.warn('[EmpInst] Не удалось уведомить бухгалтера:', e.message);
      }
    }
  });

  // ── Отказ от рассрочки ────────────────────────────────────────────────────
  bot.callbackQuery(/^inst_reject_(\d+)$/, async (ctx) => {
    const instId = Number(ctx.match[1]);
    const inst   = ctx.db.prepare('SELECT * FROM installments WHERE id = ?').get(instId);

    if (!inst) return ctx.answerCallbackQuery({ text: '⚠️ Рассрочка не найдена.', show_alert: true });
    if (inst.status !== 'pending') {
      return ctx.answerCallbackQuery({ text: 'Рассрочка уже обработана.', show_alert: true });
    }

    const employee = ctx.db.prepare('SELECT * FROM users WHERE id = ? AND telegram_id = ?')
      .get(inst.user_id, ctx.from.id);
    if (!employee) {
      return ctx.answerCallbackQuery({ text: '⛔ Это не ваша рассрочка.', show_alert: true });
    }

    ctx.db.prepare(`
      UPDATE installments SET status = 'closed', updated_at = datetime('now') WHERE id = ?
    `).run(instId);

    await ctx.answerCallbackQuery({ text: '❌ Рассрочка отклонена.', show_alert: true });
    await ctx.editMessageText(
      `❌ <b>Рассрочка отклонена</b>\n\nСумма: <b>${fmt(inst.total_amount)} ₽</b>`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    // Уведомляем бухгалтера
    const accountant = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(inst.created_by);
    if (accountant) {
      try {
        await ctx.api.sendMessage(
          accountant.telegram_id,
          `❌ <b>${employee.full_name}</b> отказался от рассрочки на сумму <b>${fmt(inst.total_amount)} ₽</b>.\nСтатус: Закрыта.`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        console.warn('[EmpInst] Не удалось уведомить бухгалтера:', e.message);
      }
    }
  });

  // ── Просмотр активной рассрочки сотрудником ──────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.EMP_MENU) return next();
    if (ctx.message.text !== '💳 Рассрочки') return next();

    const userId = ctx.user?.id;
    const inst   = ctx.db.prepare(`
      SELECT * FROM installments WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1
    `).get(userId);

    if (!inst) {
      // Кнопка пропала из БД — меню обновится при следующем /start
      return ctx.reply('ℹ️ У вас нет активных рассрочек.');
    }

    goTo(ctx.session.botState, States.EMP_INST_VIEW, { empInstId: inst.id });

    const pct = Math.max(0, Math.min(100, Math.round((1 - inst.remaining_amount / inst.total_amount) * 100)));
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));

    await ctx.reply(
      `💳 <b>Ваша рассрочка</b>\n\n` +
      `💰 Изначальная сумма: <b>${fmt(inst.total_amount)} ₽</b>\n` +
      `📉 Остаток долга: <b>${fmt(inst.remaining_amount)} ₽</b>\n\n` +
      `Погашено: <b>${pct}%</b>\n${bar}`,
      { parse_mode: 'HTML', reply_markup: backInline() }
    );
  });
}
