import { States } from '../../states.js';
import { goTo } from '../../core/navigation.js';
import { paginatedListInline, backInline } from '../../keyboards/common.js';

export function registerAccAdvanceHandlers(bot) {
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_MENU) return next();
    if (ctx.message.text !== '📩 Заявки на аванс') return next();

    const employees = ctx.db.prepare(`
      SELECT DISTINCT u.* FROM users u
      JOIN advance_requests ar ON ar.employee_id = u.id
      WHERE ar.status = 'pending'
      ORDER BY u.full_name
    `).all();

    if (!employees.length) return ctx.reply('📩 Новых заявок на аванс нет.');

    const items = employees.map(e => [e.full_name, `adv_acc_emp_${e.id}`]);
    goTo(ctx.session.botState, States.ACC_ADVANCE_CHOOSING_EMP);
    await ctx.reply(
      `📩 <b>Заявки на аванс</b>\n\nСотрудников с заявками: <b>${employees.length}</b>\n\nВыберите:`,
      { parse_mode: 'HTML', reply_markup: paginatedListInline(items) }
    );
  });

  bot.callbackQuery(/^adv_acc_emp_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ACC_ADVANCE_CHOOSING_EMP) return;
    const employeeId = Number(ctx.match[1]);
    const employee   = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(employeeId);

    const advances = ctx.db.prepare(`
      SELECT ar.*, s.name AS site_name FROM advance_requests ar
      JOIN sites s ON s.id = ar.site_id
      WHERE ar.employee_id = ? AND ar.status = 'pending'
      ORDER BY ar.created_at DESC
    `).all(employeeId);

    // Отмечаем как просмотренные
    ctx.db.prepare("UPDATE advance_requests SET status='reviewed' WHERE employee_id=? AND status='pending'").run(employeeId);

    const lines = [`📩 <b>Заявки от ${employee.full_name}:</b>\n`];
    for (const a of advances) {
      const dt = new Date(a.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      lines.push(`🔸 Объект: <b>${a.site_name}</b>\n   💰 Запрошено: <b>${a.amount.toLocaleString('ru')} ₽</b>\n   📅 ${dt}\n`);
    }

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ACC_ADVANCE_DETAIL);
    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: backInline() });
  });
}
