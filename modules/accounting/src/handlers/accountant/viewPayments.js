import { States } from '../../states.js';
import { goTo } from '../../core/navigation.js';
import { paginatedListInline, backInline } from '../../keyboards/common.js';

export function registerAccViewHandlers(bot) {
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_MENU) return next();
    if (ctx.message.text !== '📋 Посмотреть выплаты') return next();

    const employees = ctx.db.prepare('SELECT * FROM users WHERE is_employee = 1 ORDER BY full_name').all();
    if (!employees.length) return ctx.reply('⚠️ Сотрудников нет в системе.');

    const items = employees.map(e => [e.full_name, `vw_emp_${e.id}`]);
    goTo(ctx.session.botState, States.ACC_VIEW_CHOOSING_EMP);
    await ctx.reply('👷 Выберите сотрудника:', { reply_markup: paginatedListInline(items) });
  });

  bot.callbackQuery(/^vw_emp_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_VIEW_CHOOSING_EMP) return;
    const employeeId = Number(ctx.match[1]);
    const employee   = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(employeeId);
    if (!employee) return ctx.answerCallbackQuery({ text: '⚠️ Сотрудник не найден.', show_alert: true });

    const sites = ctx.db.prepare(`
      SELECT DISTINCT s.* FROM sites s
      JOIN payments p ON p.site_id = s.id
      WHERE p.employee_id = ? AND p.status = 'confirmed'
      ORDER BY s.name
    `).all(employeeId);

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ACC_VIEW_CHOOSING_SITE, { viewEmployeeId: employeeId, viewEmployeeName: employee.full_name });

    if (!sites.length) {
      await ctx.editMessageText(`👷 <b>${employee.full_name}</b>\n\n⚠️ Нет подтверждённых выплат.`, {
        parse_mode: 'HTML', reply_markup: paginatedListInline([]),
      });
      return;
    }

    const items = sites.map(s => [s.name, `vw_site_${s.id}`]);
    await ctx.editMessageText(`👷 <b>${employee.full_name}</b>\n\n🏗 Выберите объект:`, {
      parse_mode: 'HTML', reply_markup: paginatedListInline(items),
    });
  });

  bot.callbackQuery(/^vw_site_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_VIEW_CHOOSING_SITE) return;
    const siteId       = Number(ctx.match[1]);
    const employeeId   = ctx.session.botState.viewEmployeeId;
    const employeeName = ctx.session.botState.viewEmployeeName;

    const site = ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    const payments = ctx.db.prepare(`
      SELECT p.*, u.full_name AS acc_name FROM payments p
      LEFT JOIN users u ON u.id = p.accountant_id
      WHERE p.employee_id = ? AND p.site_id = ? AND p.status = 'confirmed'
      ORDER BY p.confirmed_at DESC
    `).all(employeeId, siteId);

    const total = payments.reduce((s, p) => s + p.amount, 0);
    const lines = [`👷 <b>${employeeName}</b>`, `🏗 Объект: <b>${site.name}</b>`, '', '📋 <b>История выплат:</b>'];

    for (const p of payments) {
      const dt = p.confirmed_at
        ? new Date(p.confirmed_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
        : '—';
      lines.push(`• ${dt} — <b>${p.amount.toLocaleString('ru')} ₽</b> (бухг.: ${p.acc_name ?? '—'})`);
    }
    lines.push('', `💰 <b>Итого: ${total.toLocaleString('ru')} ₽</b>`);

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ACC_VIEW_DETAIL);
    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: backInline() });
  });
}
