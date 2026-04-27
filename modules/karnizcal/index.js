'use strict';

/**
 * ════════════════════════════════════════════════════════════════
 * МОДУЛЬ: Расчёт карнизов (karnizcal)
 * Исходник: karnizcal-bot-nodejs.zip / karnizcal-bot/bot.js
 *
 * Адаптация:
 *  Оригинал использовал node-telegram-bot-api (polling).
 *  Здесь вся логика перенесена в «чистые функции» без привязки к
 *  конкретной библиотеке. Parallax передаёт ctx (grammy-контекст),
 *  и мы вызываем ctx.reply / ctx.editMessageText напрямую.
 *
 * Экспортирует:
 *  onEnter(ctx, returnToMain)    — вызывается при входе в модуль
 *  handleUpdate(ctx, returnToMain) — роутер для всех апдейтов
 * ════════════════════════════════════════════════════════════════
 */

// ── Состояния FSM ──────────────────────────────────────────────
const S = {
  CHOOSE_MODE:   'CHOOSE_MODE',
  ENTER_LENGTH:  'ENTER_LENGTH',
};

// ── Режимы расчёта ─────────────────────────────────────────────
const MODE_CENTER = 'center';
const MODE_LR     = 'left_right';

// ── Callback data ──────────────────────────────────────────────
const CB_CENTER = 'k:mode_center';
const CB_LR     = 'k:mode_lr';
const CB_NEW    = 'k:new_calc';
const CB_BACK   = 'parallax:back'; // глобальный — перехватывается parallax.js

// ══════════════════════════════════════════════════════════════
// КЛАВИАТУРЫ
// ══════════════════════════════════════════════════════════════

function modeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'К центру',       callback_data: CB_CENTER },
        { text: 'Слева → Направо', callback_data: CB_LR },
      ],
      [{ text: '◀️ В главное меню', callback_data: CB_BACK }],
    ],
  };
}

function backAndMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '◀️ В главное меню', callback_data: CB_BACK }],
    ],
  };
}

function afterResultKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔄 Новый расчёт',  callback_data: CB_NEW }],
      [{ text: '◀️ В главное меню', callback_data: CB_BACK }],
    ],
  };
}

// ══════════════════════════════════════════════════════════════
// БИЗНЕС-ЛОГИКА (перенесена из оригинального bot.js без изменений)
// ══════════════════════════════════════════════════════════════

function parseLength(text) {
  let t = text.trim().toLowerCase();
  t = t.replace('см', '').trim();
  t = t.replace(',', '.');
  const x = parseFloat(t);
  if (isNaN(x) || x <= 0) return null;
  return x;
}

function evenUp(n) {
  return n % 2 === 0 ? n : n + 1;
}

function calc(mode, x) {
  let modeName, L;

  if (mode === MODE_CENTER) {
    modeName = 'К центру';
    L = x - 15.2;
  } else if (mode === MODE_LR) {
    modeName = 'Слева-Направо';
    L = x - 11.6;
  } else {
    throw new Error('Unknown mode');
  }

  L = Math.max(0.0, L);
  const N = Math.max(1, Math.ceil(L / 300.0));
  const S = Math.round((L / N) * 10) / 10;

  const runners = evenUp(Math.ceil(x / 8.0));
  const hooks   = runners + 10;
  const mounts  = Math.ceil(x / 100.0) + 1;

  return { modeName, X: x, L: Math.round(L * 10) / 10, N, S, runners, hooks, mounts };
}

function formatScheme(S, N) {
  return Array.from({ length: N }, () => `${S} см`).join('   ');
}

// ══════════════════════════════════════════════════════════════
// ХЕЛПЕРЫ ДЛЯ РАБОТЫ С СЕССИЕЙ
// (botState хранится в ctx.session.botState)
// ══════════════════════════════════════════════════════════════

function getState(ctx) {
  return ctx.session.botState?.state || S.CHOOSE_MODE;
}

function getMode(ctx) {
  return ctx.session.botState?.mode || null;
}

