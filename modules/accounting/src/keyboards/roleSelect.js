import { Keyboard, InlineKeyboard } from 'grammy';

export function roleSelectKeyboard(both = false) {
  const kb = new Keyboard().text('🧾 Бухгалтер').text('👷 Сотрудник');
  if (both) kb.row().text('🔀 Обе роли');
  kb.row().text('◀️ Главное меню');
  return kb.resized();
}

export function activeRoleKeyboard() {
  return new Keyboard()
    .text('🧾 Войти как Бухгалтер').row()
    .text('👷 Войти как Сотрудник').row()
    .text('◀️ Главное меню').row()
    .resized();
}

export function adminRoleAssignInline(userId) {
  return new InlineKeyboard()
    .text('🧾 Бухгалтер', `setrole_${userId}_accountant`)
    .text('👷 Сотрудник', `setrole_${userId}_employee`).row()
    .text('🔀 Обе роли',  `setrole_${userId}_both`).row()
    .text('◀️ Назад', 'back');
}
