import { States } from '../states.js';
import { roleSelectKeyboard, activeRoleKeyboard } from '../keyboards/roleSelect.js';
import { accountantMenuKeyboard } from '../keyboards/accountant.js';
import { employeeMenuKeyboard } from '../keyboards/employee.js';

export async function sendRoleMenu(ctx, user) {
  if (user.is_accountant && user.is_employee && !user.active_role) {
    ctx.session.botState.state = States.ROLE_SWITCH_CHOOSING;
    await ctx.reply('У вас доступны обе роли. Выберите, как войти:', {
      reply_markup: activeRoleKeyboard(),
    });
    return;
  }

  const role = user.active_role || (user.is_accountant ? 'accountant' : 'employee');

  if (role === 'accountant') {
    ctx.session.botState.state = States.ACC_MENU;
    await ctx.reply(`✅ Добро пожаловать, <b>${user.full_name}</b>!\n\nПанель бухгалтера:`, {
      parse_mode: 'HTML',
      reply_markup: accountantMenuKeyboard(),
    });
  } else {
    const hasActiveInstallment = ctx.db.prepare(
      "SELECT 1 FROM installments WHERE user_id = ? AND status = 'active' LIMIT 1"
    ).get(user.id) !== undefined;
    ctx.session.botState.state = States.EMP_MENU;
    await ctx.reply(`✅ Добро пожаловать, <b>${user.full_name}</b>!\n\nПанель сотрудника:`, {
      parse_mode: 'HTML',
      reply_markup: employeeMenuKeyboard(hasActiveInstallment),
    });
  }
}

export function registerRegistrationHandlers(bot) {
  // /start
  bot.command('start', async (ctx) => {
    const user = ctx.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(ctx.from.id);
    if (user) {
      await sendRoleMenu(ctx, user);
      return;
    }
    ctx.session.botState.state = States.REGISTRATION_WAITING_NAME;
    await ctx.reply(
      '👋 Добро пожаловать в систему учёта!\n\nДля регистрации введите ваше <b>полное имя</b> (Фамилия Имя):',
      { parse_mode: 'HTML' }
    );
  });

  // Шаг 1: ввод имени
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.REGISTRATION_WAITING_NAME) return next();
    const name = ctx.message.text.trim();
    if (name.length < 2) return ctx.reply('⚠️ Имя слишком короткое. Введите полное имя:');
    if (name.length > 255) return ctx.reply('⚠️ Имя слишком длинное. Попробуйте ещё раз:');

    ctx.session.botState._regName = name;
    ctx.session.botState.state = States.REGISTRATION_CHOOSING_ROLE;
    await ctx.reply(`Отлично, <b>${name}</b>!\n\nВыберите вашу роль в системе:`, {
      parse_mode: 'HTML',
      reply_markup: roleSelectKeyboard(true),
    });
  });

  // Шаг 2: выбор роли
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.REGISTRATION_CHOOSING_ROLE) return next();
    const text = ctx.message.text;

    let isAccountant = false, isEmployee = false;
    if (text === '🧾 Бухгалтер')  { isAccountant = true; }
    else if (text === '👷 Сотрудник') { isEmployee = true; }
    else if (text === '🔀 Обе роли')  { isAccountant = true; isEmployee = true; }
    else return next();

    const fullName = ctx.session.botState._regName ?? ctx.from.first_name;
    const activeRole = isAccountant ? 'accountant' : 'employee';

    const stmt = ctx.db.prepare(`
      INSERT INTO users (telegram_id, full_name, username, is_accountant, is_employee, active_role)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(ctx.from.id, fullName, ctx.from.username ?? null,
      isAccountant ? 1 : 0, isEmployee ? 1 : 0, activeRole);

    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    console.log(`[Reg] Новый пользователь: ${user.full_name} (tg_id=${user.telegram_id})`);
    await sendRoleMenu(ctx, user);
  });

  // Выбор активной роли (когда есть обе)
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ROLE_SWITCH_CHOOSING) return next();
    const text = ctx.message.text;

    if (text === '🧾 Войти как Бухгалтер') {
      ctx.db.prepare('UPDATE users SET active_role = ? WHERE telegram_id = ?').run('accountant', ctx.from.id);
      ctx.session.botState.state = States.ACC_MENU;
      await ctx.reply('Панель бухгалтера:', { reply_markup: accountantMenuKeyboard() });
    } else if (text === '👷 Войти как Сотрудник') {
      ctx.db.prepare('UPDATE users SET active_role = ? WHERE telegram_id = ?').run('employee', ctx.from.id);
      const user2 = ctx.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(ctx.from.id);
      const hasActiveInstallment2 = user2
        ? ctx.db.prepare("SELECT 1 FROM installments WHERE user_id = ? AND status = 'active' LIMIT 1").get(user2.id) !== undefined
        : false;
      ctx.session.botState.state = States.EMP_MENU;
      await ctx.reply('Панель сотрудника:', { reply_markup: employeeMenuKeyboard(hasActiveInstallment2) });
    } else {
      return next();
    }
  });
}
