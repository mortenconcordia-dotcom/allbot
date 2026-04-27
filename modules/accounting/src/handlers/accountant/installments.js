import { States } from '../../states.js';
import { goTo } from '../../core/navigation.js';
import { paginatedListInline, backKeyboard, backInline } from '../../keyboards/common.js';
import { accountantMenuKeyboard, installmentMenuInline, deductInstallmentInline } from '../../keyboards/accountant.js';

// ── Вспомогательные ────────────────────────────────────────────────────────

function statusLabel(status) {
  return status === 'active' ? '✅ Активна' : status === 'pending' ? '⏳ Ожидает' : '🔒 Закрыта';
}

function fmt(n) {
  return Number(n).toLocaleString('ru', { minimumFractionDigits: 2 });
}

// ── Регистрация ──────────────────────────────────────────────────────────────

export function registerAccInstallmentHandlers(bot) {

  // ── Точка входа из меню бухгалтера ────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_MENU) return next();
    if (ctx.message.text !== '💳 Рассрочки сотрудникам') return next();

    goTo(ctx.session.botState, States.ACC_INST_MENU);
    await ctx.reply(
      '💳 <b>Рассрочки сотрудникам</b>\n\nВыберите действие:',
      { parse_mode: 'HTML', reply_markup: installmentMenuInline() }
    );
  });

  // ── Активные рассрочки: список сотрудников ─────────────────────────────────
  bot.callbackQuery('inst_active', async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_INST_MENU) return;

    const rows = ctx.db.prepare(`
      SELECT u.id, u.full_name, i.id AS inst_id, i.remaining_amount
      FROM installments i
      JOIN users u ON u.id = i.user_id
      WHERE i.status = 'active'
      ORDER BY u.full_name
    `).all();

    await ctx.answerCallbackQuery();

    if (!rows.length) {
      await ctx.editMessageText(
        '📋 Активных рассрочек нет.',
        { reply_markup: backInline() }
      );
      return;
    }

    const items = rows.map(r => [
      `${r.full_name} — остаток: ${fmt(r.remaining_amount)} ₽`,
      `inst_emp_${r.inst_id}`,
    ]);

    goTo(ctx.session.botState, States.ACC_INST_ACTIVE_LIST);
    await ctx.editMessageText(
      `📋 <b>Активные рассрочки</b>\n\nВсего: <b>${rows.length}</b>. Выберите:`,
      { parse_mode: 'HTML', reply_markup: paginatedListInline(items) }
    );
  });

  // ── Детали конкретной рассрочки + кнопка «Списать» ────────────────────────
  bot.callbackQuery(/^inst_emp_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_INST_ACTIVE_LIST) return;

    const instId = Number(ctx.match[1]);
    const inst   = ctx.db.prepare(`
      SELECT i.*, u.full_name FROM installments i JOIN users u ON u.id = i.user_id WHERE i.id = ?
    `).get(instId);

    if (!inst) return ctx.answerCallbackQuery({ text: 'Рассрочка не найдена.', show_alert: true });

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ACC_INST_ACTIVE_DETAIL, { instId });

    await ctx.editMessageText(
      `👤 <b>Сотрудник:</b> ${inst.full_name}\n` +
      `💰 <b>Изначальная сумма:</b> ${fmt(inst.total_amount)} ₽\n` +
      `📉 <b>Остаток долга:</b> ${fmt(inst.remaining_amount)} ₽\n` +
      `📌 <b>Статус:</b> ${statusLabel(inst.status)}`,
      { parse_mode: 'HTML', reply_markup: deductInstallmentInline(instId) }
    );
  });

  // ── Нажата «Списать сумму» → ожидаем ввод числа ───────────────────────────
  bot.callbackQuery(/^inst_deduct_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_INST_ACTIVE_DETAIL) return;

    const instId = Number(ctx.match[1]);
    const inst   = ctx.db.prepare('SELECT * FROM installments WHERE id = ?').get(instId);
    if (!inst) return ctx.answerCallbackQuery({ text: 'Рассрочка не найдена.', show_alert: true });

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ACC_INST_DEDUCT_WAITING, { instId });

    await ctx.reply(
      `💸 <b>Списание по рассрочке</b>\n\nТекущий остаток: <b>${fmt(inst.remaining_amount)} ₽</b>\n\nВведите сумму для списания (₽):`,
      { parse_mode: 'HTML', reply_markup: backKeyboard() }
    );
  });

  // ── Ввод суммы списания ────────────────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_INST_DEDUCT_WAITING) return next();
    if (ctx.message.text === '◀️ Назад' || ctx.message.text === '◀️ Главное меню') return next();

    const raw    = ctx.message.text.trim().replace(',', '.').replace(/\s/g, '');
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('⚠️ Введите корректную сумму (например: 5000 или 2500.50):');
    }

    const instId = ctx.session.botState.instId;
    const inst   = ctx.db.prepare('SELECT * FROM installments WHERE id = ?').get(instId);
    if (!inst) return ctx.reply('⚠️ Рассрочка не найдена. Вернитесь назад.');

    const newRemaining = Math.max(0, inst.remaining_amount - amount);
    const newStatus    = newRemaining <= 0 ? 'closed' : 'active';

    ctx.db.prepare(`
      UPDATE installments
      SET remaining_amount = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newRemaining, newStatus, instId);

    // Уведомление сотруднику
    const employee = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(inst.user_id);
    if (employee) {
      try {
        const closedLine = newStatus === 'closed'
          ? '\n\n🎉 <b>Рассрочка полностью погашена!</b>'
          : '';
        await ctx.api.sendMessage(
          employee.telegram_id,
          `💳 <b>Списание по рассрочке</b>\n\n` +
          `По вашей рассрочке списана сумма: <b>${fmt(amount)} ₽</b>\n` +
          `Остаток долга: <b>${fmt(newRemaining)} ₽</b>${closedLine}`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        console.warn('[AccInst] Не удалось уведомить сотрудника:', e.message);
      }
    }

    // Возвращаем бухгалтера в меню
    goTo(ctx.session.botState, States.ACC_MENU);
    const closedMsg = newStatus === 'closed'
      ? '\n✅ <b>Рассрочка закрыта</b> (долг погашен полностью).' : '';

    await ctx.reply(
      `✅ Списано: <b>${fmt(amount)} ₽</b>\n` +
      `📉 Новый остаток: <b>${fmt(newRemaining)} ₽</b>${closedMsg}`,
      { parse_mode: 'HTML', reply_markup: accountantMenuKeyboard() }
    );
  });

  // ── Дать рассрочку: список сотрудников ────────────────────────────────────
  bot.callbackQuery('inst_new', async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_INST_MENU) return;

    const employees = ctx.db.prepare(
      'SELECT * FROM users WHERE is_employee = 1 ORDER BY full_name'
    ).all();

    await ctx.answerCallbackQuery();

    if (!employees.length) {
      await ctx.editMessageText('⚠️ В системе нет сотрудников.', { reply_markup: backInline() });
      return;
    }

    const items = employees.map(e => [e.full_name, `inst_new_emp_${e.id}`]);
    goTo(ctx.session.botState, States.ACC_INST_NEW_CHOOSING_EMP);
    await ctx.editMessageText(
      '➕ <b>Дать рассрочку</b>\n\nВыберите сотрудника:',
      { parse_mode: 'HTML', reply_markup: paginatedListInline(items) }
    );
  });

  // ── Выбор сотрудника → ввод суммы ─────────────────────────────────────────
  bot.callbackQuery(/^inst_new_emp_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_INST_NEW_CHOOSING_EMP) return;

    const empId   = Number(ctx.match[1]);
    const employee = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(empId);
    if (!employee) return ctx.answerCallbackQuery({ text: 'Сотрудник не найден.', show_alert: true });

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ACC_INST_NEW_AMOUNT, {
      instNewEmpId:   empId,
      instNewEmpName: employee.full_name,
      instNewEmpTgId: employee.telegram_id,
    });

    await ctx.reply(
      `👤 Сотрудник: <b>${employee.full_name}</b>\n\n💰 Введите сумму рассрочки (₽):`,
      { parse_mode: 'HTML', reply_markup: backKeyboard() }
    );
  });

  // ── Ввод суммы рассрочки → создание записи + уведомление ──────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_INST_NEW_AMOUNT) return next();
    if (ctx.message.text === '◀️ Назад' || ctx.message.text === '◀️ Главное меню') return next();

    const raw    = ctx.message.text.trim().replace(',', '.').replace(/\s/g, '');
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('⚠️ Введите корректную сумму (например: 15000 или 7500.00):');
    }

    const empId   = ctx.session.botState.instNewEmpId;
    const empName = ctx.session.botState.instNewEmpName;
    const empTgId = ctx.session.botState.instNewEmpTgId;

    // Создаём запись со статусом pending
    const info = ctx.db.prepare(`
      INSERT INTO installments (user_id, total_amount, remaining_amount, status, created_by)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(empId, amount, amount, ctx.user.id);

    const instId = info.lastInsertRowid;

    // Уведомление сотруднику с кнопками Подтвердить / Отказать
    try {
      const { InlineKeyboard } = await import('grammy');
      const confirmKb = new InlineKeyboard()
        .text('✅ Подтвердить', `inst_confirm_${instId}`).row()
        .text('❌ Отказать',    `inst_reject_${instId}`);

      await ctx.api.sendMessage(
        empTgId,
        `💳 <b>Вам выдана рассрочка</b>\n\n` +
        `Сумма рассрочки: <b>${fmt(amount)} ₽</b>\n\n` +
        `Пожалуйста, подтвердите или отклоните её:`,
        { parse_mode: 'HTML', reply_markup: confirmKb }
      );
    } catch (e) {
      console.warn('[AccInst] Не удалось уведомить сотрудника:', e.message);
    }

    goTo(ctx.session.botState, States.ACC_MENU);
    await ctx.reply(
      `✅ Рассрочка на <b>${fmt(amount)} ₽</b> создана для <b>${empName}</b>.\n` +
      `⏳ Ожидается подтверждение от сотрудника.`,
      { parse_mode: 'HTML', reply_markup: accountantMenuKeyboard() }
    );
  });
}
