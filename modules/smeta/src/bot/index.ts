import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { parsePdfWithGemini } from '../services/gemini';
import { calculateMaterials } from '../services/calculator';
import { formatMaterialList, formatFinancialStatement } from '../utils/formatter';
import * as https from 'https';

export const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

bot.catch((err, ctx) => {
  logger.error({ context: 'TelegramBot', message: `Unhandled error for ${ctx.updateType}`, stack: err instanceof Error ? err.stack : undefined });
});

bot.command('start', (ctx) => {
  logger.info({ context: 'TelegramBot', message: '/start command received', userId: ctx.from.id });
  return ctx.reply('Привет! Отправь мне PDF-смету натяжных потолков, и я рассчитаю необходимое количество материалов и финансы.');
});

bot.on(message('document'), async (ctx) => {
  const document = ctx.message.document;
  const fileName = document.file_name || 'unknown.pdf';

  if (!fileName.toLowerCase().endsWith('.pdf')) {
    logger.warn({ context: 'TelegramBot', message: 'Rejected non-PDF file', fileName });
    return ctx.reply('Пожалуйста, отправьте файл в формате PDF.');
  }

  logger.info({ context: 'TelegramBot', message: 'Received PDF document', fileName, fileSize: document.file_size });
  const statusMessage = await ctx.reply('⏳ Загружаю и анализирую смету... (может занять около 30 сек)');

  try {
    const fileUrl = await ctx.telegram.getFileLink(document.file_id);
    logger.debug({ context: 'TelegramBot', message: 'Downloading file', url: fileUrl.href });

    const fileBuffer = await downloadFile(fileUrl.href);

    const parsedData = await parsePdfWithGemini(fileBuffer, fileName);
    const calculatedMaterials = await calculateMaterials(parsedData);
    const materialsMessage = formatMaterialList(parsedData.projectName || 'Без названия', calculatedMaterials);
    const financialMessage = formatFinancialStatement(calculatedMaterials);

    await ctx.reply(materialsMessage, { parse_mode: 'HTML' });
    await ctx.reply(financialMessage, { parse_mode: 'HTML' });

  } catch (error) {
    logger.error({ context: 'TelegramBot', message: 'Error processing document', stack: error instanceof Error ? error.stack : undefined });
    await ctx.reply('❌ Произошла ошибка при обработке сметы. Убедитесь, что файл содержит корректные данные, или попробуйте позже.');
  } finally {
    await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id).catch(() => {});
  }
});
