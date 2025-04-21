import { InlineKeyboardMarkup, ReplyKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

/**
 * Keyboard Configuration System
 * This file contains a unified system for configuring both persistent navigation keyboards
 * and inline message keyboards in a consistent way.
 */

// Interface for button configuration (used by both keyboard types)
export interface KeyboardButtonConfig {
  text: string;                   // Button text
  action: string;                 // Action identifier (command or callback data)
  role?: 'admin' | 'user' | 'all'; // Required role to see this button
  position?: {                    // Optional position in the keyboard
    row: number;                  // Row index (0-based)
    col: number;                  // Column index within row (0-based)
  };
}

// Interface for keyboard configuration
export interface KeyboardConfig {
  id: string;                     // Unique identifier for this keyboard
  title?: string;                 // Optional title for message keyboards
  buttons: KeyboardButtonConfig[]; // Buttons in this keyboard
  type: 'persistent' | 'inline';  // Keyboard type
  resize?: boolean;               // Whether to resize the keyboard (for persistent only)
  oneTime?: boolean;              // Whether to hide after use (for persistent only)
  requiresAdmin?: boolean;        // Whether this keyboard requires admin role
}

/**
 * PERSISTENT KEYBOARD CONFIGURATIONS
 * These are shown at the bottom of the chat and persist across messages
 */

// Main navigation keyboard (shown to all users)
export const MAIN_NAVIGATION: KeyboardConfig = {
  id: 'main_nav',
  type: 'persistent',
  resize: true,
  buttons: [
    { text: '📋 Мої завдання', action: 'show_tasks', role: 'all', position: { row: 0, col: 0 } },
    { text: '⚙️ Меню', action: 'show_menu', role: 'all', position: { row: 0, col: 1 } },
    { text: '❓ Допомога', action: 'help', role: 'all', position: { row: 1, col: 0 } },
    { text: 'ℹ️ Про бота', action: 'about', role: 'all', position: { row: 1, col: 1 } },
    { text: '👨‍💼 Адмін панель', action: 'admin_panel', role: 'admin', position: { row: 2, col: 0 } }
  ]
};

// Admin panel navigation keyboard
export const ADMIN_NAVIGATION: KeyboardConfig = {
  id: 'admin_nav',
  type: 'persistent',
  resize: true,
  requiresAdmin: true,
  buttons: [
    { text: 'Змінити заїзди', action: 'edit_checkins', role: 'admin', position: { row: 0, col: 0 } },
    { text: 'Змінити виїзди', action: 'edit_checkouts', role: 'admin', position: { row: 0, col: 1 } },
    { text: 'Користувачі', action: 'manage_users', role: 'admin', position: { row: 1, col: 0 } },
    { text: 'Квартири', action: 'manage_apartments', role: 'admin', position: { row: 1, col: 1 } },
    { text: 'Головне меню', action: 'back_to_main', role: 'admin', position: { row: 2, col: 0 } }
  ]
};

// Check-ins management keyboard
export const CHECKINS_NAVIGATION: KeyboardConfig = {
  id: 'checkins_nav',
  type: 'persistent',
  resize: true,
  requiresAdmin: true,
  buttons: [
    { text: 'Змінити виїзди', action: 'edit_checkouts', role: 'admin', position: { row: 0, col: 0 } },
    { text: 'Користувачі', action: 'manage_users', role: 'admin', position: { row: 1, col: 0 } },
    { text: 'Квартири', action: 'manage_apartments', role: 'admin', position: { row: 1, col: 1 } },
    { text: 'Адмін панель', action: 'admin_panel', role: 'admin', position: { row: 2, col: 0 } },
    { text: 'Головне меню', action: 'back_to_main', role: 'admin', position: { row: 2, col: 1 } }
  ]
};

// Check-outs management keyboard
export const CHECKOUTS_NAVIGATION: KeyboardConfig = {
  id: 'checkouts_nav',
  type: 'persistent',
  resize: true,
  requiresAdmin: true,
  buttons: [
    { text: 'Змінити заїзди', action: 'edit_checkins', role: 'admin', position: { row: 0, col: 0 } },
    { text: 'Користувачі', action: 'manage_users', role: 'admin', position: { row: 1, col: 0 } },
    { text: 'Квартири', action: 'manage_apartments', role: 'admin', position: { row: 1, col: 1 } },
    { text: 'Адмін панель', action: 'admin_panel', role: 'admin', position: { row: 2, col: 0 } },
    { text: 'Головне меню', action: 'back_to_main', role: 'admin', position: { row: 2, col: 1 } }
  ]
};

// Apartment management keyboard
export const APARTMENTS_NAVIGATION: KeyboardConfig = {
  id: 'apartments_nav',
  type: 'persistent',
  resize: true,
  requiresAdmin: true,
  buttons: [
    { text: 'Змінити заїзди', action: 'edit_checkins', role: 'admin', position: { row: 2, col: 0 } },
    { text: 'Змінити виїзди', action: 'edit_checkouts', role: 'admin', position: { row: 2, col: 1 } },
    { text: 'Користувачі', action: 'manage_users', role: 'admin', position: { row: 3, col: 0 } },
    { text: 'Адмін панель', action: 'admin_panel', role: 'admin', position: { row: 4, col: 0 } },
    { text: 'Головне меню', action: 'back_to_main', role: 'admin', position: { row: 4, col: 1 } }
  ]
};

// User management keyboard
export const USERS_NAVIGATION: KeyboardConfig = {
  id: 'users_nav',
  type: 'persistent',
  resize: true,
  requiresAdmin: true,
  buttons: [
    { text: 'Змінити заїзди', action: 'edit_checkins', role: 'admin', position: { row: 2, col: 0 } },
    { text: 'Змінити виїзди', action: 'edit_checkouts', role: 'admin', position: { row: 2, col: 1 } },
    { text: 'Квартири', action: 'manage_apartments', role: 'admin', position: { row: 3, col: 0 } },
    { text: 'Адмін панель', action: 'admin_panel', role: 'admin', position: { row: 4, col: 0 } },
    { text: 'Головне меню', action: 'back_to_main', role: 'admin', position: { row: 4, col: 1 } }
  ]
};

// Check-in edit keyboard
export const CHECKIN_EDIT_KEYBOARD: KeyboardConfig = {
  id: 'checkin_edit',
  type: 'persistent',
  resize: true,
  requiresAdmin: true,
  buttons: [
    { text: '⏰ Змінити час', action: 'edit_checkin_time', role: 'admin', position: { row: 0, col: 0 } },
    { text: '🔑 Змінити ключі', action: 'edit_checkin_keys', role: 'admin', position: { row: 0, col: 1 } },
    { text: '💰 Змінити суму', action: 'edit_checkin_money', role: 'admin', position: { row: 1, col: 0 } },
    { text: '↩️ Назад до списку', action: 'back_to_checkins', role: 'admin', position: { row: 2, col: 0 } },
    { text: '🏠 Головне меню', action: 'back_to_main', role: 'admin', position: { row: 2, col: 1 } }
  ]
};

// Check-out edit keyboard
export const CHECKOUT_EDIT_KEYBOARD: KeyboardConfig = {
  id: 'checkout_edit',
  type: 'persistent',
  resize: true,
  requiresAdmin: true,
  buttons: [
    { text: '⏰ Змінити час', action: 'edit_checkout_time', role: 'admin', position: { row: 0, col: 0 } },
    { text: '🔑 Змінити ключі', action: 'edit_checkout_keys', role: 'admin', position: { row: 0, col: 1 } },
    { text: '💰 Змінити суму', action: 'edit_checkout_money', role: 'admin', position: { row: 1, col: 0 } },
    { text: '↩️ Назад до списку', action: 'back_to_checkouts', role: 'admin', position: { row: 2, col: 0 } },
    { text: '🏠 Головне меню', action: 'back_to_main', role: 'admin', position: { row: 2, col: 1 } }
  ]
};

/**
 * INLINE KEYBOARD CONFIGURATIONS
 * These appear in messages and support callback functionality
 */

// Main menu inline keyboard
// export const MAIN_MENU: KeyboardConfig = {
//   id: 'main_menu',
//   title: 'Головне меню:',
//   type: 'inline',
//   buttons: [
//     { text: '📋 Мої завдання', action: 'show_tasks', role: 'all', position: { row: 0, col: 0 } },
//     { text: '⚙️ Меню', action: 'show_menu', role: 'all', position: { row: 0, col: 1 } },
//     { text: '❓ Допомога', action: 'help', role: 'all', position: { row: 1, col: 0 } },
//     { text: 'ℹ️ Про бота', action: 'about', role: 'all', position: { row: 1, col: 1 } },
//     { text: '👨‍💼 Адмін панель', action: 'admin_panel', role: 'admin', position: { row: 2, col: 0 } }
//   ]
// };

// Admin panel inline keyboard
export const ADMIN_MENU: KeyboardConfig = {
  id: 'admin_menu',
  title: 'Адмін панель:',
  type: 'inline',
  requiresAdmin: true,
  buttons: [
    { text: 'Змінити заїзди', action: 'edit_checkins', role: 'admin', position: { row: 0, col: 0 } },
    { text: 'Змінити виїзди', action: 'edit_checkouts', role: 'admin', position: { row: 0, col: 1 } },
    { text: 'Користувачі', action: 'manage_users', role: 'admin', position: { row: 1, col: 0 } },
    { text: 'Квартири', action: 'manage_apartments', role: 'admin', position: { row: 1, col: 1 } },
    { text: 'Головне меню', action: 'show_menu', role: 'admin', position: { row: 2, col: 0 } }
  ]
};

// Dynamic inline keyboard generators
export function createCheckInListKeyboard(page: number, totalPages: number, forEditing: boolean = false): KeyboardButtonConfig[] {
  const buttons: KeyboardButtonConfig[] = [];

  if (forEditing) {
    // In edit mode, add a cancel button
    buttons.push({ 
      text: '❌ Скасувати', 
      action: 'cancel_checkin_edit', 
      role: 'admin', 
      position: { row: 0, col: 0 } 
    });
  } else {
    // Navigation row: Previous page, Edit, Next page
    const navRow: KeyboardButtonConfig[] = [];
    
    if (page > 1) {
      navRow.push({ 
        text: '⬅️', 
        action: `checkin_page_${page - 1}`, 
        role: 'admin', 
        position: { row: 0, col: 0 } 
      });
    }
    
    navRow.push({ 
      text: '✏️ Редагувати', 
      action: `show_checkin_edit_${page}`, 
      role: 'admin', 
      position: { row: 0, col: 1 } 
    });
    
    if (page < totalPages) {
      navRow.push({ 
        text: '➡️', 
        action: `checkin_page_${page + 1}`, 
        role: 'admin', 
        position: { row: 0, col: 2 } 
      });
    }
    
    buttons.push(...navRow);
    
    // Date navigation row
    buttons.push({ 
      text: '◀️ Попередній день', 
      action: 'prev_checkin_day', 
      role: 'admin', 
      position: { row: 1, col: 0 } 
    });
    
    buttons.push({ 
      text: 'Наступний день ▶️', 
      action: 'next_checkin_day', 
      role: 'admin', 
      position: { row: 1, col: 1 } 
    });
  }
  
  return buttons;
}

export function createCheckOutListKeyboard(page: number, totalPages: number, forEditing: boolean = false): KeyboardButtonConfig[] {
  const buttons: KeyboardButtonConfig[] = [];

  if (forEditing) {
    // In edit mode, add a cancel button
    buttons.push({ 
      text: '❌ Скасувати', 
      action: 'cancel_checkout_edit', 
      role: 'admin', 
      position: { row: 0, col: 0 } 
    });
  } else {
    // Navigation row: Previous page, Edit, Next page
    const navRow: KeyboardButtonConfig[] = [];
    
    if (page > 1) {
      navRow.push({ 
        text: '⬅️', 
        action: `checkout_page_${page - 1}`, 
        role: 'admin', 
        position: { row: 0, col: 0 } 
      });
    }
    
    navRow.push({ 
      text: '✏️ Редагувати', 
      action: `show_checkout_edit_${page}`, 
      role: 'admin', 
      position: { row: 0, col: 1 } 
    });
    
    if (page < totalPages) {
      navRow.push({ 
        text: '➡️', 
        action: `checkout_page_${page + 1}`, 
        role: 'admin', 
        position: { row: 0, col: 2 } 
      });
    }
    
    buttons.push(...navRow);
    
    // Date navigation row
    buttons.push({ 
      text: '◀️ Попередній день', 
      action: 'prev_checkout_day', 
      role: 'admin', 
      position: { row: 1, col: 0 } 
    });
    
    buttons.push({ 
      text: 'Наступний день ▶️', 
      action: 'next_checkout_day', 
      role: 'admin', 
      position: { row: 1, col: 1 } 
    });
  }
  
  return buttons;
}

// Creates inline keyboard for apartment selection in edit mode
export function createApartmentEditKeyboard(apartments: { id: string }[], type: 'checkin' | 'checkout'): KeyboardButtonConfig[] {
  const buttons: KeyboardButtonConfig[] = [];
  
  apartments.forEach((apt, index) => {
    buttons.push({ 
      text: apt.id, 
      action: `edit_${type}_${apt.id}`, 
      role: 'admin', 
      position: { row: index, col: 0 } 
    });
  });
  
  // Add cancel button at the end
  buttons.push({ 
    text: '❌ Скасувати', 
    action: `cancel_${type}_edit`, 
    role: 'admin', 
    position: { row: apartments.length, col: 0 } 
  });
  
  return buttons;
}

// Add these new keyboard configurations to better support task management modes

// Task List navigation (shared between check-ins/check-outs)
export const TASK_LIST_NAVIGATION: KeyboardConfig = {
  id: 'task_list_nav',
  type: 'inline',
  requiresAdmin: true,
  buttons: [
    { text: '◀️ Попередній день', action: 'prev_day', role: 'admin', position: { row: 0, col: 0 } },
    { text: 'Наступний день ▶️', action: 'next_day', role: 'admin', position: { row: 0, col: 1 } },
    { text: '✏️ Редагувати', action: 'show_edit', role: 'admin', position: { row: 1, col: 0 } },
    { text: '↩️ Назад', action: 'admin_panel', role: 'admin', position: { row: 2, col: 0 } }
  ]
};

// Task Edit mode (shared between check-ins/check-outs)
export const TASK_EDIT_BUTTONS: KeyboardConfig = {
  id: 'task_edit_buttons',
  type: 'inline',
  requiresAdmin: true,
  buttons: [
    { text: '⏰ Змінити час', action: 'edit_time', role: 'admin', position: { row: 0, col: 0 } },
    { text: '🔑 Змінити ключі', action: 'edit_keys', role: 'admin', position: { row: 0, col: 1 } },
    { text: '💰 Змінити суму', action: 'edit_money', role: 'admin', position: { row: 1, col: 0 } },
    { text: '↩️ Назад до списку', action: 'back_to_list', role: 'admin', position: { row: 2, col: 0 } }
  ]
};

// Add this interface for dynamic keyboard creation
export interface TaskDisplayKeyboardOptions {
  tasks: any[];
  type: 'checkin' | 'checkout';
  page: number;
  totalPages: number;
  forEditing: boolean;
}

/**
 * Creates a keyboard for task display (check-in/check-out list) with proper buttons
 */
export function createTaskDisplayKeyboard(options: TaskDisplayKeyboardOptions): KeyboardButtonConfig[] {
  const { tasks, type, page, totalPages, forEditing } = options;
  const buttons: KeyboardButtonConfig[] = [];
  
  // Navigation buttons always at the top
  buttons.push({ 
    text: '◀️ Попередній день', 
    action: `prev_${type}_day`, 
    role: 'admin', 
    position: { row: 0, col: 0 } 
  });
  
  buttons.push({ 
    text: 'Наступний день ▶️', 
    action: `next_${type}_day`, 
    role: 'admin', 
    position: { row: 0, col: 1 } 
  });
  
  // Different handling for edit mode vs. view mode
  if (forEditing) {
    // Add task buttons in edit mode
    if (tasks.length > 0) {
      tasks.forEach((task, index) => {
        const timeInfo = type === 'checkin' 
          ? (task.checkinTime ? ` ⏰ ${task.checkinTime}` : '')
          : (task.checkoutTime ? ` ⏰ ${task.checkoutTime}` : '');
        const guestInfo = task.guestName ? ` 👤 ${task.guestName.split(' ')[0]}` : '';
        
        buttons.push({
          text: `🏠 ${task.apartmentId}${timeInfo}${guestInfo}`, 
          action: `edit_${type}_${task.id}`,
          role: 'admin',
          position: { row: index + 1, col: 0 }
        });
      });
    } else {
      // No tasks message
      buttons.push({
        text: 'Немає завдань для редагування', 
        action: `cancel_${type}_edit`,
        role: 'admin',
        position: { row: 1, col: 0 }
      });
    }
    
    // Add cancel button at the end
    const cancelRow = tasks.length > 0 ? tasks.length + 1 : 2;
    buttons.push({ 
      text: '❌ Скасувати', 
      action: `cancel_${type}_edit`, 
      role: 'admin', 
      position: { row: cancelRow, col: 0 } 
    });
  } else {
    // Add edit button in view mode (if there are tasks)
    if (tasks.length > 0) {
      buttons.push({ 
        text: '✏️ Редагувати', 
        action: `show_${type}_edit_${page}`, 
        role: 'admin', 
        position: { row: 1, col: 0 } 
      });
    }
    
    // Add pagination buttons if needed
    if (totalPages > 1) {
      const paginationRow = tasks.length > 0 ? 2 : 1;
      
      if (page > 1) {
        buttons.push({ 
          text: '⬅️', 
          action: `${type}_page_${page - 1}`, 
          role: 'admin', 
          position: { row: paginationRow, col: 0 } 
        });
      }
      
      if (page < totalPages) {
        buttons.push({ 
          text: '➡️', 
          action: `${type}_page_${page + 1}`, 
          role: 'admin', 
          position: { row: paginationRow, col: 1 } 
        });
      }
    }
  }
  
  // Back button - always at the bottom
  const backRow = buttons.reduce((max, btn) => Math.max(max, btn.position?.row || 0), 0) + 1;
  buttons.push({ 
    text: '↩️ Назад', 
    action: 'admin_panel', 
    role: 'admin', 
    position: { row: backRow, col: 0 } 
  });
  
  return buttons;
}

/**
 * Create button config for editing a specific task
 */
export function createTaskEditButtons(
  task: any, 
  type: 'checkin' | 'checkout', 
  apartmentAddress?: string
): KeyboardButtonConfig[] {
  const buttons: KeyboardButtonConfig[] = [];
  
  // Time edit button
  buttons.push({ 
    text: '⏰ Змінити час', 
    action: `edit_${type}_time`, 
    role: 'admin', 
    position: { row: 0, col: 0 } 
  });
  
  // Keys edit button
  buttons.push({ 
    text: '🔑 Змінити ключі', 
    action: `edit_${type}_keys`, 
    role: 'admin', 
    position: { row: 0, col: 1 } 
  });
  
  // Money edit button
  buttons.push({ 
    text: '💰 Змінити суму', 
    action: `edit_${type}_money`, 
    role: 'admin', 
    position: { row: 1, col: 0 } 
  });
  
  // Back button
  buttons.push({ 
    text: '↩️ Назад до списку', 
    action: `back_to_${type}s`, 
    role: 'admin', 
    position: { row: 2, col: 0 } 
  });
  
  return buttons;
}

/**
 * Format task detail text for display
 */
export function formatTaskDetailText(
  task: any, 
  type: 'checkin' | 'checkout', 
  apartmentAddress?: string
): string {
  const title = type === 'checkin' ? 'заїзду' : 'виїзду';
  const timeField = type === 'checkin' ? task.checkinTime : task.checkoutTime;
  
  // Address details
  let addressDetails = '';
  if (apartmentAddress) {
    addressDetails = `\n📍 *Адреса:* ${apartmentAddress}`;
  }
  
  return `📝 *Редагування ${title} - ${task.apartmentId}*\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${addressDetails}\n\n` +
    `*Поточні дані:*\n` +
    `⏰ *Час:* ${timeField || 'Не вказано'}\n` +
    `🔑 *Ключі:* ${task.keysCount || '1'}\n` +
    `💰 *Сума:* ${task.sumToCollect || '0'} грн\n\n` +
    `*Оберіть параметр для редагування:*`;
}

/**
 * Collection of all keyboard configurations for easy access
 */
export const KEYBOARDS: Record<string, KeyboardConfig> = {
  main_nav: MAIN_NAVIGATION,
  admin_nav: ADMIN_NAVIGATION,
  checkins_nav: CHECKINS_NAVIGATION,
  checkouts_nav: CHECKOUTS_NAVIGATION,
  apartments_nav: APARTMENTS_NAVIGATION,
  users_nav: USERS_NAVIGATION,
  checkin_edit: CHECKIN_EDIT_KEYBOARD,
  checkout_edit: CHECKOUT_EDIT_KEYBOARD,
  task_list_nav: TASK_LIST_NAVIGATION,
  task_edit_buttons: TASK_EDIT_BUTTONS,
  // main_menu: MAIN_MENU,
  admin_menu: ADMIN_MENU
};

/**
 * Helper Functions
 */

/**
 * Convert a keyboard configuration to a Telegram Reply Keyboard Markup
 * (for persistent keyboards at the bottom of the chat)
 */
export function createReplyKeyboard(
  keyboardConfig: KeyboardConfig,
  isAdmin: boolean = false
): ReplyKeyboardMarkup {
  // Filter buttons based on role
  const visibleButtons = keyboardConfig.buttons.filter(button => {
    return button.role === 'all' || 
           (button.role === 'admin' && isAdmin) || 
           (button.role === 'user' && !isAdmin);
  });

  // Organize buttons by row
  const rows: Record<number, { text: string; col: number }[]> = {};
  visibleButtons.forEach(button => {
    const row = button.position?.row || 0;
    if (!rows[row]) rows[row] = [];
    rows[row].push({ 
      text: button.text, 
      col: button.position?.col || rows[row].length 
    });
  });

  // Sort rows and columns and create keyboard
  const keyboard = Object.keys(rows)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map(rowKey => {
      const rowButtons = rows[parseInt(rowKey)];
      return rowButtons
        .sort((a, b) => a.col - b.col)
        .map(button => ({ text: button.text }));
    });

  return {
    keyboard,
    resize_keyboard: keyboardConfig.resize || true,
    one_time_keyboard: keyboardConfig.oneTime || false
  };
}

/**
 * Convert a keyboard configuration to a Telegram Inline Keyboard Markup
 * (for inline buttons in messages)
 */
export function createInlineKeyboard(
  keyboardConfig: KeyboardConfig | KeyboardButtonConfig[],
  isAdmin: boolean = false
): InlineKeyboardMarkup {
  // Handle both full config and button array
  const buttons = Array.isArray(keyboardConfig) 
    ? keyboardConfig 
    : keyboardConfig.buttons;
  
  // Filter buttons based on role
  const visibleButtons = buttons.filter(button => {
    return button.role === 'all' || 
           (button.role === 'admin' && isAdmin) || 
           (button.role === 'user' && !isAdmin);
  });

  // Organize buttons by row
  const rows: Record<number, { text: string; action: string; col: number }[]> = {};
  visibleButtons.forEach(button => {
    const row = button.position?.row || 0;
    if (!rows[row]) rows[row] = [];
    rows[row].push({ 
      text: button.text, 
      action: button.action,
      col: button.position?.col || rows[row].length 
    });
  });

  // Sort rows and columns and create keyboard
  const inline_keyboard = Object.keys(rows)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map(rowKey => {
      const rowButtons = rows[parseInt(rowKey)];
      return rowButtons
        .sort((a, b) => a.col - b.col)
        .map(button => ({ 
          text: button.text,
          callback_data: button.action
        }));
    });

  return { inline_keyboard };
} 