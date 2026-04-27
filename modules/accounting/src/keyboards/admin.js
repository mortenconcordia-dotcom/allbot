import { Keyboard, InlineKeyboard } from 'grammy';

export function adminMenuKeyboard() {
  return new Keyboard()
    .text('💰 Все выплаты').text('👥 Участники').row()
    .text('🔔 Уведомления').text('📩 Сводка заявок').row()
    .text('🔧 Сменить роль').text('💳 Рассрочки').row()
    .text('🚪 Выйти из панели').row()
    .resized();
}

export function notificationsToggleInline(currentState) {
  const label = currentState ? '🔕 Отключить уведомления' : '🔔 Включить уведомления';
  return new InlineKeyboard()
    .text(label, 'admin_toggle_notifications').row()
    .text('◀️ Назад', 'back');
}

export function installmentAdminInline(installmentId) {
  return new InlineKeyboard()
    .text('✏️ Изменить остаток',   `adm_inst_edit_${installmentId}`).row()
    .text('🔒 Закрыть рассрочку', `adm_inst_close_${installmentId}`).row()
    .text('◀️ Назад',             'back');
}
