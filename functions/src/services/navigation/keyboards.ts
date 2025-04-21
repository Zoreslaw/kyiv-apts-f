import { KeyboardConfig } from './keyboardTypes';

export const KEYBOARDS: Record<string, KeyboardConfig> = {
  /** Main navigation (persistent) */
  main_nav: {
    id: 'main_nav',
    type: 'persistent',
    resize: true,
    buttons: [
      { text: '📋 Мої завдання', action: 'show_tasks', position: { row: 0, col: 0 } },
      { text: '⚙️ Меню', action: 'show_menu', position: { row: 0, col: 1 } },
      { text: '❓ Допомога', action: 'help', position: { row: 1, col: 0 } },
      { text: 'ℹ️ Про бота', action: 'about', position: { row: 1, col: 1 } },
      { text: '👨‍💼 Адмін панель', action: 'admin_panel', role: 'admin', position: { row: 2, col: 0 } },
    ],
  },

  /** Admin panel (persistent, admin‑only) */
  admin_nav: {
    id: 'admin_nav',
    type: 'persistent',
    resize: true,
    requiresAdmin: true,
    buttons: [
      { text: 'Змінити заїзди', action: 'edit_checkins', role: 'admin', position: { row: 0, col: 0 } },
      { text: 'Змінити виїзди', action: 'edit_checkouts', role: 'admin', position: { row: 0, col: 1 } },
      { text: 'Користувачі', action: 'manage_users', role: 'admin', position: { row: 1, col: 0 } },
      { text: 'Квартири', action: 'manage_apartments', role: 'admin', position: { row: 1, col: 1 } },
      { text: 'Головне меню', action: 'back_to_main', role: 'admin', position: { row: 2, col: 0 } },
    ],
  },

  /** Check-ins management (persistent, admin‑only) */
  checkins_nav: {
    id: 'checkins_nav',
    type: 'persistent',
    resize: true,
    requiresAdmin: true,
    buttons: [
      { text: 'Змінити виїзди', action: 'edit_checkouts', role: 'admin', position: { row: 0, col: 0 } },
      { text: 'Користувачі', action: 'manage_users', role: 'admin', position: { row: 1, col: 0 } },
      { text: 'Квартири', action: 'manage_apartments', role: 'admin', position: { row: 1, col: 1 } },
      { text: 'Адмін панель', action: 'admin_panel', role: 'admin', position: { row: 2, col: 0 } },
      { text: 'Головне меню', action: 'back_to_main', role: 'admin', position: { row: 2, col: 1 } },
    ],
  },

  /** Check-outs management (persistent, admin‑only) */
  checkouts_nav: {
    id: 'checkouts_nav',
    type: 'persistent',
    resize: true,
    requiresAdmin: true,
    buttons: [
      { text: 'Змінити заїзди', action: 'edit_checkins', role: 'admin', position: { row: 0, col: 0 } },
      { text: 'Користувачі', action: 'manage_users', role: 'admin', position: { row: 1, col: 0 } },
      { text: 'Квартири', action: 'manage_apartments', role: 'admin', position: { row: 1, col: 1 } },
      { text: 'Адмін панель', action: 'admin_panel', role: 'admin', position: { row: 2, col: 0 } },
      { text: 'Головне меню', action: 'back_to_main', role: 'admin', position: { row: 2, col: 1 } },
    ],
  },

  /** Check-in edit keyboard (persistent, admin‑only) */
  checkin_edit: {
    id: 'checkin_edit',
    type: 'persistent',
    resize: true,
    requiresAdmin: true,
    buttons: [
      { text: '⏰ Змінити час', action: 'edit_checkin_time', role: 'admin', position: { row: 0, col: 0 } },
      { text: '🔑 Змінити ключі', action: 'edit_checkin_keys', role: 'admin', position: { row: 0, col: 1 } },
      { text: '💰 Змінити суму', action: 'edit_checkin_money', role: 'admin', position: { row: 1, col: 0 } },
      { text: '↩️ Назад до списку', action: 'back_to_checkins', role: 'admin', position: { row: 2, col: 0 } },
      { text: '🏠 Головне меню', action: 'back_to_main', role: 'admin', position: { row: 2, col: 1 } },
    ],
  },

  /** Check-out edit keyboard (persistent, admin‑only) */
  checkout_edit: {
    id: 'checkout_edit',
    type: 'persistent',
    resize: true,
    requiresAdmin: true,
    buttons: [
      { text: '⏰ Змінити час', action: 'edit_checkout_time', role: 'admin', position: { row: 0, col: 0 } },
      { text: '🔑 Змінити ключі', action: 'edit_checkout_keys', role: 'admin', position: { row: 0, col: 1 } },
      { text: '💰 Змінити суму', action: 'edit_checkout_money', role: 'admin', position: { row: 1, col: 0 } },
      { text: '↩️ Назад до списку', action: 'back_to_checkouts', role: 'admin', position: { row: 2, col: 0 } },
      { text: '🏠 Головне меню', action: 'back_to_main', role: 'admin', position: { row: 2, col: 1 } },
    ],
  },

  /** Admin menu (inline, admin‑only) */
  admin_menu: {
    id: 'admin_menu',
    type: 'inline',
    title: 'Адмін панель:',
    requiresAdmin: true,
    buttons: [
      { text: 'Змінити заїзди', action: 'edit_checkins', role: 'admin', position: { row: 0, col: 0 } },
      { text: 'Змінити виїзди', action: 'edit_checkouts', role: 'admin', position: { row: 0, col: 1 } },
      { text: 'Користувачі', action: 'manage_users', role: 'admin', position: { row: 1, col: 0 } },
      { text: 'Квартири', action: 'manage_apartments', role: 'admin', position: { row: 1, col: 1 } },
      { text: 'Головне меню', action: 'show_menu', role: 'admin', position: { row: 2, col: 0 } },
    ],
  },

  /** Task list navigation (inline, admin‑only) */
  task_list_nav: {
    id: 'task_list_nav',
    type: 'inline',
    requiresAdmin: true,
    buttons: [
      { text: '◀️ Попередній день', action: 'prev_day', role: 'admin', position: { row: 0, col: 0 } },
      { text: 'Наступний день ▶️', action: 'next_day', role: 'admin', position: { row: 0, col: 1 } },
      { text: '✏️ Редагувати', action: 'show_edit', role: 'admin', position: { row: 1, col: 0 } },
      { text: '↩️ Назад', action: 'admin_panel', role: 'admin', position: { row: 2, col: 0 } },
    ],
  },

  /** Task edit buttons (inline, admin‑only) */
  task_edit_buttons: {
    id: 'task_edit_buttons',
    type: 'inline',
    requiresAdmin: true,
    buttons: [
      { text: '⏰ Змінити час', action: 'edit_time', role: 'admin', position: { row: 0, col: 0 } },
      { text: '🔑 Змінити ключі', action: 'edit_keys', role: 'admin', position: { row: 0, col: 1 } },
      { text: '💰 Змінити суму', action: 'edit_money', role: 'admin', position: { row: 1, col: 0 } },
      { text: '↩️ Назад до списку', action: 'back_to_list', role: 'admin', position: { row: 2, col: 0 } },
    ],
  },
}; 