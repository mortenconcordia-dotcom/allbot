import { GoogleGenAI, Type, Schema } from '@google/genai';
import { env } from '../config/env';
import { IGeminiParsedData } from '../types';
import { logger } from '../utils/logger';

// Using Gemini Developer API SDK (Google GenAI)
// NOTE: Client is created inside the function to ensure env vars are read at call time

const SYSTEM_PROMPT = `Ты — эксперт-сметчик и парсер данных. Твоя задача — извлечь точные численные значения из предоставленного документа по натяжным потолкам.
ВАЖНОЕ ПРАВИЛО ПАРСИНГА: В исходном документе названия профилей и систем (EUROKRAAB, LumFer Volat, LumFer PDK60, LumFer BP03, Flexy Shtorka и другие) могут быть разорваны символами переноса строки (\\n). Тебе запрещено игнорировать такие позиции. Ты обязан логически склеивать текст, игнорируя переносы строк внутри названия, и обязательно извлекать все профили в итоговый ответ.
Не производи никаких вычислений материалов, только находи сырые данные. Верни ответ строго в формате JSON без markdown-разметки.
Найди: итоговую стоимость сметы со скидкой, общий периметр всех помещений, общую длину всех треков, общее количество встроенных круглых/квадратных светильников, люстр, подвесных светильников, вентиляционных решеток (укажи, есть ли в названии слово "вентилятор" или "движок"), и метраж светодиодной ленты. Укажи также имя клиента или название проекта (если нет - просто 'Без названия').`;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    projectName: {
      type: Type.STRING,
      description: 'Имя клиента или название проекта',
    },
    totalEstimatePrice: {
      type: Type.NUMBER,
      description: 'Итоговая стоимость сметы со скидкой',
    },
    totalPerimeter: {
      type: Type.NUMBER,
      description: 'Общий периметр всех помещений в метрах',
    },
    profileTypes: {
      type: Type.ARRAY,
      description: 'Виды профилей и их метраж',
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, description: 'Название профиля' },
          length: { type: Type.NUMBER, description: 'Метраж профиля' },
        },
      },
    },
    trackLength: {
      type: Type.NUMBER,
      description: 'Общая длина всех треков (световых линий)',
    },
    lightingPoints: {
      type: Type.OBJECT,
      properties: {
        roundSquareBuiltIn: { type: Type.NUMBER, description: 'Общее количество встроенных круглых/квадратных светильников' },
        chandeliers: { type: Type.NUMBER, description: 'Общее количество люстр' },
        pendantLights: { type: Type.NUMBER, description: 'Общее количество подвесных светильников' },
      },
    },
    ventilationGrilles: {
      type: Type.OBJECT,
      properties: {
        count: { type: Type.NUMBER, description: 'Общее количество вентиляционных решеток' },
        hasEngine: { type: Type.BOOLEAN, description: 'Есть ли в названии слово вентилятор или движок' },
      },
    },
    ledStripLength: {
      type: Type.NUMBER,
      description: 'Метраж светодиодной ленты',
    },
  },
};

export async function parsePdfWithGemini(fileBuffer: Buffer, fileName: string): Promise<IGeminiParsedData> {
  // Читаем ключ и прокси в момент вызова, а не при инициализации модуля
  const apiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || '';
  const proxyUrl = process.env.GEMINI_PROXY_URL || env.GEMINI_PROXY_URL || '';

  logger.info({ context: 'GeminiService', message: `Starting PDF parsing with Gemini (inline mode), key present: ${!!apiKey}, proxy: ${proxyUrl ? 'enabled' : 'disabled'}`, fileName });

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }

  // Если задан прокси — все запросы идут через него (обход гео-блокировки)
  const ai = new GoogleGenAI({
    apiKey,
    ...(proxyUrl ? { httpOptions: { baseUrl: proxyUrl } } : {}),
  });

  try {
    // Используем инлайн Base64 вместо Files API — работает из любого региона
    const base64Data = fileBuffer.toString('base64');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Data,
          },
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    if (!response.text) {
      throw new Error('Gemini returned empty response body');
    }

    const jsonParsed = JSON.parse(response.text) as IGeminiParsedData;
    logger.info({ context: 'GeminiService', message: 'Successfully parsed PDF', jsonParsed });

    return jsonParsed;

  } catch (error) {
    logger.error({ context: 'GeminiService', message: 'Gemini parsing error', stack: error instanceof Error ? error.stack : undefined });
    throw error;
  }
}
