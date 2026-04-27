import { States } from '../states.js';
import { goBack } from '../core/navigation.js';
import { accountantMenuKeyboard } from '../keyboards/accountant.js';
import { employeeMenuKeyboard } from '../keyboards/employee.js';
import { adminMenuKeyboard } from '../keyboards/admin.js';

const STATE_MENU_MAP = {
  [States.ACC_MENU]:   ['📋 Панель бухгалтера:',     accountantMenuKeyboard],
  [States.ADMIN_MENU]: ['🔐 Панель администратора:', adminMenuKeyboard],
  // EMP_MENU handled separately (dynamic keyboard)
};

async function sendMenuForState(ctx, stateName) {
  if (stateName === States.EMP_MENU) {
    const userId = ctx.user?.id;
    const hasInst = userId
      ? ctx.db.prepare("SELECT 1 FROM installments WHERE user_id = ? AND status = 'active' LIMIT 1").get(userId) !== undefined
      : false;
    await ctx.reply('📋 Панель сотрудника:', { reply_markup: employeeMenuKeyboard(hasInst) });
    return;
  }

  const entry = STATE_MENU_MAP[stateName];
  if (entry) {
    const [text, kbFn] = entry;
    await ctx.reply(text, { reply_markup: kbFn() });
  } else {
    await ctx.reply('◀️ Возврат...');
  }
}

async function defaultBack(ctx) {
  const prev    = goBack(ctx.session.botState);
  const current = ctx.session.botState.state;

  if (!prev || !current) {
    const user = ctx.user;
    if (user?.active_role === 'accountant') {
      ctx.session.botState.state = States.ACC_MENU;
      await ctx.reply('📋 Панель бухгалтера:', { reply_markup: accountantMenuKeyboard() });
    } else if (user?.active_role === 'employee') {
      const hasInst = ctx.db.prepare("SELECT 1 FROM installments WHERE user_id = ? AND status = 'active' LIMIT 1").get(user.id) !== undefined;
      ctx.session.botState.state = States.EMP_MENU;
      await ctx.reply('📋 Панель сотрудника:', { reply_markup: employeeMenuKeyboard(hasInst) });
    } else {
      await ctx.reply('Введите /start для начала работы');
    }
    return;
  }

  await sendMenuForState(ctx, current);
}

export function registerBackHandlers(bot) {
  // Бухгалтер отменяет ожидающую выплату
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.botState.state !== States.ACC_PAY_AWAITING_CONFIRM) return next();
    if (ctx.message.text !== '🚫 Отменить выплату') return next();

    const paymentId     = ctx.session.botState.pendingPaymentId;
    const employeeTgId  = ctx.session.botState.pendingEmployeeTgId;
    const confMsgId     = ctx.session.botState.pendingConfirmationMessageId;

    if (paymentId) {
      const payment = ctx.db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
      if (payment && payment.status === 'pending') {
        ctx.db.prepare("UPDATE payments SET status = 'rejected' WHERE id = ?").run(paymentId);

        if (employeeTgId && confMsgId) {
          try {
            await ctx.api.editMessageReplyMarkup(employeeTgId, confMsgId);
            await ctx.api.sendMessage(employeeTgId, '❌ Бухгалтер отменил запрос на подтверждение выплаты.');
          } catch (e) {
            console.warn('[Back] Не удалось убрать кнопки у сотрудника:', e.message);
          }
        }
      }
    }

    ctx.session.botState.state = States.ACC_MENU;
    await ctx.reply('❌ Выплата отменена.', { reply_markup: accountantMenuKeyboard() });
  });

  // Reply-кнопка «Назад»
  bot.on('message:text', async (ctx, next) => {
    if (ctx.message.text !== '◀️ Назад') return next();
    await defaultBack(ctx);
  });

  // Inline callback «back»
  bot.callbackQuery('back', async (ctx) => {
    await ctx.answerCallbackQuery();
    await defaultBack(ctx);
  });
}
