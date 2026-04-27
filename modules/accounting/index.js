'use strict';

/**
 * ════════════════════════════════════════════════════════════════
 * МОДУЛЬ: Бухгалтерия (accounting)
 * Исходник: accounting_bot_node.zip
 *
 * Accounting-бот написан на grammy (ESM) с session, ролевой системой,
 * SQLite-БД и развитым FSM.
 *
 * Стратегия адаптации:
 *   Оригинал — ESM ("type": "module"). Parallax — CommonJS.
 *   Решение: адаптер использует динамический import() для загрузки
 *   ESM-модулей из папки accounting_bot_node/src/.
 *
 *   Состояние пользователя хранится в ctx.session.botState,
 *   а не в отдельном fileStorage оригинала. При необходимости
 *   можно подключить fileStorage оригинала через адаптер.
 *
 * ВАЖНО ДЛЯ РАЗРАБОТЧИКА:
 *   1. Скопируйте папку accounting_bot_node/src/ → modules/accounting/src/
 *   2. Удалите из src/main.js строки с bot.start() и process.once(SIGINT)
 *   3. Экспортируйте функцию registerAllHandlers(bot) из src/main.js
 *   4. В этом файле мы создаём «внутренний» роутер grammy
 *      и регистрируем на нём все обработчики accounting-бота.
 *
 * Реализация через «дочерний роутер» grammy (Router / Composer):
 *   grammy позволяет создать Composer и зарегистрировать его как
 *   middleware в основном боте. Это самый чистый способ интеграции.
 * ════════════════════════════════════════════════════════════════
 */

const { Composer } = require('grammy');
const path = require('path');

// ── Флаг инициализации (ESM-модули грузим один раз) ───────────────────────
let _initialized = false;
let _composer    = null;

/**
 * Инициализирует accounting-composer асинхронно (один раз).
 * Использует динамический import() для загрузки ESM-модулей.
 */
async function initComposer() {
  if (_initialized) return _composer;

  const composer = new Composer();

  try {
    // Путь к скопированным файлам accounting_bot_node
    const { pathToFileURL } = require('url');
    const srcPath = pathToFileURL(path.resolve(__dirname, 'src')).href;

    // Динамически загружаем ESM-модули
    const { initDb }        = await import(`${srcPath}/database.js`);
    const { dbMiddleware }  = await import(`${srcPath}/middlewares/db.js`);
    const { roleCheckMiddleware } = await import(`${srcPath}/middlewares/roleCheck.js`);
    const { secretAdminMiddleware } = await import(`${srcPath}/middlewares/secretAdmin.js`);

    const { registerBackHandlers }          = await import(`${srcPath}/handlers/back.js`);
    const { registerRegistrationHandlers }  = await import(`${srcPath}/handlers/registration.js`);
    const { registerAdminHandlers }         = await import(`${srcPath}/handlers/admin.js`);
    const { registerPaymentConfirmHandlers }= await import(`${srcPath}/handlers/paymentConfirm.js`);
    const { registerAccPaymentHandlers }    = await import(`${srcPath}/handlers/accountant/payment.js`);
    const { registerAccViewHandlers }       = await import(`${srcPath}/handlers/accountant/viewPayments.js`);
    const { registerAccPurchasesHandlers }  = await import(`${srcPath}/handlers/accountant/purchases.js`);
    const { registerAccAdvanceHandlers }    = await import(`${srcPath}/handlers/accountant/advance.js`);
    const { registerAccInstallmentHandlers } = await import(`${srcPath}/handlers/accountant/installments.js`);
    const { registerEmpViewHandlers }       = await import(`${srcPath}/handlers/employee/viewPayments.js`);
    const { registerEmpAdvanceHandlers }    = await import(`${srcPath}/handlers/employee/advance.js`);
    const { registerEmpInstallmentHandlers } = await import(`${srcPath}/handlers/employee/installments.js`);

    initDb();

    // ── Middlewares ────────────────────────────────────────────

    composer.use(dbMiddleware);
    composer.use(secretAdminMiddleware);
    composer.use(roleCheckMiddleware);

    // ── Handlers ───────────────────────────────────────────────
    registerBackHandlers(composer);
    registerPaymentConfirmHandlers(composer);
    registerEmpInstallmentHandlers(composer);   // ③ раньше roleCheck — для inst_confirm/inst_reject
    registerRegistrationHandlers(composer);
    registerAdminHandlers(composer);
    registerAccPaymentHandlers(composer);
    registerAccViewHandlers(composer);
    registerAccPurchasesHandlers(composer);
    registerAccAdvanceHandlers(composer);
    registerAccInstallmentHandlers(composer);
    registerEmpViewHandlers(composer);
    registerEmpAdvanceHandlers(composer);

  } catch (err) {
    console.error('[Accounting] Ошибка инициализации:', err.message);
    console.error('[Accounting] Убедитесь, что папка modules/accounting/src/ существует.');

    // Заглушка если модуль не установлен
    composer.use(async (ctx) => {
      await ctx.reply(
        '⚠️ Модуль Бухгалтерия временно недоступен.\n' +
        'Убедитесь, что файлы из accounting_bot_node/src/ скопированы в modules/accounting/src/'
      );
    });
  }

  _composer    = composer;
  _initialized = true;
  return composer;
}

// ══════════════════════════════════════════════════════════════
// ВХОД В МОДУЛЬ
// ══════════════════════════════════════════════════════════════

async function onEnter(ctx, _returnToMain) {
  // Сбрасываем состояние accounting-бота
  ctx.session.botState = { state: null };

  await ctx.reply(
    '🧾 *Бухгалтерия*\n\n' +
    'Добро пожаловать в систему учёта.\n' +
    'Используйте /start для начала работы с модулем.\n\n' +
    '_Чтобы вернуться в главное меню — нажмите кнопку «Назад» или введите /menu_',
    { parse_mode: 'Markdown' }
  );

  // Инициализируем composer в фоне
  await initComposer();
}

// ══════════════════════════════════════════════════════════════
// РОУТЕР АПДЕЙТОВ
// ══════════════════════════════════════════════════════════════

async function handleUpdate(ctx, returnToMain) {
  // Кнопка «Назад» — глобально перехватывается parallax.js
  // Здесь дополнительно ловим /menu и ◀️ Главное меню
  if (ctx.message?.text === '/menu' || ctx.message?.text === '◀️ Главное меню') {
    await returnToMain(ctx);
    return;
  }

  // Получаем инициализированный composer
  const composer = await initComposer();

  // Прогоняем апдейт через composer accounting-бота
  // Используем internal API grammy для запуска middleware цепочки
  await composer.middleware()(ctx, async () => {});
}

// ══════════════════════════════════════════════════════════════
// ЭКСПОРТ
// ══════════════════════════════════════════════════════════════

module.exports = { onEnter, handleUpdate };
