'use strict';

const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');
const { InlineKeyboard, Keyboard } = require('grammy');

const db = require('./db.js');

const ADMIN_PIN_CODE = '113337';
const REMINDER_SETTING_KEY = 'supplier_reminder_mode';
const REMINDER_MODE_2H    = '2h';
const REMINDER_MODE_DAILY = 'daily';
const REMINDER_MODE_OFF   = 'off';

const STATE = {
  NONE: null,
  PICK_SUPPLIER: 'PICK_SUPPLIER', SITE_ADDRESS: 'SITE_ADDRESS',
  CONTACT_PERSON: 'CONTACT_PERSON', ITEMS: 'ITEMS', COMMENT: 'COMMENT', CONFIRM: 'CONFIRM',
  SHIP_CAR_INPUT: 'SHIP_CAR_INPUT', ONROUTE_ETA_INPUT: 'ONROUTE_ETA_INPUT',
  REQ_Q_INPUT: 'REQ_Q_INPUT', REQ_ANSWER_INPUT: 'REQ_ANSWER_INPUT',
  ADD_Q_INPUT: 'ADD_Q_INPUT', ADD_ANSWER_INPUT: 'ADD_ANSWER_INPUT',
  UNDL_INPUT: 'UNDL_INPUT', ADD_ITEMS_INPUT: 'ADD_ITEMS_INPUT',
  ADMIN_PIN: 'ADMIN_PIN', ADMIN_ADD_CHATID: 'ADMIN_ADD_CHATID',
  ADMIN_ADD_NAME: 'ADMIN_ADD_NAME', ADMIN_ADD_ROLE: 'ADMIN_ADD_ROLE',
  ADMIN_DEL_CHATID: 'ADMIN_DEL_CHATID', ADMIN_SET_ROLE_CHATID: 'ADMIN_SET_ROLE_CHATID',
  ADMIN_SET_ROLE_PICK: 'ADMIN_SET_ROLE_PICK', ADMIN_EDIT_REQ_ID: 'ADMIN_EDIT_REQ_ID',
  ADMIN_EDIT_FIELD: 'ADMIN_EDIT_FIELD', ADMIN_EDIT_VALUE: 'ADMIN_EDIT_VALUE',
};

function s(ctx) {
  if (!ctx.session.botState) ctx.session.botState = {};
  return ctx.session.botState;
}
function clearSession(ctx) { ctx.session.botState = {}; }

const MANAGER_KB = new Keyboard()
  .text('➕ Создать заявку').row().text('🟦 Активные заявки').row()
  .text('🔄 Сменить роль').row().text('◀️ Главное меню').resized();
const SUPPLIER_KB = new Keyboard()
  .text('🟦 Активные заявки').row().text('🔄 Сменить роль').row()
  .text('◀️ Главное меню').resized();
const ADMIN_KB = new Keyboard()
  .text('👁️ Просмотр заявок').row().text('✏️ Редактирование заявок').row()
  .text('🔔 Напомнить поставщику').row().text('👥 Участники').row()
  .text('➕ Добавить участника').text('🗑️ Удалить участника').row()
  .text('🛂 Редактировать роль').row().text('🔄 Сменить роль').row()
  .text('◀️ Главное меню').resized();

function menuForCtx(ctx) {
  const chatId = ctx.chat?.id || ctx.from?.id;
  const u = db.getUser(chatId);
  const role = u?.role || '';
  if (role === 'MANAGER') return MANAGER_KB;
  if (role === 'SUPPLIER') return SUPPLIER_KB;
  if (role === 'ADMIN') return ADMIN_KB;
  return new Keyboard().text('/start').resized();
}

function displayName(from) {
  const full = [from.first_name || '', from.last_name || ''].join(' ').trim();
  return full || from.username || 'unknown';
}
function userNameByChatId(chatId) {
  const u = db.getUser(chatId);
  return (u && u.name) ? String(u.name) : String(chatId);
}
const STATUS_MAP = {
  SENT: '📨 Ожидает', ACCEPTED: '✅ Принята', QUESTION: '❓ Уточнение',
  SHORTAGE: '⚠️ Недовоз', ASSEMBLING: '🔵 На сборке', DELAYED: '🟡 Задерживается',
  SHIPPED: '🚚 Отправлено', ON_ROUTE: '🚗 Выезжаю', CLOSED: '✅ Закрыта', REJECTED: '❌ Отказ',
};
function shortLine(req) {
  return `#${req.id} | ${String(req.site_address).slice(0, 40)} | ${STATUS_MAP[req.status] || req.status}`;
}
function buildRequestPreview(d) {
  return `🧾 *Заявка на доставку материалов*\n\n` +
    `📍 *Адрес/объект:* ${d.siteAddress || d.site_address}\n` +
    `👤 *Контакт:* ${d.contactPerson || d.contact_person}\n\n` +
    `📦 *Материалы:*\n${d.items}\n\n` +
    `💬 *Комментарий:* ${d.comment || '-'}\n`;
}
function requestActionKb(reqId) {
  return new InlineKeyboard()
    .text('✅ Принять', `req_accept:${reqId}`)
    .text('❓ Уточнить', `req_question:${reqId}`).row()
    .text('❌ Отказ', `req_reject:${reqId}`);
}
function additionActionKb(addId) {
  return new InlineKeyboard()
    .text('✅ Принял дополнение', `add_accept:${addId}`)
    .text('❓ Ещё вопрос', `add_question:${addId}`).row()
    .text('❌ Не могу выполнить', `add_reject:${addId}`);
}
function isAdmin(chatId) { const u = db.getUser(chatId); return !!(u && u.role === 'ADMIN'); }
function canSupplierUpdate(req, supplierChatId) {
  if (!req) return false;
  if (['REJECTED','CLOSED'].includes(req.status)) return false;
  const assigned = Number(req.supplier_chat_id || 0);
  return assigned === 0 || assigned === supplierChatId;
}

// ── CRON ──────────────────────────────────────────────────────
let _cronInitialized = false;
let scheduledJobs    = [];
let _api             = null;

function clearScheduledJobs() { scheduledJobs.forEach(j => j.stop()); scheduledJobs = []; }

