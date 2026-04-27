'use strict';

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// --------- Conversation states ----------
const STATE_CHOOSE_MODE = 'CHOOSE_MODE';
const STATE_ENTER_LENGTH = 'ENTER_LENGTH';

// --------- Modes ----------
const MODE_CENTER = 'center';
const MODE_LR = 'left_right';

// --------- Callback data ----------
const CB_CENTER = 'mode_center';
const CB_LR = 'mode_lr';
const CB_NEW = 'new_calc';
const CB_BACK = 'back_to_menu';

// --------- User state storage (in-memory) ----------
const userState = new Map(); // userId -> { state, mode }

function getUser(userId) {
  if (!userState.has(userId)) {
    userState.set(userId, { state: STATE_CHOOSE_MODE, mode: null });
  }
  return userState.get(userId);
}

function clearUser(userId) {
  userState.set(userId, { state: STATE_CHOOSE_MODE, mode: null });
}

// ----------------- UI -----------------
function menuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'К центру', callback_data: CB_CENTER },
        { text: 'Слева-Направо', callback_data: CB_LR },
      ],
    ],
  };
}

function afterResultKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Начать новый расчёт', callback_data: CB_NEW }],
    ],
  };
}

function backKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⬅️ Назад к выбору', callback_data: CB_BACK }],
    ],
  };
}

// ----------------- Parsing -----------------
function parseLength(text) {
  let t = text.trim().toLowerCase();
  t = t.replace('см', '').trim();
  t = t.replace(',', '.');
  const x = parseFloat(t);
  if (isNaN(x) || x <= 0) return null;
  return x;
}

// ----------------- Calculator logic -----------------
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
  const hooks = runners + 10;
  const mounts = Math.ceil(x / 100.0) + 1;

  return {
    modeName,
    X: x,
    L: Math.round(L * 10) / 10,
    N,
    S,
    runners,
    hooks,
    mounts,
  };
}

function formatScheme(S, N) {
  return Array.from({ length: N }, () => `${S} см`).join('   ');
}

// ----------------- Bot init -----------------
const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error(
    'Не найден BOT_TOKEN.\n' +
    'Варианты: (1) задайте переменную окружения BOT_TOKEN, (2) положите BOT_TOKEN=... в файл .env рядом с bot.js'
  );
}

const bot = new TelegramBot(token, { polling: true });

// ----------------- Handlers -----------------

// /start
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  clearUser(userId);
  const user = getUser(userId);
  user.state = STATE_CHOOSE_MODE;

  await bot.sendMessage(msg.chat.id, 'Выберите режим расчёта:', {
    reply_markup: menuKeyboard(),
  });
});

// /cancel
bot.onText(/\/cancel/, async (msg) => {
  const userId = msg.from.id;
  clearUser(userId);
  await bot.sendMessage(msg.chat.id, 'Ок. Нажмите /start чтобы начать заново.');
});

// /test — quick self-check
bot.onText(/\/test/, async (msg) => {
  const tests = [202, 289, 404, 510, 550, 653];
  const lines = ['🧪 Тест (контрольные значения):'];

  for (const x of tests) {
    const c = calc(MODE_CENTER, x);
    const lr = calc(MODE_LR, x);
    lines.push(`\nX=${x} см | Бегунки ${c.runners} | Крючки ${c.hooks} | Крепления ${c.mounts}`);
    lines.push(`  К центру:  ${formatScheme(c.S, c.N)}  (L=${c.L})`);
    lines.push(`  Слева→Напр: ${formatScheme(lr.S, lr.N)}  (L=${lr.L})`);
  }

  await bot.sendMessage(msg.chat.id, lines.join('\n'));
});

// Callback query handler
bot.on('callback_query', async (q) => {
  const userId = q.from.id;
  const chatId = q.message.chat.id;
  const messageId = q.message.message_id;
  const user = getUser(userId);

  await bot.answerCallbackQuery(q.id);

  if (q.data === CB_CENTER) {
    user.mode = MODE_CENTER;
    user.state = STATE_ENTER_LENGTH;
    await bot.editMessageText('Режим: К центру.\nВведите длину карниза X (см):', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: backKeyboard(),
    });
    return;
  }

  if (q.data === CB_LR) {
    user.mode = MODE_LR;
    user.state = STATE_ENTER_LENGTH;
    await bot.editMessageText('Режим: Слева-Направо.\nВведите длину карниза X (см):', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: backKeyboard(),
    });
    return;
  }

  if (q.data === CB_BACK) {
    user.mode = null;
    user.state = STATE_CHOOSE_MODE;
    await bot.editMessageText('Выберите режим расчёта:', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: menuKeyboard(),
    });
    return;
  }

  if (q.data === CB_NEW) {
    clearUser(userId);
    await bot.editMessageText('Выберите режим расчёта:', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: menuKeyboard(),
    });
    return;
  }
});

// Text message handler (length input)
bot.on('message', async (msg) => {
  // Ignore commands
  if (!msg.text || msg.text.startsWith('/')) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const user = getUser(userId);

  if (user.state !== STATE_ENTER_LENGTH) {
    // Not in length input state — prompt to choose mode
    await bot.sendMessage(chatId, 'Сначала выберите режим:', {
      reply_markup: menuKeyboard(),
    });
    user.state = STATE_CHOOSE_MODE;
    return;
  }

  if (!user.mode || (user.mode !== MODE_CENTER && user.mode !== MODE_LR)) {
    await bot.sendMessage(chatId, 'Сначала выберите режим:', {
      reply_markup: menuKeyboard(),
    });
    user.state = STATE_CHOOSE_MODE;
    return;
  }

  const x = parseLength(msg.text);
  if (x === null) {
    await bot.sendMessage(chatId, 'Введите число в см (например: 404 или 404.5):');
    return;
  }

  const res = calc(user.mode, x);
  const scheme = formatScheme(res.S, res.N);

  const text =
    `✅ Результат\n` +
    `Режим: ${res.modeName}\n` +
    `Длина карниза X: ${res.X} см\n\n` +
    `Схема: ${scheme}\n` +
    `Рабочая длина L: ${res.L} см\n\n` +
    `Бегунков: ${res.runners} шт.\n` +
    `Крючков: ${res.hooks} шт.\n` +
    `Креплений: ${res.mounts} шт.`;

  await bot.sendMessage(chatId, text, { reply_markup: afterResultKeyboard() });

  // Return to CHOOSE_MODE state (ready for next calculation or new_calc button)
  user.state = STATE_CHOOSE_MODE;
  user.mode = null;
});

console.log('🤖 Бот запущен...');