function setState(ctx, state, extra = {}) {
  ctx.session.botState = { ...ctx.session.botState, state, ...extra };
}

function resetState(ctx) {
  ctx.session.botState = { state: S.CHOOSE_MODE, mode: null };
}

// ══════════════════════════════════════════════════════════════
// ВХОД В МОДУЛЬ
// ══════════════════════════════════════════════════════════════

async function onEnter(ctx, _returnToMain) {
  resetState(ctx);
  await ctx.reply('🪟 *Расчёт карнизов*\n\nВыберите режим расчёта:', {
    parse_mode: 'Markdown',
    reply_markup: modeKeyboard(),
  });
}

// ══════════════════════════════════════════════════════════════
// РОУТЕР АПДЕЙТОВ
// ══════════════════════════════════════════════════════════════

async function handleUpdate(ctx, returnToMain) {
  // ── Callback query ──────────────────────────────────────────
  if (ctx.callbackQuery) {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => {});

    if (data === CB_CENTER) {
      setState(ctx, S.ENTER_LENGTH, { mode: MODE_CENTER });
      await ctx.editMessageText('Режим: *К центру*\n\nВведите длину карниза X (в сантиметрах):', {
        parse_mode: 'Markdown',
        reply_markup: backAndMenuKeyboard(),
      }).catch(() =>
        ctx.reply('Введите длину карниза X (в сантиметрах):', { reply_markup: backAndMenuKeyboard() })
      );
      return;
    }

    if (data === CB_LR) {
      setState(ctx, S.ENTER_LENGTH, { mode: MODE_LR });
      await ctx.editMessageText('Режим: *Слева → Направо*\n\nВведите длину карниза X (в сантиметрах):', {
        parse_mode: 'Markdown',
        reply_markup: backAndMenuKeyboard(),
      }).catch(() =>
        ctx.reply('Введите длину карниза X (в сантиметрах):', { reply_markup: backAndMenuKeyboard() })
      );
      return;
    }

    if (data === CB_NEW) {
      resetState(ctx);
      await ctx.editMessageText('Выберите режим расчёта:', {
        reply_markup: modeKeyboard(),
      }).catch(() =>
        ctx.reply('Выберите режим расчёта:', { reply_markup: modeKeyboard() })
      );
      return;
    }

    // Неизвестный callback — показываем меню
    await ctx.reply('Выберите режим расчёта:', { reply_markup: modeKeyboard() });
    return;
  }

  // ── Text message ────────────────────────────────────────────
  if (ctx.message?.text) {
    const text  = ctx.message.text;
    const state = getState(ctx);
    const mode  = getMode(ctx);

    // Игнорируем команды (они уже обработаны в parallax.js)
    if (text.startsWith('/')) return;

    if (state !== S.ENTER_LENGTH || !mode) {
      await ctx.reply('Выберите режим расчёта:', { reply_markup: modeKeyboard() });
      resetState(ctx);
      return;
    }

    const x = parseLength(text);
    if (x === null) {
      await ctx.reply('Введите число в сантиметрах (например: 404 или 404.5):', {
        reply_markup: backAndMenuKeyboard(),
      });
      return;
    }

    const res    = calc(mode, x);
    const scheme = formatScheme(res.S, res.N);

    const result =
      `✅ *Результат*\n` +
      `Режим: ${res.modeName}\n` +
      `Длина карниза X: ${res.X} см\n\n` +
      `Схема: \`${scheme}\`\n` +
      `Рабочая длина L: ${res.L} см\n\n` +
      `Бегунков: *${res.runners}* шт.\n` +
      `Крючков: *${res.hooks}* шт.\n` +
      `Креплений: *${res.mounts}* шт.`;

    await ctx.reply(result, {
      parse_mode: 'Markdown',
      reply_markup: afterResultKeyboard(),
    });

    // Готовы к следующему расчёту
    setState(ctx, S.CHOOSE_MODE, { mode: null });
  }
}

// ══════════════════════════════════════════════════════════════
// ЭКСПОРТ
// ══════════════════════════════════════════════════════════════

module.exports = { onEnter, handleUpdate };