async function supplierReminderTask() {
  if (!_api) return;
  for (const supId of db.listSupplierChatIds()) {
    try { await _api.sendMessage(supId, buildSupplierReminderText(supId, { manual: false }), { parse_mode: 'Markdown' }); }
    catch (e) { console.error(`[Delivery] Reminder failed ${supId}:`, e.message); }
  }
}
function scheduleSupplierReminders(mode) {
  clearScheduledJobs();
  if (mode === REMINDER_MODE_OFF) return;
  if (mode === REMINDER_MODE_2H)
    [8,10,12,14,16,18].forEach(h => scheduledJobs.push(cron.schedule(`0 ${h} * * 1-5`, supplierReminderTask, { timezone: 'Europe/Moscow' })));
  else if (mode === REMINDER_MODE_DAILY)
    scheduledJobs.push(cron.schedule('0 10 * * 1-5', supplierReminderTask, { timezone: 'Europe/Moscow' }));
}
function scheduleDbBackup() {
  cron.schedule('0 3 * * *', () => {
    try {
      const BACKUP_DIR = process.env.BACKUP_DIR || (fs.existsSync('/data') ? '/data/backups' : 'backups');
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const dst = path.join(BACKUP_DIR, `deliveries_${stamp}.db`);
      fs.copyFileSync(db.DB_PATH, dst);
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('deliveries_') && f.endsWith('.db'))
        .map(f => path.join(BACKUP_DIR, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      files.slice(30).forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
    } catch (e) { console.error('[Delivery] DB backup failed:', e.message); }
  }, { timezone: 'Europe/Moscow' });
}
function initCron() {
  if (_cronInitialized) return;
  _cronInitialized = true;
  db.initDb();
  scheduleSupplierReminders(db.getSetting(REMINDER_SETTING_KEY, REMINDER_MODE_OFF) || REMINDER_MODE_OFF);
  scheduleDbBackup();
}

function buildSupplierReminderText(supplierChatId, { manual = false } = {}) {
  const openReqs = db.listOpenDeliveriesForSupplier(supplierChatId, 20);
  const title = manual ? '🔔 *Ручное напоминание: проверь заявки на доставку*' : '⏰ *Авто-напоминание: проверь заявки на доставку*';
  if (openReqs.length) {
    const lines = openReqs.map(r => `• #${r.id} | ${String(r.site_address).slice(0, 40)} | ${r.status}`);
    return title + '\n\n' + lines.join('\n') + '\n\nОткрой: 🟦 Активные заявки';
  }
  return title + '\n\nОткрой: 🟦 Активные заявки';
}
function remindersKb(currentMode) {
  const mark = m => currentMode === m ? '✅ ' : '';
  return new InlineKeyboard()
    .text(`${mark(REMINDER_MODE_2H)}Каждые 2 часа (Пн–Пт 08–19 МСК)`, `rem_mode:${REMINDER_MODE_2H}`).row()
    .text(`${mark(REMINDER_MODE_DAILY)}1 раз в день (Пн–Пт 10:00 МСК)`, `rem_mode:${REMINDER_MODE_DAILY}`).row()
    .text(`${mark(REMINDER_MODE_OFF)}Отключить`, `rem_mode:${REMINDER_MODE_OFF}`).row()
    .text('📣 Отправить сейчас (вручную)', 'rem_now');
}

// ── ВХОД В МОДУЛЬ ─────────────────────────────────────────────
async function onEnter(ctx, _returnToMain) {
  initCron(); _api = ctx.api; clearSession(ctx);
  const chatId = ctx.chat?.id || ctx.from?.id;
  const user = db.getUser(chatId);
  if (!user) {
    const kb = new InlineKeyboard()
      .text('👷 Менеджер', 'reg_role:MANAGER').row()
      .text('🚚 Поставщик', 'reg_role:SUPPLIER').row()
      .text('🛡️ Admin', 'reg_role:ADMIN');
    await ctx.reply('🚚 *Ditry Express*\n\nПривет! Выбери роль для регистрации:', { parse_mode: 'Markdown', reply_markup: kb });
  } else {
    await ctx.reply('🚚 *Ditry Express*', { parse_mode: 'Markdown', reply_markup: menuForCtx(ctx) });
  }
}

// ── РОУТЕР ────────────────────────────────────────────────────
async function handleUpdate(ctx, returnToMain) {
  _api = ctx.api;
  if (ctx.message?.text === '◀️ Главное меню') { clearSession(ctx); await returnToMain(ctx); return; }
  if (ctx.callbackQuery) { await handleCallback(ctx, returnToMain); return; }
  if (ctx.message?.text) { await handleText(ctx, returnToMain); return; }
}

// ── CALLBACKS ─────────────────────────────────────────────────
async function handleCallback(ctx, returnToMain) {
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat?.id || ctx.from?.id;
  await ctx.answerCallbackQuery().catch(() => {});

  let m;

  // Регистрация
  if ((m = data.match(/^reg_role:(MANAGER|SUPPLIER)$/))) {
    db.upsertUser(chatId, m[1], displayName(ctx.from));
    await ctx.editMessageText(`✅ Роль: ${m[1]}`);
    await ctx.reply('Меню ⬇️', { reply_markup: m[1] === 'MANAGER' ? MANAGER_KB : SUPPLIER_KB }); return;
  }
  if (data === 'reg_role:ADMIN' || data === 'set_role:ADMIN') {
    const sess = s(ctx); sess.state = STATE.ADMIN_PIN; sess.adminPinIsReg = data.startsWith('reg_role');
    sess.adminPinName = displayName(ctx.from);
    await ctx.editMessageText('🛡️ Введите PIN-код администратора:',
      { reply_markup: new InlineKeyboard().text('⬅️ Назад', 'admin_pin_back') }); return;
  }
  if (data === 'admin_pin_back') {
    const sess = s(ctx); const isReg = sess.adminPinIsReg; clearSession(ctx);
    try { await ctx.editMessageText('↩️ Отменено.'); } catch (_) {}
    if (isReg) {
      const kb = new InlineKeyboard().text('👷 Менеджер','reg_role:MANAGER').row()
        .text('🚚 Поставщик','reg_role:SUPPLIER').row().text('🛡️ Admin','reg_role:ADMIN');
      await ctx.reply('Выбери роль:', { reply_markup: kb });
    } else { await ctx.reply('Ок.', { reply_markup: menuForCtx(ctx) }); }
    return;
  }
  if ((m = data.match(/^set_role:(MANAGER|SUPPLIER)$/))) {
    db.upsertUser(chatId, m[1], displayName(ctx.from));
    await ctx.editMessageText(`✅ Роль: ${m[1]}`);
    await ctx.reply('Меню ⬇️', { reply_markup: m[1] === 'MANAGER' ? MANAGER_KB : SUPPLIER_KB }); return;
  }

  // Выбор поставщика
  if ((m = data.match(/^pick_supplier:(\d+)$/))) {
    const sess = s(ctx); sess.supplierChatId = parseInt(m[1]); sess.state = STATE.SITE_ADDRESS;
    await ctx.editMessageText('Шаг 1/4: Введи адрес/объект доставки:'); return;
  }

  // Просмотр заявок
  if ((m = data.match(/^view_supplier:(\d+)$/))) { await showRequestSupplier(ctx, parseInt(m[1]), chatId); return; }
  if (data === 'back_supplier') {
    const items = db.listActiveForSupplier(chatId);
    if (!items.length) { await ctx.editMessageText('Активных заявок нет.'); return; }
    const kb = new InlineKeyboard();
    items.forEach((r,i) => kb.text(`${i+1}. ${shortLine(r)}`, `view_supplier:${r.id}`).row());
    await ctx.editMessageText('🟦 Активные заявки:', { reply_markup: kb }); return;
  }
  if ((m = data.match(/^view_user:(\d+)$/))) { await showRequestManager(ctx, parseInt(m[1]), chatId); return; }
  if (data === 'back_user') {
    const items = db.listActiveForUser(chatId);
    if (!items.length) { await ctx.editMessageText('Активных заявок нет.'); return; }
    const kb = new InlineKeyboard();
    items.forEach((r,i) => kb.text(`${i+1}. ${shortLine(r)}`, `view_user:${r.id}`).row());
    await ctx.editMessageText('🟦 Мои активные заявки:', { reply_markup: kb }); return;
  }

  // Принять заявку
  if ((m = data.match(/^req_accept:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req) { await ctx.editMessageText('Заявка не найдена.'); return; }
    if (Number(req.supplier_chat_id) === 0) { db.setRequestSupplier(reqId, chatId); req.supplier_chat_id = chatId; }
    if (Number(req.supplier_chat_id) !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    if (['ACCEPTED','ASSEMBLING','DELAYED','SHIPPED','ON_ROUTE','REJECTED','CLOSED'].includes(req.status))
      { await ctx.editMessageText(`Статус уже: ${req.status}.`); return; }
    db.setRequestStatus(reqId, 'ACCEPTED', null);
    await ctx.editMessageText(`✅ Заявка #${reqId} принята.`);
    await ctx.api.sendMessage(req.created_by_chat_id, `✅ Заявка *#${reqId}* принята поставщиком *${userNameByChatId(chatId)}*.`, { parse_mode: 'Markdown' }); return;
  }

  // Отказ
  if ((m = data.match(/^req_reject:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req) { await ctx.editMessageText('Заявка не найдена.'); return; }
    if (Number(req.supplier_chat_id) === 0) { db.setRequestSupplier(reqId, chatId); req.supplier_chat_id = chatId; }
    if (Number(req.supplier_chat_id) !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    try { await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }); } catch (_) {}
    const kb = new InlineKeyboard().text('✅ Подтвердить заказ', `req_accept:${reqId}`);
    const photoPath = path.join(__dirname, 'reject.jpeg');
    try { const { InputFile } = require('grammy'); await ctx.api.sendPhoto(chatId, new InputFile(photoPath), { reply_markup: kb }); }
    catch (_) { await ctx.api.sendMessage(chatId, 'Подтвердить:', { reply_markup: kb }); }
    return;
  }

  // Меню статусов
  if ((m = data.match(/^req_status:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req || !canSupplierUpdate(req, chatId)) { await ctx.editMessageText('Нет доступа.'); return; }
    const kb = new InlineKeyboard()
      .text('🔵 На сборке', `req_set_status:${reqId}:ASSEMBLING`).row()
      .text('🟡 Задерживается', `req_set_status:${reqId}:DELAYED`).row()
      .text('🚚 Отправлено доставкой', `req_ship:${reqId}`).row()
      .text('🚗 Выезжаю', `req_onroute:${reqId}`).row()
      .text('⬅️ Назад', `view_supplier:${reqId}`);
    await ctx.editMessageText(`Выбери статус для заявки #${reqId}:`, { reply_markup: kb }); return;
  }

  // Установить статус ASSEMBLING/DELAYED
  if ((m = data.match(/^req_set_status:(\d+):(ASSEMBLING|DELAYED)$/))) {
    const reqId = parseInt(m[1]); const statusCode = m[2]; const req = db.getRequest(reqId);
    if (!req || !canSupplierUpdate(req, chatId)) { await ctx.editMessageText('Нет доступа.'); return; }
    if (Number(req.supplier_chat_id || 0) === 0) db.setRequestSupplier(reqId, chatId);
    db.setRequestProgress(reqId, statusCode, { setByOhatId: chatId, setByName: userNameByChatId(chatId) });
    const pretty = { ASSEMBLING: '🔵 На сборке', DELAYED: '🟡 Задерживается' }[statusCode];
    await ctx.editMessageText(`✅ Статус #${reqId}: ${pretty}.`, { reply_markup: new InlineKeyboard().text('⬅️ К заявке', `view_supplier:${reqId}`) });
    await ctx.api.sendMessage(req.created_by_chat_id, `${pretty} — заявка *#${reqId}*. Поставщик: *${userNameByChatId(chatId)}*.`, { parse_mode: 'Markdown' }); return;
  }

  // SHIP FSM
  if ((m = data.match(/^req_ship:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req || !canSupplierUpdate(req, chatId)) { await ctx.editMessageText('Нет доступа.'); return; }
    if (Number(req.supplier_chat_id || 0) === 0) db.setRequestSupplier(reqId, chatId);
    const sess = s(ctx); sess.state = STATE.SHIP_CAR_INPUT; sess.shipReqId = reqId;
    await ctx.editMessageText(`🚚 Заявка #${reqId}: введи номер и марку авто.\nОтмена: /cancel`,
      { reply_markup: new InlineKeyboard().text('⬅️ Назад', `req_status:${reqId}`) }); return;
  }

  // ONROUTE FSM
  if ((m = data.match(/^req_onroute:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req || !canSupplierUpdate(req, chatId)) { await ctx.editMessageText('Нет доступа.'); return; }
    if (Number(req.supplier_chat_id || 0) === 0) db.setRequestSupplier(reqId, chatId);
    const sess = s(ctx); sess.state = STATE.ONROUTE_ETA_INPUT; sess.onrouteReqId = reqId;
    await ctx.editMessageText(`🚗 Заявка #${reqId}: введи время прибытия.\nОтмена: /cancel`,
      { reply_markup: new InlineKeyboard().text('⬅️ Назад', `req_status:${reqId}`) }); return;
  }

  // Уточнение поставщика
  if ((m = data.match(/^req_question:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req) { await ctx.editMessageText('Заявка не найдена.'); return; }
    if (Number(req.supplier_chat_id || 0) === 0) { db.setRequestSupplier(reqId, chatId); req.supplier_chat_id = chatId; }
    if (Number(req.supplier_chat_id) !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    const sess = s(ctx); sess.state = STATE.REQ_Q_INPUT; sess.reqQuestionId = reqId;
    await ctx.editMessageText(`Напиши уточнение по заявке #${reqId}.\nОтмена: /cancel`); return;
  }

  // Ответ менеджера на вопрос
  if ((m = data.match(/^user_answer_req:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req || req.created_by_chat_id !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    const sess = s(ctx); sess.state = STATE.REQ_ANSWER_INPUT; sess.answerReqId = reqId;
    await ctx.editMessageText(`❓ Вопрос: ${req.supplier_note || '(нет)'}\n\nНапиши ответ.\nОтмена: /cancel`); return;
  }

  // Менеджер: закрыть, недовоз, дополнение
  if ((m = data.match(/^user_close:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req || req.created_by_chat_id !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    db.markClosed(reqId);
    await ctx.editMessageText(`✅ Заявка *#${reqId}* закрыта.`, { parse_mode: 'Markdown' });
    if (Number(req.supplier_chat_id) !== 0)
      await ctx.api.sendMessage(req.supplier_chat_id, `✅ Заявка *#${reqId}* закрыта менеджером.`, { parse_mode: 'Markdown' }); return;
  }
  if ((m = data.match(/^user_shortage:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req || req.created_by_chat_id !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    const sess = s(ctx); sess.state = STATE.UNDL_INPUT; sess.undlReqId = reqId;
    await ctx.editMessageText('Напиши недовезённые материалы.\nОтмена: /cancel'); return;
  }
  if ((m = data.match(/^user_additems:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req || req.created_by_chat_id !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    if (req.status === 'CLOSED') { await ctx.editMessageText('Заявка закрыта.'); return; }
    const sess = s(ctx); sess.state = STATE.ADD_ITEMS_INPUT; sess.addReqId = reqId;
    await ctx.editMessageText('Напиши, что нужно добавить к заказу.\nОтмена: /cancel'); return;
  }
  if ((m = data.match(/^user_answer_add:(\d+)$/))) {
    const reqId = parseInt(m[1]); const req = db.getRequest(reqId);
    if (!req || req.created_by_chat_id !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    const adds = db.listAdditionsForRequest(reqId, 20).filter(a => a.status === 'QUESTION');
    if (!adds.length) { await ctx.editMessageText('Нет вопросов по дополнениям.'); return; }
    const kb = new InlineKeyboard();
    adds.forEach(a => kb.text(`Доп. №${a.id} — ❓ ${(a.supplier_note||'').slice(0,40)}`, `user_answer_add_pick:${a.id}`).row());
    kb.text('⬅️ Назад', `view_user:${reqId}`);
    await ctx.editMessageText('Выбери дополнение:', { reply_markup: kb }); return;
  }
  if ((m = data.match(/^user_answer_add_pick:(\d+)$/))) {
    const addId = parseInt(m[1]); const add = db.getAddition(addId);
    if (!add || add.created_by_chat_id !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    const sess = s(ctx); sess.state = STATE.ADD_ANSWER_INPUT; sess.answerAddId = addId;
    await ctx.editMessageText(`❓ Вопрос: ${add.supplier_note||'(нет)'}\n\nНапиши ответ.\nОтмена: /cancel`); return;
  }

  // Дополнения (поставщик)
  if ((m = data.match(/^add_accept:(\d+)$/))) {
    const addId = parseInt(m[1]); const add = db.getAddition(addId);
    if (!add || add.supplier_chat_id !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    if (['ACCEPTED','REJECTED'].includes(add.status)) { await ctx.editMessageText(`Статус уже: ${add.status}.`); return; }
    db.setAdditionStatus(addId, 'ACCEPTED', null);
    await ctx.editMessageText(`✅ Дополнение №${addId} принято.`);
    await ctx.api.sendMessage(add.created_by_chat_id, `✅ Поставщик *принял дополнение* №${addId} к заявке *#${add.request_id}*.`, { parse_mode: 'Markdown' }); return;
  }
  if ((m = data.match(/^add_reject:(\d+)$/))) {
    const addId = parseInt(m[1]); const add = db.getAddition(addId);
    if (!add || add.supplier_chat_id !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    if (['ACCEPTED','REJECTED'].includes(add.status)) { await ctx.editMessageText(`Статус уже: ${add.status}.`); return; }
    db.setAdditionStatus(addId, 'REJECTED', null);
    await ctx.editMessageText(`❌ Дополнение №${addId}: не могу выполнить.`);
    await ctx.api.sendMessage(add.created_by_chat_id, `❌ Поставщик *не может* выполнить доп. №${addId} к заявке *#${add.request_id}*.`, { parse_mode: 'Markdown' }); return;
  }
  if ((m = data.match(/^add_question:(\d+)$/))) {
    const addId = parseInt(m[1]); const add = db.getAddition(addId);
    if (!add || add.supplier_chat_id !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
    const sess = s(ctx); sess.state = STATE.ADD_Q_INPUT; sess.addQuestionId = addId;
    await ctx.editMessageText(`Напиши вопрос по доп. №${addId}.\nОтмена: /cancel`); return;
  }

  // Напоминания
  if ((m = data.match(/^rem_mode:(2h|daily|off)$/))) {
    if (!isAdmin(chatId)) { await ctx.editMessageText('Недостаточно прав.'); return; }
    const mode = m[1]; db.setSetting(REMINDER_SETTING_KEY, mode); scheduleSupplierReminders(mode);
    await ctx.editMessageText('✅ Сохранено.\n\nВыбери режим:', { reply_markup: remindersKb(mode) }); return;
  }
  if (data === 'rem_now') {
    if (!isAdmin(chatId)) { await ctx.editMessageText('Недостаточно прав.'); return; }
    const suppliers = db.listSuppliers();
    if (!suppliers.length) { await ctx.editMessageText('Поставщиков нет.', { reply_markup: remindersKb(db.getSetting(REMINDER_SETTING_KEY, REMINDER_MODE_OFF)||REMINDER_MODE_OFF) }); return; }
    const kb = new InlineKeyboard();
    suppliers.slice(0,40).forEach(sup => kb.text(`🚚 ${sup.name}`, `admin_remind_sup:${sup.chat_id}`).row());
    kb.text('⬅️ Назад', 'rem_back');
    await ctx.editMessageText('Выбери поставщика:', { reply_markup: kb }); return;
  }
  if (data === 'rem_back') {
    if (!isAdmin(chatId)) { await ctx.editMessageText('Недостаточно прав.'); return; }
    const mode = db.getSetting(REMINDER_SETTING_KEY, REMINDER_MODE_OFF)||REMINDER_MODE_OFF;
    await ctx.editMessageText('🔔 Управление напоминаниями:', { reply_markup: remindersKb(mode) }); return;
  }
  if ((m = data.match(/^admin_remind_sup:(\d+)$/))) {
    if (!isAdmin(chatId)) { await ctx.editMessageText('Недостаточно прав.'); return; }
    const supId = parseInt(m[1]);
    try { await ctx.api.sendMessage(supId, buildSupplierReminderText(supId, { manual: true }), { parse_mode: 'Markdown' }); await ctx.editMessageText('✅ Напоминание отправлено.'); }
    catch (e) { await ctx.editMessageText(`Ошибка: ${e.message}`); }
    return;
  }

  // Admin: управление ролями
  if ((m = data.match(/^admin_add_role:(MANAGER|SUPPLIER|ADMIN)$/))) {
    const role = m[1]; const sess = s(ctx);
    if (!sess.newUserChatId) { await ctx.editMessageText('Ошибка: нет chat_id.'); return; }
    db.upsertUser(sess.newUserChatId, role, sess.newUserName || ''); clearSession(ctx);
    await ctx.editMessageText(`✅ Добавлен: ${sess.newUserChatId} → ${role}`);
    await ctx.api.sendMessage(chatId, 'Меню ⬇️', { reply_markup: ADMIN_KB }); return;
  }
  if ((m = data.match(/^admin_set_role:(MANAGER|SUPPLIER|ADMIN)$/))) {
    const role = m[1]; const sess = s(ctx);
    if (!sess.targetRoleChatId) { await ctx.editMessageText('Ошибка: нет chat_id.'); return; }
    db.setUserRole(sess.targetRoleChatId, role); clearSession(ctx);
    await ctx.editMessageText(`✅ Роль: ${sess.targetRoleChatId} → ${role}`);
    await ctx.api.sendMessage(chatId, 'Меню ⬇️', { reply_markup: ADMIN_KB }); return;
  }
  if ((m = data.match(/^admin_edit_field:(\w+)$/))) {
    const sess = s(ctx); sess.editField = m[1]; sess.state = STATE.ADMIN_EDIT_VALUE;
    await ctx.editMessageText(`Введите новое значение для поля: ${m[1]}`); return;
  }

  // Подтверждение заявки
  if (data === 'confirm_cancel') { clearSession(ctx); await ctx.editMessageText('Отменено.'); return; }
  if (data === 'confirm_restart') {
    clearSession(ctx); const sess = s(ctx); const suppliers = db.listSuppliers();
    if (!suppliers.length) { sess.state = STATE.SITE_ADDRESS; sess.supplierChatId = 0; await ctx.editMessageText('Начнём заново.\nШаг 1/4: Введи адрес/объект:'); return; }
    sess.state = STATE.PICK_SUPPLIER;
    const kb = new InlineKeyboard();
    suppliers.slice(0,20).forEach(sup => kb.text(`🚚 ${sup.name}`, `pick_supplier:${sup.chat_id}`).row());
    kb.text('🚫 Без поставщика', 'pick_supplier:0');
    await ctx.editMessageText('Выбери поставщика:', { reply_markup: kb }); return;
  }
  if (data === 'confirm_send') {
    const sess = s(ctx); const supplierChatId = parseInt(sess.supplierChatId || 0);
    const createdByName = displayName(ctx.from);
    const reqId = db.createRequest({ createdByChatId: chatId, createdByName, supplierChatId,
      siteAddress: sess.siteAddress, deliveryDt: '', contactPerson: sess.contactPerson,
      contactPhone: '', items: sess.items, comment: sess.comment || '' });
    await ctx.editMessageText(`✅ Заявка *#${reqId}* создана.`, { parse_mode: 'Markdown' });
    if (supplierChatId !== 0)
      await ctx.api.sendMessage(supplierChatId,
        `📨 Новая заявка *#${reqId}*\n\n${buildRequestPreview(sess)}\nСоздатель: ${createdByName}\n\nВыбери статус:`,
        { parse_mode: 'Markdown', reply_markup: requestActionKb(reqId) });
    clearSession(ctx); return;
  }
}

// ── TEXT FSM ──────────────────────────────────────────────────
async function handleText(ctx, returnToMain) {
  const chatId = ctx.chat?.id || ctx.from?.id;
  const sess = s(ctx); const text = ctx.message.text.trim(); const state = sess.state;

  if (text === '/cancel') { clearSession(ctx); await ctx.reply('Отменено.', { reply_markup: menuForCtx(ctx) }); return; }

  // Кнопки меню
  if (text === '➕ Создать заявку') {
    const user = db.getUser(chatId);
    if (!user) { await ctx.reply('Сначала зарегистрируйся.'); return; }
    if (user.role !== 'MANAGER') { await ctx.reply('Только Менеджер может создавать заявки.', { reply_markup: SUPPLIER_KB }); return; }
    clearSession(ctx); const suppliers = db.listSuppliers();
    if (!suppliers.length) { sess.state = STATE.SITE_ADDRESS; sess.supplierChatId = 0; await ctx.reply('Поставщики не зарегистрированы.\nШаг 1/4: Введи адрес/объект:'); return; }
    sess.state = STATE.PICK_SUPPLIER;
    const kb = new InlineKeyboard();
    suppliers.slice(0,20).forEach(sup => kb.text(`🚚 ${sup.name}`, `pick_supplier:${sup.chat_id}`).row());
    kb.text('🚫 Без поставщика', 'pick_supplier:0');
    await ctx.reply('Выбери поставщика:', { reply_markup: kb }); return;
  }
  if (text === '🟦 Активные заявки') {
    const user = db.getUser(chatId);
    if (!user) { await ctx.reply('Сначала зарегистрируйся.'); return; }
    if (user.role === 'SUPPLIER') {
      const items = db.listActiveForSupplier(chatId);
      if (!items.length) { await ctx.reply('Активных заявок нет.', { reply_markup: SUPPLIER_KB }); return; }
      const kb = new InlineKeyboard();
      items.forEach((r,i) => kb.text(`${i+1}. ${shortLine(r)}`, `view_supplier:${r.id}`).row());
      await ctx.reply('🟦 Активные заявки:', { reply_markup: kb }); return;
    }
    const items = db.listActiveForUser(chatId);
    if (!items.length) { await ctx.reply('Активных заявок нет.', { reply_markup: MANAGER_KB }); return; }
    const kb = new InlineKeyboard();
    items.forEach((r,i) => kb.text(`${i+1}. ${shortLine(r)}`, `view_user:${r.id}`).row());
    await ctx.reply('🟦 Мои активные заявки:', { reply_markup: kb }); return;
  }
  if (text === '🔄 Сменить роль') {
    const kb = new InlineKeyboard().text('👷 Менеджер','set_role:MANAGER').row()
      .text('🚚 Поставщик','set_role:SUPPLIER').row().text('🛡️ Admin','set_role:ADMIN');
    await ctx.reply('Выбери новую роль:', { reply_markup: kb }); return;
  }
  if (text === '🔔 Напомнить поставщику') {
    if (!isAdmin(chatId)) { await ctx.reply('Недостаточно прав.'); return; }
    const mode = db.getSetting(REMINDER_SETTING_KEY, REMINDER_MODE_OFF)||REMINDER_MODE_OFF;
    await ctx.reply('🔔 Управление напоминаниями:', { reply_markup: remindersKb(mode) }); return;
  }
  if (text === '👁️ Просмотр заявок') {
    if (!isAdmin(chatId)) { await ctx.reply('Недостаточно прав.'); return; }
    const reqs = db.listAllRequests(); if (!reqs.length) { await ctx.reply('Заявок пока нет.'); return; }
    let msg = '📦 Все заявки:\n';
    reqs.forEach((r,i) => msg += `\n${i+1}. #ID${r.id} — ${r.status} — ${r.site_address||''}`);
    if (msg.length > 3800) msg = msg.slice(0, 3800) + '\n…';
    await ctx.reply(msg, { reply_markup: ADMIN_KB }); return;
  }
  if (text === '👥 Участники') {
    if (!isAdmin(chatId)) { await ctx.reply('Недостаточно прав.'); return; }
    const users = db.listUsers(); if (!users.length) { await ctx.reply('Нет пользователей.'); return; }
    let msg = '👥 Участники:';
    users.forEach((u,i) => msg += `\n${i+1}. ${u.chat_id} — ${u.role} — ${u.name||''}`);
    if (msg.length > 3800) msg = msg.slice(0, 3800) + '\n…';
    await ctx.reply(msg, { reply_markup: ADMIN_KB }); return;
  }
  if (text === '➕ Добавить участника') { if (!isAdmin(chatId)) return; sess.state = STATE.ADMIN_ADD_CHATID; await ctx.reply('Введите chat_id нового участника:'); return; }
  if (text === '🗑️ Удалить участника') { if (!isAdmin(chatId)) return; sess.state = STATE.ADMIN_DEL_CHATID; await ctx.reply('Введите chat_id для удаления:'); return; }
  if (text === '🛂 Редактировать роль') { if (!isAdmin(chatId)) return; sess.state = STATE.ADMIN_SET_ROLE_CHATID; await ctx.reply('Введите chat_id участника:'); return; }
  if (text === '✏️ Редактирование заявок') { if (!isAdmin(chatId)) return; sess.state = STATE.ADMIN_EDIT_REQ_ID; await ctx.reply('Введите ID заявки:'); return; }

  if (!state) return;

  // FSM
  if (state === STATE.ADMIN_PIN) {
    if (text !== ADMIN_PIN_CODE) { await ctx.reply('❌ Неверный PIN.', { reply_markup: new InlineKeyboard().text('⬅️ Назад','admin_pin_back') }); return; }
    db.upsertUser(chatId, 'ADMIN', sess.adminPinName || displayName(ctx.from)); clearSession(ctx);
    await ctx.reply('✅ Доступ разрешён.', { reply_markup: ADMIN_KB }); return;
  }
  if (state === STATE.SITE_ADDRESS) { sess.siteAddress = text; sess.state = STATE.CONTACT_PERSON; await ctx.reply('Шаг 2/4: Контактное лицо:'); return; }
  if (state === STATE.CONTACT_PERSON) { sess.contactPerson = text; sess.state = STATE.ITEMS; await ctx.reply('Шаг 3/4: Материалы списком:'); return; }
  if (state === STATE.ITEMS) { sess.items = text; sess.state = STATE.COMMENT; await ctx.reply('Шаг 4/4: Комментарий (или "-"):'); return; }
  if (state === STATE.COMMENT) {
    sess.comment = text === '-' ? '' : text; sess.state = STATE.CONFIRM;
    const kb = new InlineKeyboard().text('✅ Подтвердить','confirm_send').row().text('✏️ Исправить','confirm_restart').row().text('❌ Отмена','confirm_cancel');
    await ctx.reply(buildRequestPreview(sess), { parse_mode: 'Markdown', reply_markup: kb }); return;
  }
  if (state === STATE.SHIP_CAR_INPUT) {
    const reqId = sess.shipReqId; const req = db.getRequest(reqId);
    if (!req) { clearSession(ctx); await ctx.reply('Заявка не найдена.'); return; }
    if (Number(req.supplier_chat_id||0) === 0) db.setRequestSupplier(reqId, chatId);
    db.setRequestProgress(reqId, 'SHIPPED', { setByOhatId: chatId, setByName: userNameByChatId(chatId), deliveryCarInfo: text });
    clearSession(ctx);
    await ctx.reply(`✅ Статус #${reqId}: 🚚 Отправлено.`, { reply_markup: SUPPLIER_KB });
    await ctx.api.sendMessage(req.created_by_chat_id, `🚚 К вам выехала доставка по заявке *#${reqId}*. Авто: *${text}*`, { parse_mode: 'Markdown' }); return;
  }
  if (state === STATE.ONROUTE_ETA_INPUT) {
    const reqId = sess.onrouteReqId; const req = db.getRequest(reqId);
    if (!req) { clearSession(ctx); await ctx.reply('Заявка не найдена.'); return; }
    if (Number(req.supplier_chat_id||0) === 0) db.setRequestSupplier(reqId, chatId);
    db.setRequestProgress(reqId, 'ON_ROUTE', { setByOhatId: chatId, setByName: userNameByChatId(chatId), deliveryEta: text });
    clearSession(ctx);
    await ctx.reply(`✅ Статус #${reqId}: 🚗 Выезжаю.`, { reply_markup: SUPPLIER_KB });
    await ctx.api.sendMessage(req.created_by_chat_id, `🚗 Выезжаю по заявке *#${reqId}*. Время прибытия: *${text}*`, { parse_mode: 'Markdown' }); return;
  }
  if (state === STATE.REQ_Q_INPUT) {
    const reqId = sess.reqQuestionId; const req = db.getRequest(reqId);
    if (!req) { clearSession(ctx); return; }
    db.setRequestStatus(reqId, 'QUESTION', text); clearSession(ctx);
    await ctx.reply(`❓ Уточнение по заявке #${reqId} отправлено.`, { reply_markup: SUPPLIER_KB });
    await ctx.api.sendMessage(req.created_by_chat_id, `❓ Поставщик уточняет по заявке #${reqId}:\n\n${text}`,
      { reply_markup: new InlineKeyboard().text('❓ Ответить', `user_answer_req:${reqId}`) }); return;
  }
  if (state === STATE.REQ_ANSWER_INPUT) {
    const reqId = sess.answerReqId; const req = db.getRequest(reqId);
    if (!req) { clearSession(ctx); return; }
    clearSession(ctx);
    await ctx.reply('Ответ отправлен поставщику.', { reply_markup: MANAGER_KB });
    await ctx.api.sendMessage(req.supplier_chat_id,
      `💬 Ответ менеджера по заявке *#${reqId}*:\n\n${text}\n\nПодтвердите заявку:`,
      { parse_mode: 'Markdown', reply_markup: requestActionKb(reqId) }); return;
  }
  if (state === STATE.UNDL_INPUT) {
    const reqId = sess.undlReqId; const req = db.getRequest(reqId);
    if (!req) { clearSession(ctx); return; }
    db.setUndelivered(reqId, text); clearSession(ctx);
    await ctx.reply(`⚠️ Недовоз по заявке #${reqId} сохранён.`, { reply_markup: MANAGER_KB });
    if (Number(req.supplier_chat_id) !== 0)
      await ctx.api.sendMessage(req.supplier_chat_id, `⚠️ Недовоз по заявке *#${reqId}*:\n${text}`, { parse_mode: 'Markdown' }); return;
  }
  if (state === STATE.ADD_ITEMS_INPUT) {
    const reqId = sess.addReqId; const req = db.getRequest(reqId);
    if (!req || req.status === 'CLOSED') { clearSession(ctx); return; }
    db.appendItems(reqId, text);
    const addId = db.createAddition({ requestId: reqId, createdByChatId: chatId, supplierChatId: req.supplier_chat_id, text });
    clearSession(ctx);
    await ctx.reply(`➕ Дополнение №${addId} к заявке #${reqId} отправлено.`, { reply_markup: MANAGER_KB });
    if (Number(req.supplier_chat_id) !== 0)
      await ctx.api.sendMessage(req.supplier_chat_id,
        `➕ *Дополнение №${addId}* к заявке *#${reqId}*:\n${text}`,
        { parse_mode: 'Markdown', reply_markup: additionActionKb(addId) }); return;
  }
  if (state === STATE.ADD_Q_INPUT) {
    const addId = sess.addQuestionId; const add = db.getAddition(addId);
    if (!add) { clearSession(ctx); return; }
    db.setAdditionStatus(addId, 'QUESTION', text); clearSession(ctx);
    await ctx.reply(`❓ Вопрос по доп. №${addId} отправлен.`, { reply_markup: SUPPLIER_KB });
    await ctx.api.sendMessage(add.created_by_chat_id,
      `❓ Вопрос по *доп. №${addId}* (заявка *#${add.request_id}*):\n${text}`, { parse_mode: 'Markdown' }); return;
  }
  if (state === STATE.ADD_ANSWER_INPUT) {
    const addId = sess.answerAddId; const add = db.getAddition(addId);
    if (!add) { clearSession(ctx); return; }
    clearSession(ctx);
    await ctx.reply('Ответ отправлен.', { reply_markup: MANAGER_KB });
    await ctx.api.sendMessage(add.supplier_chat_id,
      `💬 Ответ по *доп. №${addId}*:\n${text}`,
      { parse_mode: 'Markdown', reply_markup: additionActionKb(addId) }); return;
  }
  if (state === STATE.ADMIN_ADD_CHATID) {
    if (!/^\d+$/.test(text)) { await ctx.reply('Нужно число:'); return; }
    sess.newUserChatId = parseInt(text); sess.state = STATE.ADMIN_ADD_NAME; await ctx.reply('Введите имя участника:'); return;
  }
  if (state === STATE.ADMIN_ADD_NAME) {
    sess.newUserName = text; sess.state = STATE.ADMIN_ADD_ROLE;
    const kb = new InlineKeyboard().text('👷 MANAGER','admin_add_role:MANAGER').row()
      .text('🚚 SUPPLIER','admin_add_role:SUPPLIER').row().text('🛡️ ADMIN','admin_add_role:ADMIN');
    await ctx.reply('Выбери роль:', { reply_markup: kb }); return;
  }
  if (state === STATE.ADMIN_DEL_CHATID) {
    if (!/^\d+$/.test(text)) { await ctx.reply('Нужно число:'); return; }
    db.deleteUser(parseInt(text)); clearSession(ctx);
    await ctx.reply(`✅ Участник ${text} удалён.`, { reply_markup: ADMIN_KB }); return;
  }
  if (state === STATE.ADMIN_SET_ROLE_CHATID) {
    if (!/^\d+$/.test(text)) { await ctx.reply('Нужно число:'); return; }
    sess.targetRoleChatId = parseInt(text); sess.state = STATE.ADMIN_SET_ROLE_PICK;
    const kb = new InlineKeyboard().text('👷 MANAGER','admin_set_role:MANAGER').row()
      .text('🚚 SUPPLIER','admin_set_role:SUPPLIER').row().text('🛡️ ADMIN','admin_set_role:ADMIN');
    await ctx.reply('Выбери роль:', { reply_markup: kb }); return;
  }
  if (state === STATE.ADMIN_EDIT_REQ_ID) {
    if (!/^\d+$/.test(text)) { await ctx.reply('Нужно число:'); return; }
    const rid = parseInt(text); const r = db.getRequest(rid);
    if (!r) { await ctx.reply('Заявка не найдена:'); return; }
    sess.editRequestId = rid; sess.state = STATE.ADMIN_EDIT_FIELD;
    const FIELDS = [['status','Статус'],['supplier_chat_id','Поставщик chat_id'],['site_address','Адрес'],
      ['delivery_dt','Дата'],['contact_person','Контакт'],['contact_phone','Телефон'],['items','Материалы'],['comment','Комментарий']];
    const kb = new InlineKeyboard();
    FIELDS.forEach(([fld,lbl]) => kb.text(lbl, `admin_edit_field:${fld}`).row());
    await ctx.reply(`Поле для редактирования (заявка #${rid}):`, { reply_markup: kb }); return;
  }
  if (state === STATE.ADMIN_EDIT_VALUE) {
    const rid = sess.editRequestId; const fld = sess.editField;
    if (!rid || !fld) { clearSession(ctx); await ctx.reply('Ошибка контекста.', { reply_markup: ADMIN_KB }); return; }
    let val = text;
    if (fld === 'supplier_chat_id') { if (!/^\d+$/.test(val)) { await ctx.reply('Нужно число:'); return; } val = parseInt(val); }
    try { db.updateRequestField(rid, fld, val); } catch (e) { await ctx.reply(`Ошибка: ${e.message}`); return; }
    clearSession(ctx); await ctx.reply(`✅ Заявка #${rid} обновлена.`, { reply_markup: ADMIN_KB }); return;
  }
}

// ── ОТОБРАЖЕНИЕ ЗАЯВОК ────────────────────────────────────────
async function showRequestSupplier(ctx, reqId, myId) {
  const req = db.getRequest(reqId);
  if (!req) { await ctx.editMessageText('Заявка не найдена.'); return; }
  const assignedTo = Number(req.supplier_chat_id || 0);
  const canAct = (assignedTo === 0 || assignedTo === myId) && !['REJECTED','CLOSED'].includes(req.status);
  const isMine = assignedTo === myId; const canTake = assignedTo === 0;
  const statusPretty = STATUS_MAP[req.status] || req.status;
  const adds = db.listAdditionsForRequest(reqId, 10);
  const addsBlock = adds.length ? adds.map(a => `• Доп. №${a.id} — ${a.status}${a.supplier_note?` | ❓ ${a.supplier_note}`:''}\n${a.text}`).join('\n\n') : '-';
  const extra = [];
  if (req.delivery_car_info && req.status === 'SHIPPED') extra.push(`Авто: ${req.delivery_car_info}`);
  if (req.delivery_eta && req.status === 'ON_ROUTE') extra.push(`Время: ${req.delivery_eta}`);
  if (req.status_set_by_name) extra.push(`Поставил: ${req.status_set_by_name}`);
  let text = `📨 Заявка *#${reqId}*\nСтатус: *${statusPretty}*${extra.length?'\n'+extra.join('\n'):''}\nУточнение: ${req.supplier_note||'-'}\n\n📍 ${req.site_address}\n👤 ${req.contact_person}\n\n📦 Материалы:\n${req.items}\n\n➕ Дополнения:\n${addsBlock}\n\n⚠️ Недовоз: ${req.undelivered_items||'-'}\n💬 ${req.comment||'-'}\n`;
  if (assignedTo === 0 && !['REJECTED','CLOSED'].includes(req.status)) text = '🟡 *Заявка без поставщика.*\n\n' + text;
  else if (assignedTo !== 0 && assignedTo !== myId) text = `ℹ️ *Назначена:* ${userNameByChatId(assignedTo)}\n\n` + text;
  let kb;
  if (!canAct) {
    kb = new InlineKeyboard().text('⬅️ Назад', 'back_supplier');
  } else {
    kb = new InlineKeyboard();
    if (!['ACCEPTED','ASSEMBLING','DELAYED','SHIPPED','ON_ROUTE'].includes(req.status)) kb.text('✅ Принять', `req_accept:${reqId}`).row();
    if (isMine || canTake) kb.text('📌 Статус', `req_status:${reqId}`).row();
    kb.text('❓ Уточнить', `req_question:${reqId}`).row().text('❌ Отказ', `req_reject:${reqId}`).row().text('⬅️ Назад', 'back_supplier');
  }
  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
}

async function showRequestManager(ctx, reqId, chatId) {
  const req = db.getRequest(reqId);
  if (!req) { await ctx.editMessageText('Заявка не найдена.'); return; }
  if (req.created_by_chat_id !== chatId) { await ctx.editMessageText('Нет доступа.'); return; }
  const statusPretty = STATUS_MAP[req.status] || req.status;
  const adds = db.listAdditionsForRequest(reqId, 5);
  const addsBlock = adds.length ? adds.map(a => `• Доп. №${a.id} — ${a.status}${a.supplier_note?` | ❓ ${a.supplier_note}`:''}`).join('\n') : '-';
  const extra = [];
  if (req.delivery_car_info && req.status === 'SHIPPED') extra.push(`Авто: ${req.delivery_car_info}`);
  if (req.delivery_eta && req.status === 'ON_ROUTE') extra.push(`Время: ${req.delivery_eta}`);
  if (req.status_set_by_name) extra.push(`Поставил: ${req.status_set_by_name}`);
  const text = `🧾 *Моя заявка #${reqId}*\nСтатус: *${statusPretty}*${extra.length?'\n'+extra.join('\n'):''}\nУточнение поставщика: ${req.supplier_note||'-'}\n\n📍 ${req.site_address}\n\n📦 Материалы:\n${req.items}\n\n➕ Дополнения:\n${addsBlock}\n\n⚠️ Недовоз: ${req.undelivered_items||'-'}\n`;
  const kb = new InlineKeyboard();
  if (req.status === 'QUESTION') kb.text('💬 Ответить на вопрос', `user_answer_req:${reqId}`).row();
  kb.text('✅ Закрыть', `user_close:${reqId}`).row()
    .text('⚠️ Недовоз', `user_shortage:${reqId}`).row()
    .text('➕ Дополнить', `user_additems:${reqId}`).row()
    .text('💬 Ответить на вопрос (доп.)', `user_answer_add:${reqId}`).row()
    .text('⬅️ Назад', 'back_user');
  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
}

module.exports = { onEnter, handleUpdate };
