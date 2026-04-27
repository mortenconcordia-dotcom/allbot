import { Keyboard, InlineKeyboard } from 'grammy';

export function employeeMenuKeyboard(hasActiveInstallment = false) {
  const kb = new Keyboard()
    .text('📋 Мои выплаты').text('📩 Заявка на аванс').row();
  if (hasActiveInstallment) {
    kb.text('💳 Рассрочки').row();
  }
  kb.text('◀️ Главное меню').row();
  return kb.resized();
}

export function advanceConfirmInline(advanceId) {
  return new InlineKeyboard()
    .text('✅ Отправить заявку', `adv_send_${advanceId}`).row()
    .text('◀️ Назад', 'back');
}
