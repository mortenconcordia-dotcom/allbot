'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║                     PARALLAX.JS                             ║
 * ║         Единый маршрутизатор / шлюз для 4-х ботов           ║
 * ║                                                             ║
 * ║  Боты-модули:                                               ║
 * ║   • delivery   — Ditry Express  (grammy, FSM in-memory)     ║
 * ║   • karnizcal  — Расчёт карнизов (node-telegram-bot-api)    ║
 * ║   • accounting — Бухгалтерия     (grammy, ESM, SQLite)      ║
 * ║   • smeta      — Сканер смет     (Telegraf, TypeScript/JS)  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Архитектурный принцип:
 *   Parallax использует grammy как основу + встроенный session.
 *   Каждый модуль экспортирует функцию handleUpdate(ctx, returnToMain).
 *   Когда пользователь выбирает бота, ctx.session.activeBot фиксируется.
 *   Все последующие апдейты маршрутизируются ТОЛЬКО в выбранный модуль.
 *   Кнопка «Назад» / команда /menu в любом месте возвращает в главное меню.
 */

require('dotenv').config();

const { Bot, session, InlineKeyboard } = require('grammy');

// ── Модули-боты ────────────────────────────────────────────────────────────
const deliveryModule   = require('./modules/delivery/index.js');
const karnizcalModule  = require('./modules/karnizcal/index.js');
const accountingModule = require('./modules/accounting/index.js');
const smetaModule      = require('./modules/smeta/index.js');

// ── Маппинг id → модуль ────────────────────────────────────────────────────
const MODULES = {
  delivery:   deliveryModule,
  karnizcal:  karnizcalModule,
  accounting: accountingModule,
  smeta:      smetaModule,
};

// ── Токен ──────────────────────────────────────────────────────────────────
const BOT_TOKEN = (process.env.PARALLAX_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
if (!BOT_TOKEN) {
  throw new Error(
    'Не задан PARALLAX_BOT_TOKEN (или BOT_TOKEN) в файле .env\n' +
    'Пример: PARALLAX_BOT_TOKEN=123456:ABC-DEF...'
  );
}

// ── Создание бота ──────────────────────────────────────────────────────────
const bot = new Bot(BOT_TOKEN);

// ── Хранилище сессий (in-memory, можно заменить на файловое/Redis) ─────────
const { MemorySessionStorage } = require('grammy');
const parallaxStorage = new MemorySessionStorage();
bot.parallaxStorage = parallaxStorage;

bot.use(session({
  initial: () => ({
    activeBot: null,   // 'delivery' | 'karnizcal' | 'accounting' | 'smeta' | null
    botState:  {},     // произвольный state внутри выбранного модуля
  }),
  storage: parallaxStorage,
}));

// Прокидываем хранилище в контекст, чтобы модули могли менять сессии других юзеров
bot.use(async (ctx, next) => {
  ctx.parallaxStorage = parallaxStorage;
  await next();
});

// ══════════════════════════════════════════════════════════════════════════
// ГЛАВНОЕ МЕНЮ
// ══════════════════════════════════════════════════════════════════════════

function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text('🚚 Ditry Express',     'bot:delivery').row()
    .text('🪟 Расчёт карнизов',   'bot:karnizcal').row()
    .text('🧾 Бухгалтерия',       'bot:accounting').row()
    .text('📄 Сканер смет',       'bot:smeta');
}

async function showMainMenu(ctx) {
  const text =
    '👋 *Добро пожаловать в Parallax!*\n\n' +
    'Выберите нужный раздел из меню ниже:';

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    }).catch(() =>
      ctx.reply(text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() })
    );
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ФУНКЦИЯ ВОЗВРАТА В ГЛАВНОЕ МЕНЮ (передаётся в каждый модуль)
// ══════════════════════════════════════════════════════════════════════════

async function returnToMain(ctx) {
  // Сбрасываем сессию выбранного бота
  ctx.session.activeBot = null;
  ctx.session.botState  = {};
  await showMainMenu(ctx);
}

// ══════════════════════════════════════════════════════════════════════════
// ГЛОБАЛЬНЫЕ КОМАНДЫ (работают всегда, из любого состояния)
// ══════════════════════════════════════════════════════════════════════════

// /start — показать главное меню и сбросить состояние
bot.command('start', async (ctx, next) => {
  if (ctx.session.activeBot) {
    // Если мы уже внутри модуля (например, бухгалтерии), прокидываем /start ему
    return next();
  }
  ctx.session.activeBot = null;
  ctx.session.botState  = {};
  await showMainMenu(ctx);
});

// /menu — быстрый возврат в главное меню из любого бота
bot.command('menu', async (ctx) => {
  await returnToMain(ctx);
});

// ══════════════════════════════════════════════════════════════════════════
// ВЫБОР БОТА (callback_query с префиксом bot:)
// ══════════════════════════════════════════════════════════════════════════

bot.callbackQuery(/^bot:(.+)$/, async (ctx) => {
  const botId = ctx.match[1]; // 'delivery' | 'karnizcal' | 'accounting' | 'smeta'

  if (!MODULES[botId]) {
    await ctx.answerCallbackQuery('Неизвестный модуль');
    return;
  }

  await ctx.answerCallbackQuery();

  // Сбрасываем предыдущее состояние и фиксируем выбор
  ctx.session.activeBot = botId;
  ctx.session.botState  = {};

  // Передаём управление модулю (он покажет своё стартовое меню)
  const mod = MODULES[botId];
  if (typeof mod.onEnter === 'function') {
    await mod.onEnter(ctx, returnToMain);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ГЛОБАЛЬНЫЙ ПЕРЕХВАТ КНОПКИ «Назад» / «◀️ В главное меню»
// Модули могут посылать callback_data: 'parallax:back'
// ══════════════════════════════════════════════════════════════════════════

bot.callbackQuery('parallax:back', async (ctx) => {
  await ctx.answerCallbackQuery();
  await returnToMain(ctx);
});

// ══════════════════════════════════════════════════════════════════════════
// МАРШРУТИЗАТОР: все остальные апдейты → в активный модуль
// ══════════════════════════════════════════════════════════════════════════

bot.use(async (ctx) => {
  const botId = ctx.session?.activeBot;

  // Нет активного бота — показываем главное меню
  if (!botId) {
    await showMainMenu(ctx);
    return;
  }

  const mod = MODULES[botId];
  if (!mod || typeof mod.handleUpdate !== 'function') {
    ctx.session.activeBot = null;
    await showMainMenu(ctx);
    return;
  }

  // Передаём апдейт в модуль
  // Модуль получает (ctx, returnToMain) и сам решает что делать
  await mod.handleUpdate(ctx, returnToMain);
});

// ══════════════════════════════════════════════════════════════════════════
// ЗАПУСК
// ══════════════════════════════════════════════════════════════════════════

bot.catch((err, ctx) => {
  console.error(`[Parallax] Ошибка при обработке апдейта от ${ctx?.from?.id}:`, err.message);
});

process.once('SIGINT',  () => { bot.stop(); console.log('[Parallax] Остановлен (SIGINT)');  });
process.once('SIGTERM', () => { bot.stop(); console.log('[Parallax] Остановлен (SIGTERM)'); });

bot.start({
  onStart: () => console.log('[Parallax] ✅ Мультибот запущен и слушает обновления'),
});
