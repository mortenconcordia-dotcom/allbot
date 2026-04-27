import { States } from '../../states.js';
import { goTo, goRoot } from '../../core/navigation.js';
import { backKeyboard } from '../../keyboards/common.js';
import { accountantMenuKeyboard } from '../../keyboards/accountant.js';

export function registerAccPurchasesHandlers(bot) {
  // ── Создать закупку ───────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_MENU) return next();
    if (ctx.message.text !== '🛒 Создать закупку') return next();

    goTo(ctx.session.botState, States.ACC_PURCHASE_TITLE);
    await ctx.reply('🛒 <b>Новая закупка</b>\n\nВведите название закупки:', {
      parse_mode: 'HTML', reply_markup: backKeyboard(),
    });
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_PURCHASE_TITLE) return next();
    if (ctx.message.text === '◀️ Назад' || ctx.message.text === '◀️ Главное меню') return next();
    const title = ctx.message.text.trim();
    if (title.length < 2) return ctx.reply('⚠️ Название слишком короткое:');

    goTo(ctx.session.botState, States.ACC_PURCHASE_ITEMS, { purchaseTitle: title });
    await ctx.reply(
      `📦 Закупка: <b>${title}</b>\n\nВведите список купленных позиций\n<i>(каждая с новой строки или через запятую)</i>:`,
      { parse_mode: 'HTML', reply_markup: backKeyboard() }
    );
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_PURCHASE_ITEMS) return next();
    if (ctx.message.text === '◀️ Назад' || ctx.message.text === '◀️ Главное меню') return next();
    const itemsText = ctx.message.text.trim();
    if (itemsText.length < 2) return ctx.reply('⚠️ Список позиций пустой. Введите что было куплено:');

    goTo(ctx.session.botState, States.ACC_PURCHASE_AMOUNT, { purchaseItems: itemsText });
    await ctx.reply('💰 Введите итоговую сумму закупки (₽):', { reply_markup: backKeyboard() });
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_PURCHASE_AMOUNT) return next();
    if (ctx.message.text === '◀️ Назад' || ctx.message.text === '◀️ Главное меню') return next();

    const raw    = ctx.message.text.trim().replace(',', '.').replace(/\s/g, '');
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount <= 0) return ctx.reply('⚠️ Введите корректную сумму (положительное число):');

    const title     = ctx.session.botState.purchaseTitle;
    const itemsText = ctx.session.botState.purchaseItems;

    ctx.db.prepare('INSERT INTO purchases (created_by, title, items_text, total_amount) VALUES (?, ?, ?, ?)')
      .run(ctx.user.id, title, itemsText, amount);

    goRoot(ctx.session.botState, States.ACC_MENU);
    const preview = itemsText.length > 200 ? itemsText.slice(0, 200) + '...' : itemsText;
    await ctx.reply(
      `✅ <b>Закупка сохранена!</b>\n\n📦 <b>${title}</b>\nПозиции: ${preview}\n💰 Сумма: <b>${amount.toLocaleString('ru')} ₽</b>`,
      { parse_mode: 'HTML', reply_markup: accountantMenuKeyboard() }
    );
  });

  // ── Список закупок ────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_MENU) return next();
    if (ctx.message.text !== '📦 Список закупок') return next();

    const purchases = ctx.db.prepare('SELECT * FROM purchases ORDER BY created_at DESC LIMIT 50').all();
    if (!purchases.length) return ctx.reply('📦 Закупок пока нет.');

    const lines = ['📦 <b>Список закупок:</b>\n'];
    for (const p of purchases) {
      const dt      = new Date(p.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const preview = p.items_text.length > 80 ? p.items_text.slice(0, 80) + '...' : p.items_text;
      lines.push(`🔸 <b>${p.title}</b>\n   📋 ${preview}\n   💰 ${p.total_amount.toLocaleString('ru')} ₽ · 📅 ${dt}\n`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });
}
