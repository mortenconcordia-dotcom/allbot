import { InlineKeyboard, Keyboard } from 'grammy';

export const BACK_BTN = '◀️ Назад';
export const BACK_CB  = 'back';

export function backKeyboard() {
  return new Keyboard().text(BACK_BTN).row().text('◀️ Главное меню').resized();
}

export function backInline() {
  return new InlineKeyboard().text('◀️ Назад', BACK_CB);
}

export function confirmCancelInline(confirmData, cancelData = BACK_CB) {
  return new InlineKeyboard()
    .text('✅ Подтвердить', confirmData)
    .text('❌ Отмена', cancelData);
}

/**
 * Универсальная inline-клавиатура-список.
 * @param {Array<[string, string]>} items - [[label, callbackData], ...]
 * @param {[string, string]|null} addBtn - опциональная кнопка «Добавить»
 * @param {boolean} back - добавлять ли кнопку «Назад»
 */
export function paginatedListInline(items, addBtn = null, back = true) {
  const kb = new InlineKeyboard();
  for (const [label, cbData] of items) {
    kb.text(label, cbData).row();
  }
  if (addBtn) {
    kb.text(addBtn[0], addBtn[1]).row();
  }
  if (back) {
    kb.text('◀️ Назад', BACK_CB);
  }
  return kb;
}
