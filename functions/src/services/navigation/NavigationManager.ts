import { logger } from 'firebase-functions';
import { KEYBOARDS } from './keyboards';
import { KeyboardConfig } from './keyboardTypes';
import { buildPersistentKeyboard, buildInlineKeyboard } from './KeyboardBuilder';
import { UserNavigationState } from './NavigationState';
import { findByTelegramId } from '../../repositories/userRepository';

interface TelegramContext {
  chatId: number;
  userId: string;
  reply: (text: string, extra?: any) => Promise<any>;
}

export class NavigationManager {
  private states: Map<string, UserNavigationState> = new Map();

  private state(userId: string): UserNavigationState {
    if (!this.states.has(userId)) {
      this.states.set(userId, {
        currentKeyboard: '',
        messageIds: [],
        data: {},
      });
    }
    return this.states.get(userId)!;
  }

  async showKeyboard(ctx: TelegramContext, keyboardId: string, message?: string): Promise<void> {
    const keyboard = KEYBOARDS[keyboardId];
    if (!keyboard) {
      logger.error(`Keyboard ${keyboardId} not found`);
      return;
    }

    const user = await findByTelegramId(ctx.userId);
    if (!user) {
      logger.error(`User ${ctx.userId} not found`);
      return;
    }

    if (keyboard.requiresAdmin && user.role !== 'admin') {
      logger.warn(`User ${ctx.userId} attempted to access admin keyboard ${keyboardId}`);
      return;
    }

    // Clean up previous messages
    await this.cleanup(ctx);

    // Build and send the keyboard
    const extra = keyboard.type === 'persistent'
      ? { reply_markup: buildPersistentKeyboard(keyboard, user.role === 'admin') }
      : { reply_markup: buildInlineKeyboard(keyboard, user.role === 'admin') };

    const sentMessage = await ctx.reply(message || keyboard.title || '', extra);
    this.track(ctx, sentMessage.message_id);

    // Update state
    const userState = this.state(ctx.userId);
    userState.currentKeyboard = keyboardId;
  }

  track(ctx: TelegramContext, messageId: number): void {
    const userState = this.state(ctx.userId);
    userState.messageIds.push(messageId);
  }

  async cleanup(ctx: TelegramContext): Promise<void> {
    const userState = this.state(ctx.userId);
    for (const messageId of userState.messageIds) {
      try {
        await ctx.reply('', { reply_markup: { remove_keyboard: true } });
      } catch (error) {
        logger.warn(`Failed to delete message ${messageId}:`, error);
      }
    }
    userState.messageIds = [];
  }
} 