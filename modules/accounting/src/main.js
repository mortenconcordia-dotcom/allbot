import 'dotenv/config';
import fs from 'fs';
import { Bot, session } from 'grammy';
import cron from 'node-cron';

import { BOT_TOKEN } from './config.js';
import { initDb } from './database.js';

// Middlewares
import { dbMiddleware }          from './middlewares/db.js';
import { secretAdminMiddleware } from './middlewares/secretAdmin.js';
import { roleCheckMiddleware }   from './middlewares/roleCheck.js';

// Handlers
import { registerBackHandlers }         from './handlers/back.js';
import { registerRegistrationHandlers } from './handlers/registration.js';
import { registerAdminHandlers }        from './handlers/admin.js';
import { registerPaymentConfirmHandlers } from './handlers/paymentConfirm.js';
import { registerAccPaymentHandlers }   from './handlers/accountant/payment.js';
import { registerAccViewHandlers }      from './handlers/accountant/viewPayments.js';
import { registerAccPurchasesHandlers } from './handlers/accountant/purchases.js';
import { registerAccAdvanceHandlers }   from './handlers/accountant/advance.js';
import { registerEmpViewHandlers }      from './handlers/employee/viewPayments.js';
import { registerEmpAdvanceHandlers }   from './handlers/employee/advance.js';

// Backup
import { runScheduledLocalBackup, runScheduledTelegramBackup } from './utils/backup.js';

// Хранилище сессий (JSON-файл, простая замена MemoryStorage с персистентностью)
import { States } from './states.js';

// ── Простое файловое хранилище сессий ─────────────────────────────────────────
const SESSION_FILE = './data/sessions.json';
let sessionStore = {};

function loadSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      sessionStore = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch { sessionStore = {}; }
}

function saveSessions() {
  try {
    fs.mkdirSync('./data', { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionStore), 'utf8');
  } catch (e) {
    console.error('[Session] Ошибка сохранения сессий:', e.message);
  }
}

// Адаптер хранилища для grammy session()
const fileStorage = {
  read:  async (key) => sessionStore[key] ?? null,
  write: async (key, value) => { sessionStore[key] = value; saveSessions(); },
  delete: async (key) => { delete sessionStore[key]; saveSessions(); },
};

// Делаем storage доступным для paymentConfirm (сброс FSM бухгалтера)
export { fileStorage as storage };

// ── Старт ─────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync('./data',    { recursive: true });
  fs.mkdirSync('./backups', { recursive: true });

  initDb();
  loadSessions();

  if (!BOT_TOKEN) throw new Error('BOT_TOKEN не задан в .env');

  const bot = new Bot(BOT_TOKEN);

  // Сохраняем ссылку на хранилище в bot для paymentConfirm
  bot.storage = fileStorage;

  // ── Session ──────────────────────────────────────────────
  bot.use(session({
    initial: () => ({ state: null }),
    storage: fileStorage,
    getSessionKey: (ctx) => {
      const userId = ctx.from?.id;
      const chatId = ctx.chat?.id ?? ctx.from?.id;
      if (!userId) return undefined;
      return `${chatId}:${userId}`;
    },
  }));

  // ── Middlewares (порядок важен!) ─────────────────────────
  // 1. DB — инжектируем ctx.db
  bot.use(dbMiddleware);
  // 2. SecretAdmin — перехватывает код 337137
  bot.use(secretAdminMiddleware);
  // 3. RoleCheck — проверяет регистрацию, кладёт ctx.user
  bot.use(roleCheckMiddleware);

  // ── Handlers (порядок важен!) ────────────────────────────
  registerBackHandlers(bot);            // ① глобальный «Назад» — первым
  registerPaymentConfirmHandlers(bot);  // ② глобальные коллбэки подтверждения
  registerRegistrationHandlers(bot);   // ③ /start и регистрация
  registerAdminHandlers(bot);          // ④ админ-панель
  registerAccPaymentHandlers(bot);     // ⑤ бухгалтер: выплаты
  registerAccViewHandlers(bot);        // ⑥ бухгалтер: просмотр
  registerAccPurchasesHandlers(bot);   // ⑦ бухгалтер: закупки
  registerAccAdvanceHandlers(bot);     // ⑧ бухгалтер: заявки на аванс
  registerEmpViewHandlers(bot);        // ⑨ сотрудник: просмотр выплат
  registerEmpAdvanceHandlers(bot);     // ⑩ сотрудник: заявка на аванс

  // ── /switch — переключение роли ──────────────────────────
  bot.command('switch', async (ctx) => {
    const user = ctx.user;
    if (!user) return ctx.reply('Сначала зарегистрируйтесь: /start');

    if (user.is_accountant && user.is_employee) {
      ctx.session.botState.state = States.ROLE_SWITCH_CHOOSING;
      const { activeRoleKeyboard } = await import('./keyboards/roleSelect.js');
      await ctx.reply('Выберите активную роль:', { reply_markup: activeRoleKeyboard() });
    } else {
      const role = user.is_accountant ? '🧾 Бухгалтер' : '👷 Сотрудник';
      await ctx.reply(`У вас только одна роль: ${role}`);
    }
  });

  // ── Планировщик бэкапов ───────────────────────────────────
  // Локальный бэкап каждые 6 часов
  cron.schedule('0 */6 * * *', () => runScheduledLocalBackup(), { timezone: 'Europe/Moscow' });
  // Немедленный первый запуск
  runScheduledLocalBackup();

  // Telegram-бэкап раз в сутки в 03:00
  cron.schedule('0 3 * * *', () => runScheduledTelegramBackup(bot), { timezone: 'Europe/Moscow' });

  console.log('[Cron] Планировщик бэкапов запущен');

  // ── Запуск бота ───────────────────────────────────────────
  console.log('[Bot] Бот запускается...');

  process.once('SIGINT',  () => { bot.stop(); console.log('[Bot] Остановлен (SIGINT)');  });
  process.once('SIGTERM', () => { bot.stop(); console.log('[Bot] Остановлен (SIGTERM)'); });

  await bot.start({
    onStart: () => console.log('[Bot] Бот запущен и слушает обновления'),
  });
}

main().catch(e => {
  console.error('[Fatal]', e);
  process.exit(1);
});
