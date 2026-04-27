import { States } from '../states.js';
import { goTo, goBack } from '../core/navigation.js';
import { adminMenuKeyboard, notificationsToggleInline, installmentAdminInline } from '../keyboards/admin.js';
import { accountantMenuKeyboard } from '../keyboards/accountant.js';
import { employeeMenuKeyboard } from '../keyboards/employee.js';
import { paginatedListInline, backInline, backKeyboard } from '../keyboards/common.js';
import { adminRoleAssignInline } from '../keyboards/roleSelect.js';

function formatRuDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function registerAdminHandlers(bot) {
  // ── Выход из панели ───────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ADMIN_MENU) return next();
    if (ctx.message.text !== '🚪 Выйти из панели') return next();

    const preState = ctx.session.botState._preAdminState ?? '';
    const preData  = ctx.session.botState._preAdminData  ?? {};

    // Восстанавливаем снапшот
    Object.assign(ctx.session.botState, preData);

    if (preState.startsWith('accountant:')) {
      ctx.session.botState.state = States.ACC_MENU;
      await ctx.reply('📋 Панель бухгалтера:', { reply_markup: accountantMenuKeyboard() });
    } else if (preState.startsWith('employee:')) {
      ctx.session.botState.state = States.EMP_MENU;
      await ctx.reply('📋 Панель сотрудника:', { reply_markup: employeeMenuKeyboard() });
    } else {
      const user = ctx.user;
      if (user?.active_role === 'accountant') {
        ctx.session.botState.state = States.ACC_MENU;
        await ctx.reply('📋 Панель бухгалтера:', { reply_markup: accountantMenuKeyboard() });
      } else {
        ctx.session.botState.state = States.EMP_MENU;
        await ctx.reply('📋 Панель сотрудника:', { reply_markup: employeeMenuKeyboard() });
      }
    }
  });

  // ── Все выплаты ───────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ADMIN_MENU) return next();
    if (ctx.message.text !== '💰 Все выплаты') return next();

    const employees = ctx.db.prepare('SELECT * FROM users WHERE is_employee = 1 ORDER BY full_name').all();
    if (!employees.length) return ctx.reply('⚠️ Сотрудников нет.');

    const items = employees.map(e => [e.full_name, `adm_emp_${e.id}`]);
    goTo(ctx.session.botState, States.ADMIN_VIEW_CHOOSING_EMP);
    await ctx.reply('👷 Выберите сотрудника:', { reply_markup: paginatedListInline(items) });
  });

  bot.callbackQuery(/^adm_emp_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ADMIN_VIEW_CHOOSING_EMP) return;
    const employeeId = Number(ctx.match[1]);
    const employee   = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(employeeId);

    const sites = ctx.db.prepare(`
      SELECT DISTINCT s.* FROM sites s
      JOIN payments p ON p.site_id = s.id
      WHERE p.employee_id = ? AND p.status = 'confirmed'
      ORDER BY s.name
    `).all(employeeId);

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ADMIN_VIEW_CHOOSING_SITE, { admEmployeeId: employeeId, admEmployeeName: employee.full_name });

    if (!sites.length) {
      await ctx.editMessageText(`👷 <b>${employee.full_name}</b>\n\n⚠️ Нет подтверждённых выплат.`, {
        parse_mode: 'HTML', reply_markup: backInline(),
      });
      return;
    }

    const items = sites.map(s => [s.name, `adm_site_${s.id}`]);
    await ctx.editMessageText(`👷 <b>${employee.full_name}</b>\n\n🏗 Выберите объект:`, {
      parse_mode: 'HTML', reply_markup: paginatedListInline(items),
    });
  });

  bot.callbackQuery(/^adm_site_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ADMIN_VIEW_CHOOSING_SITE) return;
    const siteId       = Number(ctx.match[1]);
    const employeeId   = ctx.session.botState.admEmployeeId;
    const employeeName = ctx.session.botState.admEmployeeName;

    const site = ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    const payments = ctx.db.prepare(`
      SELECT p.*, u.full_name AS acc_name FROM payments p
      LEFT JOIN users u ON u.id = p.accountant_id
      WHERE p.employee_id = ? AND p.site_id = ? AND p.status = 'confirmed'
      ORDER BY p.confirmed_at DESC
    `).all(employeeId, siteId);

    const total = payments.reduce((s, p) => s + p.amount, 0);
    const lines = [`👷 <b>${employeeName}</b> · 🏗 <b>${site.name}</b>\n`];
    for (const p of payments) {
      lines.push(`• ${formatRuDate(p.confirmed_at)} — <b>${p.amount.toLocaleString('ru')} ₽</b> | 💼 ${p.acc_name ?? '—'}`);
    }
    lines.push('', `💰 <b>Итого: ${total.toLocaleString('ru')} ₽</b>`);

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ADMIN_VIEW_DETAIL);
    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: backInline() });
  });

  // ── Участники ─────────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ADMIN_MENU) return next();
    if (ctx.message.text !== '👥 Участники') return next();

    const users = ctx.db.prepare('SELECT * FROM users ORDER BY full_name').all();
    const lines = ['👥 <b>Все участники системы:</b>\n'];
    for (const u of users) {
      const roles = [];
      if (u.is_accountant) roles.push('🧾 Бухгалтер');
      if (u.is_employee)   roles.push('👷 Сотрудник');
      if (u.is_admin)      roles.push('🔐 Админ');
      const roleStr = roles.length ? roles.join(' · ') : 'Нет роли';
      const username = u.username ? `@${u.username}` : '—';
      lines.push(`• <b>${u.full_name}</b> (${username})\n  ${roleStr}`);
    }

    goTo(ctx.session.botState, States.ADMIN_USERS_LIST);
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: backInline() });
  });

  // ── Уведомления ───────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ADMIN_MENU) return next();
    if (ctx.message.text !== '🔔 Уведомления') return next();

    const accountants = ctx.db.prepare('SELECT * FROM users WHERE is_accountant = 1').all();
    const lines = ['🔔 <b>Статус уведомлений бухгалтеров:</b>\n'];
    for (const a of accountants) {
      const status = a.notifications_enabled ? '✅ Включены' : '🔕 Отключены';
      lines.push(`• <b>${a.full_name}</b>: ${status}`);
    }
    const allEnabled = accountants.every(a => a.notifications_enabled);
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: notificationsToggleInline(allEnabled),
    });
  });

  bot.callbackQuery('admin_toggle_notifications', async (ctx) => {
    const accountants = ctx.db.prepare('SELECT * FROM users WHERE is_accountant = 1').all();
    const allEnabled  = accountants.every(a => a.notifications_enabled);
    ctx.db.prepare('UPDATE users SET notifications_enabled = ? WHERE is_accountant = 1').run(allEnabled ? 0 : 1);

    const status = !allEnabled ? 'включены ✅' : 'отключены 🔕';
    await ctx.answerCallbackQuery({ text: `Уведомления ${status}`, show_alert: true });
    await ctx.editMessageReplyMarkup({ reply_markup: notificationsToggleInline(!allEnabled) });
  });

  // ── Сводка заявок на аванс ────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ADMIN_MENU) return next();
    if (ctx.message.text !== '📩 Сводка заявок') return next();

    const today = new Date().toISOString().slice(0, 10);
    const advances = ctx.db.prepare(`
      SELECT ar.*, u.full_name AS emp_name, s.name AS site_name
      FROM advance_requests ar
      JOIN users u ON u.id = ar.employee_id
      JOIN sites s ON s.id = ar.site_id
      WHERE ar.status = 'pending' AND date(ar.created_at) = ?
      ORDER BY ar.created_at DESC
    `).all(today);

    const todayStr = new Date().toLocaleDateString('ru-RU');
    if (!advances.length) {
      await ctx.reply(`📩 На ${todayStr} новых заявок нет.`);
      return;
    }

    const total = advances.reduce((s, a) => s + a.amount, 0);
    const lines = [`📩 <b>Заявки на аванс за ${todayStr}:</b>\n`];
    for (const a of advances) {
      const time = new Date(a.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      lines.push(`• <b>${a.emp_name}</b>\n  🏗 ${a.site_name} · 💰 <b>${a.amount.toLocaleString('ru')} ₽</b>\n  🕐 ${time}`);
    }
    lines.push('', `📊 Всего заявок: <b>${advances.length}</b> на <b>${total.toLocaleString('ru')} ₽</b>`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  // ── Сменить роль ──────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ADMIN_MENU) return next();
    if (ctx.message.text !== '🔧 Сменить роль') return next();

    const users = ctx.db.prepare('SELECT * FROM users ORDER BY full_name').all();
    const items = users.map(u => [u.full_name, `role_usr_${u.id}`]);
    goTo(ctx.session.botState, States.ADMIN_ROLE_CHOOSING_USER);
    await ctx.reply('👤 Выберите пользователя:', { reply_markup: paginatedListInline(items) });
  });

  bot.callbackQuery(/^role_usr_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ADMIN_ROLE_CHOOSING_USER) return;
    const userId = Number(ctx.match[1]);
    const target = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ADMIN_ROLE_CHOOSING_ROLE, { roleTargetUserId: userId });
    await ctx.editMessageText(`👤 <b>${target.full_name}</b>\n\nВыберите новую роль:`, {
      parse_mode: 'HTML', reply_markup: adminRoleAssignInline(userId),
    });
  });

  bot.callbackQuery(/^setrole_(\d+)_(accountant|employee|both)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ADMIN_ROLE_CHOOSING_ROLE) return;
    const userId  = Number(ctx.match[1]);
    const newRole = ctx.match[2];
    const target  = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    let isAccountant = 0, isEmployee = 0, activeRole = null, roleLabel = '';
    if (newRole === 'accountant') {
      isAccountant = 1; activeRole = 'accountant'; roleLabel = '🧾 Бухгалтер';
    } else if (newRole === 'employee') {
      isEmployee = 1; activeRole = 'employee'; roleLabel = '👷 Сотрудник';
    } else {
      isAccountant = 1; isEmployee = 1; activeRole = null; roleLabel = '🔀 Обе роли';
    }

    ctx.db.prepare('UPDATE users SET is_accountant=?, is_employee=?, active_role=? WHERE id=?')
      .run(isAccountant, isEmployee, activeRole, userId);

    await ctx.answerCallbackQuery({ text: `Роль обновлена: ${roleLabel}`, show_alert: true });
    await ctx.editMessageText(`✅ <b>${target.full_name}</b> теперь имеет роль: ${roleLabel}`, {
      parse_mode: 'HTML', reply_markup: backInline(),
    });
  });

  // ════════════════════════════════════════════════════════════════
  // УПРАВЛЕНИЕ РАССРОЧКАМИ (Администратор)
  // ════════════════════════════════════════════════════════════════

  const instStatusLabel = s =>
    s === 'active' ? '✅ Активна' : s === 'pending' ? '⏳ Ожидает' : '🔒 Закрыта';
  const fmt = n => Number(n).toLocaleString('ru', { minimumFractionDigits: 2 });

  // ── Список всех рассрочек ─────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ADMIN_MENU) return next();
    if (ctx.message.text !== '💳 Рассрочки') return next();

    const rows = ctx.db.prepare(`
      SELECT i.*, u.full_name
      FROM installments i JOIN users u ON u.id = i.user_id
      ORDER BY i.status, u.full_name
    `).all();

    if (!rows.length) {
      goTo(ctx.session.botState, States.ADMIN_INST_LIST);
      return ctx.reply('💳 Рассрочек в системе нет.', { reply_markup: backInline() });
    }

    const items = rows.map(r => [
      `${r.full_name} | ${instStatusLabel(r.status)} | ${fmt(r.remaining_amount)} ₽`,
      `adm_inst_${r.id}`,
    ]);

    goTo(ctx.session.botState, States.ADMIN_INST_LIST);
    await ctx.reply(
      `💳 <b>Все рассрочки</b> (${rows.length})\n\nВыберите запись:`,
      { parse_mode: 'HTML', reply_markup: paginatedListInline(items) }
    );
  });

  // ── Детали рассрочки ──────────────────────────────────────────
  bot.callbackQuery(/^adm_inst_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ADMIN_INST_LIST) return;

    const instId = Number(ctx.match[1]);
    const inst   = ctx.db.prepare(`
      SELECT i.*, u.full_name FROM installments i JOIN users u ON u.id = i.user_id WHERE i.id = ?
    `).get(instId);

    if (!inst) return ctx.answerCallbackQuery({ text: 'Запись не найдена.', show_alert: true });

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ADMIN_INST_DETAIL, { admInstId: instId });

    await ctx.editMessageText(
      `💳 <b>Рассрочка #${inst.id}</b>\n\n` +
      `👤 Сотрудник: <b>${inst.full_name}</b>\n` +
      `💰 Начальная сумма: <b>${fmt(inst.total_amount)} ₽</b>\n` +
      `📉 Остаток: <b>${fmt(inst.remaining_amount)} ₽</b>\n` +
      `📌 Статус: <b>${instStatusLabel(inst.status)}</b>\n` +
      `📅 Создана: ${formatRuDate(inst.created_at)}\n` +
      `🔄 Обновлена: ${formatRuDate(inst.updated_at)}`,
      { parse_mode: 'HTML', reply_markup: installmentAdminInline(instId) }
    );
  });

  // ── Изменить остаток ──────────────────────────────────────────
  bot.callbackQuery(/^adm_inst_edit_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ADMIN_INST_DETAIL) return;

    const instId = Number(ctx.match[1]);
    const inst   = ctx.db.prepare('SELECT * FROM installments WHERE id = ?').get(instId);
    if (!inst) return ctx.answerCallbackQuery({ text: 'Запись не найдена.', show_alert: true });

    await ctx.answerCallbackQuery();
    goTo(ctx.session.botState, States.ADMIN_INST_EDIT_AMOUNT, { admInstId: instId });

    await ctx.reply(
      `✏️ <b>Изменить остаток</b>\n\nТекущий остаток: <b>${fmt(inst.remaining_amount)} ₽</b>\n\nВведите новую сумму остатка (₽):`,
      { parse_mode: 'HTML', reply_markup: backKeyboard() }
    );
  });

  // ── Ввод нового остатка ────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ADMIN_INST_EDIT_AMOUNT) return next();
    if (ctx.message.text === '◀️ Назад' || ctx.message.text === '◀️ Главное меню') return next();

    const raw    = ctx.message.text.trim().replace(',', '.').replace(/\s/g, '');
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount < 0) {
      return ctx.reply('⚠️ Введите корректное число (≥ 0):');
    }

    const instId   = ctx.session.botState.admInstId;
    const inst     = ctx.db.prepare('SELECT * FROM installments WHERE id = ?').get(instId);
    if (!inst) return ctx.reply('⚠️ Рассрочка не найдена.');

    const newStatus = amount <= 0 ? 'closed' : inst.status === 'closed' ? 'active' : inst.status;
    ctx.db.prepare(`
      UPDATE installments SET remaining_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(amount, newStatus, instId);

    // Уведомление сотруднику
    const employee = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(inst.user_id);
    if (employee) {
      try {
        await ctx.api.sendMessage(
          employee.telegram_id,
          `ℹ️ <b>Администратор скорректировал вашу рассрочку</b>\n\n` +
          `Новый остаток долга: <b>${fmt(amount)} ₽</b>` +
          (newStatus === 'closed' ? '\n\n🎉 <b>Рассрочка закрыта.</b>' : ''),
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        console.warn('[AdminInst] Не удалось уведомить сотрудника:', e.message);
      }
    }

    goTo(ctx.session.botState, States.ADMIN_MENU);
    await ctx.reply(
      `✅ Остаток изменён на <b>${fmt(amount)} ₽</b>` +
      (newStatus === 'closed' ? '\n✅ Рассрочка закрыта.' : ''),
      { parse_mode: 'HTML', reply_markup: adminMenuKeyboard() }
    );
  });

  // ── Принудительное закрытие рассрочки ────────────────────────
  bot.callbackQuery(/^adm_inst_close_(\d+)$/, async (ctx) => {
    if (ctx.session.botState.state !== States.ADMIN_INST_DETAIL) return;

    const instId  = Number(ctx.match[1]);
    const inst    = ctx.db.prepare('SELECT * FROM installments WHERE id = ?').get(instId);
    if (!inst) return ctx.answerCallbackQuery({ text: 'Запись не найдена.', show_alert: true });

    ctx.db.prepare(`
      UPDATE installments SET status = 'closed', updated_at = datetime('now') WHERE id = ?
    `).run(instId);

    // Уведомление сотруднику
    const employee = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(inst.user_id);
    if (employee) {
      try {
        await ctx.api.sendMessage(
          employee.telegram_id,
          `🔒 <b>Ваша рассрочка закрыта администратором.</b>\n\nСумма рассрочки была: <b>${fmt(inst.total_amount)} ₽</b>`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        console.warn('[AdminInst] Не удалось уведомить сотрудника:', e.message);
      }
    }

    await ctx.answerCallbackQuery({ text: '🔒 Рассрочка закрыта', show_alert: true });
    goTo(ctx.session.botState, States.ADMIN_MENU);
    await ctx.editMessageText(
      `🔒 Рассрочка #${instId} <b>закрыта</b> администратором.`,
      { parse_mode: 'HTML', reply_markup: backInline() }
    );
  });
}
