// Состояния бота — строки, хранятся в ctx.session.botState.state
// Аналог aiogram StatesGroup

export const States = {
  // Регистрация
  REGISTRATION_WAITING_NAME:  'registration:waiting_name',
  REGISTRATION_CHOOSING_ROLE: 'registration:choosing_role',

  // Переключение роли
  ROLE_SWITCH_CHOOSING: 'role_switch:choosing_active_role',

  // Администратор
  ADMIN_MENU:                'admin:menu',
  ADMIN_VIEW_CHOOSING_EMP:   'admin:view_choosing_employee',
  ADMIN_VIEW_CHOOSING_SITE:  'admin:view_choosing_site',
  ADMIN_VIEW_DETAIL:         'admin:view_detail',
  ADMIN_USERS_LIST:          'admin:users_list',
  ADMIN_ROLE_CHOOSING_USER:  'admin:role_choosing_user',
  ADMIN_ROLE_CHOOSING_ROLE:  'admin:role_choosing_new_role',

  // Бухгалтер
  ACC_MENU:                 'accountant:menu',
  ACC_PAY_CHOOSING_EMP:     'accountant:pay_choosing_employee',
  ACC_PAY_CHOOSING_SITE:    'accountant:pay_choosing_site',
  ACC_PAY_ADDING_SITE:      'accountant:pay_adding_site_name',
  ACC_PAY_ENTERING_AMOUNT:  'accountant:pay_entering_amount',
  ACC_PAY_AWAITING_CONFIRM: 'accountant:pay_awaiting_confirm',
  ACC_VIEW_CHOOSING_EMP:    'accountant:view_choosing_employee',
  ACC_VIEW_CHOOSING_SITE:   'accountant:view_choosing_site',
  ACC_VIEW_DETAIL:          'accountant:view_detail',
  ACC_PURCHASE_TITLE:       'accountant:purchase_entering_title',
  ACC_PURCHASE_ITEMS:       'accountant:purchase_entering_items',
  ACC_PURCHASE_AMOUNT:      'accountant:purchase_entering_amount',
  ACC_ADVANCE_CHOOSING_EMP: 'accountant:advance_choosing_employee',
  ACC_ADVANCE_DETAIL:       'accountant:advance_detail',

  // Бухгалтер — Рассрочки
  ACC_INST_MENU:             'accountant:inst_menu',
  ACC_INST_ACTIVE_LIST:      'accountant:inst_active_list',
  ACC_INST_ACTIVE_DETAIL:    'accountant:inst_active_detail',
  ACC_INST_DEDUCT_WAITING:   'accountant:inst_deduct_waiting',
  ACC_INST_NEW_CHOOSING_EMP: 'accountant:inst_new_choosing_emp',
  ACC_INST_NEW_AMOUNT:       'accountant:inst_new_amount',

  // Сотрудник
  EMP_MENU:                  'employee:menu',
  EMP_VIEW_CHOOSING_SITE:    'employee:view_choosing_site',
  EMP_VIEW_DETAIL:           'employee:view_detail',
  EMP_ADVANCE_CHOOSING_SITE: 'employee:advance_choosing_site',
  EMP_ADVANCE_ENTERING_AMT:  'employee:advance_entering_amount',
  EMP_ADVANCE_CONFIRM:       'employee:advance_confirm',

  // Сотрудник — Рассрочки
  EMP_INST_VIEW:             'employee:inst_view',

  // Администратор — Рассрочки
  ADMIN_INST_LIST:           'admin:inst_list',
  ADMIN_INST_DETAIL:         'admin:inst_detail',
  ADMIN_INST_EDIT_AMOUNT:    'admin:inst_edit_amount',
};
