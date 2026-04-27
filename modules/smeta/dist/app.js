"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./bot/index");
const logger_1 = require("./utils/logger");
async function bootstrap() {
    try {
        logger_1.logger.info({ context: 'App', message: 'Starting Telegram Bot...' });
        process.once('SIGINT', () => {
            logger_1.logger.info({ context: 'App', message: 'Received SIGINT, stopping bot' });
            index_1.bot.stop('SIGINT');
        });
        process.once('SIGTERM', () => {
            logger_1.logger.info({ context: 'App', message: 'Received SIGTERM, stopping bot' });
            index_1.bot.stop('SIGTERM');
        });
        await index_1.bot.launch();
        logger_1.logger.info({ context: 'App', message: 'Bot successfully launched!' });
    }
    catch (error) {
        logger_1.logger.error({ context: 'App', message: 'Failed to launch bot', stack: error instanceof Error ? error.stack : undefined });
        process.exit(1);
    }
}
bootstrap();
