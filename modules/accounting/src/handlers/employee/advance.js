import { States } from '../../states.js';
import { goTo, goRoot } from '../../core/navigation.js';
import { paginatedListInline, backKeyboard } from '../../keyboards/common.js';
import { employeeMenuKeyboard, advanceConfirmInline } from '../../keyboards/employee.js';

export function registerEmpAdvanceHandlers(bot) {
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.EMP_MENU) return next();
    if (ctx.message.text !== '📩 Заявка на аванс') return next();

    const sites = ctx.db.prepare(`
      SELECT DISTINCT s.* FROM sites s
      JOIN payments p ON p.site_id = s.id
      WHERE p.employee_id = ? AND p.status = 'confirmed'
      ORDER BY s.name
    `).all(ctx.user.id);

    if (!sites.length) {
      return ctx.reply(
        '⚠️ У вас нет объектов для подачи заявки.\nЗаявка возможна только по объектам с подтверждёнными выплатами.'
      );
    }

    const items = sites.map(s => [s.name, `adv_site_${s.id}`]);
    goTo(ctx.session.botState, States.EMP_ADVANCE_CHOOSING_SITE);
    await ctx.reply('📩 <b>Заявка на аванс</b>\n\nВыберите объект:', {
      parse_mode: 'HTML', reply_markup: paginatedListInline(items),
    });
  });

  bot.callbackQuery(/^adv_site_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.EMP_ADVANCE_CHOOSING_SITE) return;
    const siteId = Number(ctx.match[1]);
    const site   = ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    if (!site) return ctx.answerCallbackQuery({ text: '⚠️ Объект не найден.', show_alert: true });

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.EMP_ADVANCE_ENTERING_AMT, { advSiteId: site.id, advSiteName: site.name });
    await ctx.reply(`🏗 Объект: <b>${site.name}</b>\n\n💰 Введите сумму аванса (₽):`, {
      parse_mode: 'HTML', reply_markup: backKeyboard(),
    });
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.EMP_ADVANCE_ENTERING_AMT) return next();
    if (ctx.message.text === '◀️ Назад' || ctx.message.text === '◀️ Главное меню') return next();

    const raw    = ctx.message.text.trim().replace(',', '.').replace(/\s/g, '');
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount <= 0) return ctx.reply('⚠️ Введите корректную сумму:');

    const siteName = ctx.session.botState.advSiteName;
    goTo(ctx.session.botState, States.EMP_ADVANCE_CONFIRM, { advAmount: amount });
    await ctx.reply(
      `📩 <b>Подтвердите заявку на аванс:</b>\n\n🏗 Объект: <b>${siteName}</b>\n💰 Сумма: <b>${amount.toLocaleString('ru')} ₽</b>\n\nОтправить заявку бухгалтеру?`,
      { parse_mode: 'HTML', reply_markup: advanceConfirmInline(0) }
    );
  });

  bot.callbackQuery(/^adv_send_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.EMP_ADVANCE_CONFIRM) return;

    const siteId   = ctx.session.botState.advSiteId;
    const siteName = ctx.session.botState.advSiteName;
    const amount   = ctx.session.botState.advAmount;

    ctx.db.prepare('INSERT INTO advance_requests (employee_id, site_id, amount) VALUES (?, ?, ?)').run(ctx.user.id, siteId, amount);

    await ctx.answerCallbackQuery({ text: '✅ Заявка отправлена!', show_alert: true });
    await ctx.editMessageReplyMarkup();

    // Уведомляем всех бухгалтеров с включёнными уведомлениями
    const accountants = ctx.db.prepare('SELECT * FROM users WHERE is_accountant = 1 AND notifications_enabled = 1').all();
    for (const acc of accountants) {
      try {
        await ctx.api.sendMessage(
          acc.telegram_id,
          `📩 <b>Новая заявка на аванс!</b>\n\n👷 Сотрудник: <b>${ctx.user.full_name}</b>\n🏗 Объект: <b>${siteName}</b>\n💰 Сумма: <b>${amount.toLocaleString('ru')} ₽</b>`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        console.warn('[EmpAdvance] Не удалось уведомить бухгалтера:', acc.telegram_id, e.message);
      }
    }

    goRoot(ctx.session.botState, States.EMP_MENU);
    await ctx.reply(
      `✅ Заявка на аванс отправлена!\n\n🏗 ${siteName} · 💰 ${amount.toLocaleString('ru')} ₽`,
      { reply_markup: employeeMenuKeyboard() }
    );
  });
}
