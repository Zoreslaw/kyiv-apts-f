import { KeyboardConfig, ButtonConfig } from './keyboardTypes';
import { InlineKeyboardMarkup, ReplyKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

/** Convert a KeyboardConfig into Telegram reply_keyboard */
export function buildPersistentKeyboard(cfg: KeyboardConfig, isAdmin: boolean): ReplyKeyboardMarkup {
  const rows: string[][] = [];
  cfg.buttons
    .filter(b => isAllowed(b, isAdmin))
    .forEach(b => {
      ensureRow(rows, b.position?.row ?? 0);
      rows[b.position?.row ?? 0].push(b.text);
    });
  return {
    keyboard: rows,
    resize_keyboard: cfg.resize ?? true,
    one_time_keyboard: cfg.oneTime ?? false,
  };
}

/** Convert a KeyboardConfig into Telegram inline_keyboard */
export function buildInlineKeyboard(cfg: KeyboardConfig, isAdmin: boolean): InlineKeyboardMarkup {
  const rows: { text: string; callback_data: string }[][] = [];
  cfg.buttons
    .filter(b => isAllowed(b, isAdmin))
    .forEach(b => {
      ensureRow(rows, b.position?.row ?? 0);
      rows[b.position?.row ?? 0].push({ text: b.text, callback_data: b.action });
    });
  return { inline_keyboard: rows };
}

function ensureRow<T>(matrix: T[][], idx: number): void {
  while (matrix.length <= idx) matrix.push([] as unknown as T[]);
}

function isAllowed(btn: ButtonConfig, isAdmin: boolean): boolean {
  if (btn.role === 'admin') return isAdmin;
  return true; // 'user' or undefined
} 