// Collection paths
export const APARTMENTS_COLLECTION = 'apartments';
export const USERS_COLLECTION = 'users';
export const TASKS_COLLECTION = 'tasks';
export const RESERVATIONS_COLLECTION = 'reservations';
export const CLEANING_ASSIGNMENTS_COLLECTION = 'cleaningAssignments';
export const TIME_CHANGES_COLLECTION = 'timeChanges';

// User roles
export enum UserRoles {
  ADMIN = 'admin',
  CLEANER = 'cleaner',
  USER = 'user'
}

// Task types
export enum TaskTypes {
  CHECKIN = 'checkin',
  CHECKOUT = 'checkout',
  CLEANING = 'cleaning'
}

// Task statuses
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

// Message constants
export const MESSAGES = {
  WELCOME: 'Welcome to the Kyiv Apartments Management Bot!',
  HELP: 'This bot helps you manage check-ins, check-outs, and cleaning tasks for apartments.\n\nAvailable commands:\n/menu - Show main menu\n/help - Show this help message\n/about - About this bot\n/get_my_tasks - Get your assigned tasks\n/admin - Show admin panel (admin only)',
  ABOUT: 'Kyiv Apartments Management Bot\nVersion 1.0.0\n\nDeveloped by Your Company',
  ADMIN_ONLY: 'This function is only available for administrators.',
  NO_TASKS: 'You have no tasks assigned at the moment.',
  ERROR: 'An error occurred. Please try again later.'
};

// Callback data prefixes
export const CALLBACK_PREFIXES = {
  SHOW_MENU: 'show_menu',
  SHOW_ADMIN: 'show_admin',
  SHOW_TASKS: 'show_tasks',
  SHOW_HELP: 'show_help',
  SHOW_ABOUT: 'show_about',
  EDIT_CHECKINS: 'edit_checkins',
  EDIT_CHECKOUTS: 'edit_checkouts',
  MANAGE_USERS: 'manage_users',
  USER_PAGE: 'user_page',
  USER_EDIT: 'user_edit',
  USER_DELETE: 'user_delete',
  USER_ADD: 'user_add',
  USER_SAVE: 'user_save',
  ASSIGN_CLEANER: 'assign_cleaner',
  DATE_PREV: 'date_prev',
  DATE_NEXT: 'date_next',
  DATE_SELECT: 'date_select',
  BACK: 'back',
  CANCEL: 'cancel',
  CONFIRM: 'confirm'
};

// Pagination limits
export const PAGE_SIZE = 5;
export const MAX_INLINE_BUTTONS = 100; // Telegram limit

// Default times for tasks
export const DEFAULT_CHECKIN_TIME = "14:00";
export const DEFAULT_CHECKOUT_TIME = "12:00"; 