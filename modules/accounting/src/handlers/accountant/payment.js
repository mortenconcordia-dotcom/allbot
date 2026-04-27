import { States } from '../../states.js';
import { goTo } from '../../core/navigation.js';
import { backKeyboard, paginatedListInline } from '../../keyboards/common.js';
import { accountantMenuKeyboard, cancelAwaitingKeyboard, paymentConfirmInline } from '../../keyboards/accountant.js';

export function registerAccPaymentHandlers(bot) {
  // ── Точка входа ───────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_MENU) return next();
    if (ctx.message.text !== '💰 Заполнить выплату') return next();

    const employees = ctx.db.prepare('SELECT * FROM users WHERE is_employee = 1 ORDER BY full_name').all();
    if (!employees.length) return ctx.reply('⚠️ В системе нет сотрудников.');

    const items = employees.map(e => [e.full_name, `pay_emp_${e.id}`]);
    goTo(ctx.session.botState, States.ACC_PAY_CHOOSING_EMP);
    await ctx.reply('👤 Выберите сотрудника:', { reply_markup: paginatedListInline(items) });
  });

  // ── Выбор сотрудника ──────────────────────────────────────
  bot.callbackQuery(/^pay_emp_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_PAY_CHOOSING_EMP) return;
    const employeeId = Number(ctx.match[1]);
    const employee   = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(employeeId);
    if (!employee) return ctx.answerCallbackQuery({ text: 'Сотрудник не найден.', show_alert: true });

    ctx.session.botState.payEmployeeId   = employeeId;
    ctx.session.botState.payEmployeeName = employee.full_name;

    const sites = ctx.db.prepare(`
      SELECT DISTINCT s.* FROM sites s
      JOIN payments p ON p.site_id = s.id
      WHERE p.employee_id = ?
      ORDER BY s.name
    `).all(employeeId);

    const items = sites.map(s => [s.name, `pay_site_${s.id}`]);
    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ACC_PAY_CHOOSING_SITE);
    await ctx.editMessageText(
      `👤 Сотрудник: <b>${employee.full_name}</b>\n\n🏗 Выберите объект или создайте новый:`,
      { parse_mode: 'HTML', reply_markup: paginatedListInline(items, ['➕ Добавить объект', 'pay_site_new']) }
    );
  });

  // ── Добавить новый объект ─────────────────────────────────
  bot.callbackQuery('pay_site_new', async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_PAY_CHOOSING_SITE) return;
    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ACC_PAY_ADDING_SITE);
    await ctx.reply('📝 Введите название нового объекта:', { reply_markup: backKeyboard() });
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_PAY_ADDING_SITE) return next();
    if (ctx.message.text === '◀️ Назад' || ctx.message.text === '◀️ Главное меню') return next();

    const name = ctx.message.text.trim();
    if (name.length < 2) return ctx.reply('⚠️ Слишком короткое название. Попробуйте ещё раз:');

    const info = ctx.db.prepare('INSERT INTO sites (name, created_by) VALUES (?, ?)').run(name, ctx.user.id);
    const site = ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(info.lastInsertRowid);

    ctx.session.botState.paySiteId   = site.id;
    ctx.session.botState.paySiteName = site.name;
    goTo(ctx.session.botState, States.ACC_PAY_ENTERING_AMOUNT);

    await ctx.reply(
      `✅ Объект <b>«${site.name}»</b> создан.\n\n👤 Сотрудник: <b>${ctx.session.botState.payEmployeeName}</b>\n💵 Введите сумму выплаты (₽):`,
      { parse_mode: 'HTML', reply_markup: backKeyboard() }
    );
  });

  // ── Выбор существующего объекта ───────────────────────────
  bot.callbackQuery(/^pay_site_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_PAY_CHOOSING_SITE) return;
    const siteId = Number(ctx.match[1]);
    const site   = ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    if (!site) return ctx.answerCallbackQuery({ text: 'Объект не найден.', show_alert: true });

    ctx.session.botState.paySiteId   = siteId;
    ctx.session.botState.paySiteName = site.name;
    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ACC_PAY_ENTERING_AMOUNT);

    await ctx.reply(
      `🏗 Объект: <b>«${site.name}»</b>\n👤 Сотрудник: <b>${ctx.session.botState.payEmployeeName}</b>\n\n💵 Введите сумму выплаты (₽):`,
      { parse_mode: 'HTML', reply_markup: backKeyboard() }
    );
  });

  // ── Ввод суммы ────────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_PAY_ENTERING_AMOUNT) return next();
    if (ctx.message.text === '◀️ Назад' || ctx.message.text === '◀️ Главное меню') return next();

    const raw = ctx.message.text.trim().replace(',', '.').replace(/\s/g, '');
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('⚠️ Введите корректную сумму (например: 5000 или 3500.50):');
    }

    const employeeId = ctx.session.botState.payEmployeeId;
    const siteId     = ctx.session.botState.paySiteId;
    const employee   = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(employeeId);
    const site       = ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);

    const info = ctx.db.prepare(`
      INSERT INTO payments (employee_id, site_id, accountant_id, amount, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(employeeId, siteId, ctx.user.id, amount);

    const paymentId = info.lastInsertRowid;

    try {
      const sent = await ctx.api.sendMessage(
        employee.telegram_id,
        `💰 <b>Запрос на подтверждение выплаты</b>\n\n🏗 Объект: <b>${site.name}</b>\n💵 Сумма: <b>${amount.toLocaleString('ru', { minimumFractionDigits: 2 })} ₽</b>\n👔 Бухгалтер: ${ctx.user.full_name}\n\nПодтвердите получение денег:`,
        { parse_mode: 'HTML', reply_markup: paymentConfirmInline(paymentId) }
      );

      ctx.db.prepare('UPDATE payments SET confirmation_message_id = ? WHERE id = ?').run(sent.message_id, paymentId);

      ctx.session.botState.pendingPaymentId             = paymentId;
      ctx.session.botState.pendingEmployeeTgId          = employee.telegram_id;
      ctx.session.botState.pendingConfirmationMessageId = sent.message_id;
      goTo(ctx.session.botState, States.ACC_PAY_AWAITING_CONFIRM);

      await ctx.reply(
        `⏳ <b>Ожидаем подтверждения от ${employee.full_name}</b>\n\nСумма: <b>${amount.toLocaleString('ru', { minimumFractionDigits: 2 })} ₽</b> · ${site.name}\n\nСотруднику отправлен запрос. Вы получите уведомление как только он ответит.`,
        { parse_mode: 'HTML', reply_markup: cancelAwaitingKeyboard() }
      );
    } catch (e) {
      console.error('[AccPayment] Не удалось отправить запрос сотруднику:', e.message);
      ctx.db.prepare("UPDATE payments SET status='rejected' WHERE id=?").run(paymentId);
      await ctx.reply('⚠️ Не удалось отправить запрос сотруднику. Убедитесь что он запустил бота.');
    }
  });
}
