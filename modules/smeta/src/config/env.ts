import 'dotenv/config';

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  GEMINI_API_KEY: string;
  GEMINI_PROXY_URL: string;
  LOG_LEVEL: string;
}

function validateEnv(): Env {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const GEMINI_PROXY_URL = process.env.GEMINI_PROXY_URL || '';
  const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[Smeta] Warning: Missing TELEGRAM_BOT_TOKEN (not needed if running inside Parallax)');
  }

  if (!GEMINI_API_KEY) {
    console.warn('[Smeta] Warning: Missing GEMINI_API_KEY in environment variables. Smeta module will fail to parse PDFs.');
  }

  return {
    TELEGRAM_BOT_TOKEN: TELEGRAM_BOT_TOKEN || '',
    GEMINI_API_KEY: GEMINI_API_KEY || '',
    GEMINI_PROXY_URL,
    LOG_LEVEL,
  };
}

export const env = validateEnv();
