export type Role = 'admin' | 'user' | 'all';

export interface ButtonPosition {
  row: number;
  col: number;
}

export interface ButtonConfig {
  /** Visible label */
  text: string;
  /** Callback data or command */
  action: string;
  /** Who can see the button (default: all) */
  role?: Role;
  /** Where to place the button in the matrix (default: top‑left) */
  position?: ButtonPosition;
}

export interface KeyboardButtonConfig {
  text: string;
  action: string;
  role?: 'admin' | 'user' | 'all';
  position?: {
    row: number;
    col: number;
  };
}

export interface KeyboardConfig {
  id: string;
  title?: string;
  buttons: KeyboardButtonConfig[];
  type: 'persistent' | 'inline';
  resize?: boolean;
  oneTime?: boolean;
  requiresAdmin?: boolean;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface ReplyKeyboardMarkup {
  keyboard: KeyboardButtonConfig[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  selective?: boolean;
} 