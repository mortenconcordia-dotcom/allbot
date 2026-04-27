import { States } from '../../states.js';
import { goTo } from '../../core/navigation.js';
import { paginatedListInline, backInline } from '../../keyboards/common.js';

export function registerEmpViewHandlers(bot) {
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.EMP_MENU) return next();
    if (ctx.message.text !== '📋 Мои выплаты') return next();

    const siteIds = ctx.db.prepare(`
      SELECT DISTINCT site_id FROM payments
      WHERE employee_id = ? AND status = 'confirmed'
    `).all(ctx.user.id).map(r => r.site_id);

    if (!siteIds.length) return ctx.reply('📭 У вас пока нет подтверждённых выплат.');

    const placeholders = siteIds.map(() => '?').join(',');
    const sites = ctx.db.prepare(`SELECT * FROM sites WHERE id IN (${placeholders}) ORDER BY name`).all(...siteIds);

    const items = sites.map(s => [s.name, `emp_view_site_${s.id}`]);
    goTo(ctx.session.botState, States.EMP_VIEW_CHOOSING_SITE);
    await ctx.reply('🏗 Выберите объект:', { reply_markup: paginatedListInline(items) });
  });

  bot.callbackQuery(/^emp_view_site_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.EMP_VIEW_CHOOSING_SITE) return;
    const siteId = Number(ctx.match[1]);
    const site   = ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);

    const payments = ctx.db.prepare(`
      SELECT * FROM payments
      WHERE employee_id = ? AND site_id = ? AND status = 'confirmed'
      ORDER BY confirmed_at ASC
    `).all(ctx.user.id, siteId);

    const total = payments.reduce((s, p) => s + p.amount, 0);
    const lines = [];
    payments.forEach((p, i) => {
      const dt = p.confirmed_at
        ? new Date(p.confirmed_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
        : '—';
      lines.push(`${i + 1}. <b>${p.amount.toLocaleString('ru', { minimumFractionDigits: 2 })} ₽</b> · ${dt}`);
    });

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.EMP_VIEW_DETAIL);
    await ctx.editMessageText(
      `🏗 <b>${site.name}</b>\n\n${lines.join('\n')}\n\n${'─'.repeat(20)}\n💰 Итого: <b>${total.toLocaleString('ru', { minimumFractionDigits: 2 })} ₽</b>`,
      { parse_mode: 'HTML', reply_markup: backInline() }
    );
  });
}
