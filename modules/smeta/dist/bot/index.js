"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = void 0;
const telegraf_1 = require("telegraf");
const filters_1 = require("telegraf/filters");
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
const gemini_1 = require("../services/gemini");
const calculator_1 = require("../services/calculator");
const formatter_1 = require("../utils/formatter");
const https = __importStar(require("https"));
exports.bot = new telegraf_1.Telegraf(env_1.env.TELEGRAM_BOT_TOKEN);
function downloadFile(url) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const req = https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
    });
}
exports.bot.catch((err, ctx) => {
    logger_1.logger.error({ context: 'TelegramBot', message: `Unhandled error for ${ctx.updateType}`, stack: err instanceof Error ? err.stack : undefined });
});
exports.bot.command('start', (ctx) => {
    logger_1.logger.info({ context: 'TelegramBot', message: '/start command received', userId: ctx.from.id });
    return ctx.reply('Привет! Отправь мне PDF-смету натяжных потолков, и я рассчитаю необходимое количество материалов и финансы.');
});
exports.bot.on((0, filters_1.message)('document'), async (ctx) => {
    const document = ctx.message.document;
    const fileName = document.file_name || 'unknown.pdf';
    if (!fileName.toLowerCase().endsWith('.pdf')) {
        logger_1.logger.warn({ context: 'TelegramBot', message: 'Rejected non-PDF file', fileName });
        return ctx.reply('Пожалуйста, отправьте файл в формате PDF.');
    }
    logger_1.logger.info({ context: 'TelegramBot', message: 'Received PDF document', fileName, fileSize: document.file_size });
    const statusMessage = await ctx.reply('⏳ Загружаю и анализирую смету... (может занять около 30 сек)');
    try {
        const fileUrl = await ctx.telegram.getFileLink(document.file_id);
        logger_1.logger.debug({ context: 'TelegramBot', message: 'Downloading file', url: fileUrl.href });
        const fileBuffer = await downloadFile(fileUrl.href);
        const parsedData = await (0, gemini_1.parsePdfWithGemini)(fileBuffer, fileName);
        const calculatedMaterials = await (0, calculator_1.calculateMaterials)(parsedData);
        const materialsMessage = (0, formatter_1.formatMaterialList)(parsedData.projectName || 'Без названия', calculatedMaterials);
        const financialMessage = (0, formatter_1.formatFinancialStatement)(calculatedMaterials);
        await ctx.reply(materialsMessage, { parse_mode: 'HTML' });
        await ctx.reply(financialMessage, { parse_mode: 'HTML' });
    }
    catch (error) {
        logger_1.logger.error({ context: 'TelegramBot', message: 'Error processing document', stack: error instanceof Error ? error.stack : undefined });
        await ctx.reply('❌ Произошла ошибка при обработке сметы. Убедитесь, что файл содержит корректные данные, или попробуйте позже.');
    }
    finally {
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id).catch(() => { });
    }
});
