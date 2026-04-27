'use strict';

/**
 * ════════════════════════════════════════════════════════════════
 * МОДУЛЬ: Сканер смет (smeta)
 * Исходник: Smeta-main.zip
 *
 * Smeta-бот написан на TypeScript + Telegraf.
 * Логика: принимает PDF-смету → парсит через Gemini AI →
 * возвращает расчёт материалов и финансовую сводку.
 *
 * Стратегия адаптации:
 *   TypeScript-код нужно скомпилировать (tsc) → dist/
 *   Затем импортировать сервисы напрямую (без Telegraf-бота).
 *   Это самый чистый подход: берём только бизнес-логику,
 *   а транспортный слой (Telegraf) заменяем на grammy ctx.
 *
 * ВАЖНО ДЛЯ РАЗРАБОТЧИКА:
 *   1. Скопируйте Smeta-main/src/ → modules/smeta/src/
 *   2. Скопируйте Smeta-main/tsconfig.json → modules/smeta/tsconfig.json
 *   3. Выполните: cd modules/smeta && npm install && npx tsc
 *   4. Подключите GEMINI_API_KEY в .env
 *
 * Альтернатива без компиляции:
 *   Установите ts-node и импортируйте .ts файлы напрямую через
 *   require('ts-node/register') (медленнее, но проще для разработки).
 * ════════════════════════════════════════════════════════════════
 */

const path = require('path');

// ── Попытка загрузить скомпилированные сервисы ────────────────────────────
let parsePdfWithGemini   = null;
let calculateMaterials   = null;
let formatMaterialList   = null;
let formatFinancialStatement = null;
let _servicesLoaded = false;

async function loadServices() {
  if (_servicesLoaded) return;
  _servicesLoaded = true;

  try {
    // Вариант 1: Скомпилированный JS (после tsc)
    const distPath = path.resolve(__dirname, 'dist');
    const geminiMod    = require(`${distPath}/services/gemini.js`);
    const calcMod      = require(`${distPath}/services/calculator.js`);
    const formatterMod = require(`${distPath}/utils/formatter.js`);

    parsePdfWithGemini       = geminiMod.parsePdfWithGemini;
    calculateMaterials       = calcMod.calculateMaterials;
    formatMaterialList       = formatterMod.formatMaterialList;
    formatFinancialStatement = formatterMod.formatFinancialStatement;

    console.log('[Smeta] Сервисы загружены из dist/');
  } catch (e1) {
    try {
      // Вариант 2: ts-node (require hook)
      require('ts-node/register');
      const srcPath = path.resolve(__dirname, 'src');
      const geminiMod    = require(`${srcPath}/services/gemini.ts`);
      const calcMod      = require(`${srcPath}/services/calculator.ts`);
      const formatterMod = require(`${srcPath}/utils/formatter.ts`);

      parsePdfWithGemini       = geminiMod.parsePdfWithGemini;
      calculateMaterials       = calcMod.calculateMaterials;
      formatMaterialList       = formatterMod.formatMaterialList;
      formatFinancialStatement = formatterMod.formatFinancialStatement;

      console.log('[Smeta] Сервисы загружены через ts-node');
    } catch (e2) {
      console.error('[Smeta] Не удалось загрузить сервисы:', e2.message);
      console.error('[Smeta] Выполните: cd modules/smeta && npm install && npx tsc');
    }
  }
}

// ══════════════════════════════════════════════════════════════
// УТИЛИТА: скачать файл по URL
// (перенесена из оригинального src/bot/index.ts без изменений)
// ══════════════════════════════════════════════════════════════

const https = require('https');
const http  = require('http');

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const chunks  = [];
    const client  = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

// ══════════════════════════════════════════════════════════════
// КЛАВИАТУРА С КНОПКОЙ ВОЗВРАТА
// ══════════════════════════════════════════════════════════════

function backKeyboard() {
  const { InlineKeyboard } = require('grammy');
  return new InlineKeyboard()
    .text('◀️ В главное меню', 'parallax:back');
}

// ══════════════════════════════════════════════════════════════
// ВХОД В МОДУЛЬ
// ══════════════════════════════════════════════════════════════

async function onEnter(ctx, _returnToMain) {
  // Инициируем загрузку сервисов в фоне
  loadServices().catch(() => {});

  await ctx.reply(
    '📄 *Сканер смет*\n\n' +
    'Отправьте PDF-смету натяжных потолков, и я рассчитаю:\n' +
    '• Количество материалов\n' +
    '• Финансовую сводку\n\n' +
    '_Поддерживаются только файлы в формате PDF_',
    {
      parse_mode: 'Markdown',
      reply_markup: backKeyboard(),
    }
  );
}

// ══════════════════════════════════════════════════════════════
// РОУТЕР АПДЕЙТОВ
// ══════════════════════════════════════════════════════════════

async function handleUpdate(ctx, returnToMain) {
  // ── Callback query ──────────────────────────────────────────
  if (ctx.callbackQuery) {
    // parallax:back обрабатывается в parallax.js автоматически
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  // ── Документ (PDF) ──────────────────────────────────────────
  if (ctx.message?.document) {
    const doc      = ctx.message.document;
    const fileName = doc.file_name || 'unknown';

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      await ctx.reply('❌ Пожалуйста, отправьте файл в формате PDF.', {
        reply_markup: backKeyboard(),
      });
      return;
    }

    // Проверяем что сервисы загружены
    await loadServices();
    if (!parsePdfWithGemini || !calculateMaterials) {
      await ctx.reply(
        '⚠️ Сервисы Сканера смет не загружены.\n' +
        'Убедитесь что TypeScript-код скомпилирован:\n' +
        '`cd modules/smeta && npm install && npx tsc`',
        { parse_mode: 'Markdown', reply_markup: backKeyboard() }
      );
      return;
    }

    const statusMsg = await ctx.reply('⏳ Загружаю и анализирую смету... (может занять ~30 сек)');

    try {
      // Получаем ссылку на файл
      const fileLink = await ctx.api.getFile(doc.file_id);
      const fileUrl  = `https://api.telegram.org/file/bot${ctx.api.token}/${fileLink.file_path}`;

      const fileBuffer     = await downloadFile(fileUrl);
      const parsedData     = await parsePdfWithGemini(fileBuffer, fileName);
      const calcMaterials  = await calculateMaterials(parsedData);
      const materialsMsg   = formatMaterialList(parsedData.projectName || 'Без названия', calcMaterials);
      const financialMsg   = formatFinancialStatement(calcMaterials);

      await ctx.reply(materialsMsg,  { parse_mode: 'HTML' });
      await ctx.reply(financialMsg,  { parse_mode: 'HTML' });
      await ctx.reply('✅ Анализ завершён.', { reply_markup: backKeyboard() });

    } catch (error) {
      console.error('[Smeta] Ошибка обработки:', error.message);
      await ctx.reply(
        '❌ Ошибка при обработке сметы.\n' +
        'Убедитесь, что файл содержит корректные данные, и попробуйте снова.',
        { reply_markup: backKeyboard() }
      );
    } finally {
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    }
    return;
  }

  // ── Текстовое сообщение ─────────────────────────────────────
  if (ctx.message?.text) {
    if (ctx.message.text.startsWith('/')) return; // команды в parallax.js
    await ctx.reply(
      'Отправьте PDF-файл сметы, чтобы начать анализ.',
      { reply_markup: backKeyboard() }
    );
  }
}

// ══════════════════════════════════════════════════════════════
// ЭКСПОРТ
// ══════════════════════════════════════════════════════════════

module.exports = { onEnter, handleUpdate };
