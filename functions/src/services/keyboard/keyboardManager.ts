import { logger } from 'firebase-functions';
import { 
  KEYBOARDS, 
  KeyboardConfig,
  createReplyKeyboard, 
  createInlineKeyboard
} from '../../constants/keyboards';
import { findByTelegramId } from '../../repositories/userRepository';
import { UserRoles } from '../../utils/constants';

// Define the TelegramContext interface
export interface TelegramContext {
  chatId: string | number;
  userId: string | number;
  reply: (text: string, options?: {
    parse_mode?: string;
    reply_markup?: any;
    delete_message_id?: number;
    photo?: {
      source?: Buffer;
      url?: string;
    };
    caption?: string;
  }) => Promise<{ message_id: number }>;
}

// Define user state interface
export interface UserState {
  currentKeyboard: string;
  messageIds: number[];
  currentData?: any;
  userListPage?: number;
  editingUser?: any;
}

/**
 * Enhanced state management capabilities
 */
export interface KeyboardManagerOptions {
  transitionMap?: Record<string, Record<string, string>>;
}

/**
 * KeyboardManager - Handles the UI aspects of keyboard display and management
 * Focused on keyboard creation, display, and message tracking
 */
export class KeyboardManager {
  private userStates: Map<string, UserState> = new Map();
  private transitionMap: Record<string, Record<string, string>> = {
    // Default keyboard transitions for common actions
    'main_nav': {
      'admin_panel': 'admin_nav',
    },
    'admin_nav': {
      'edit_checkins': 'checkins_nav',
      'edit_checkouts': 'checkouts_nav',
      'manage_users': 'users_nav',
      'back_to_main': 'main_nav'
    },
    'checkins_nav': {
      'edit_checkouts': 'checkouts_nav',
      'admin_panel': 'admin_nav',
      'back_to_main': 'main_nav'
    },
    'checkouts_nav': {
      'edit_checkins': 'checkins_nav',
      'admin_panel': 'admin_nav',
      'back_to_main': 'main_nav'
    },
    'checkin_edit': {
      'back_to_checkins': 'checkins_nav',
      'back_to_main': 'main_nav'
    },
    'checkout_edit': {
      'back_to_checkouts': 'checkouts_nav',
      'back_to_main': 'main_nav'
    }
  };
  
  constructor(options?: KeyboardManagerOptions) {
    if (options?.transitionMap) {
      // Merge custom transitions with defaults
      this.transitionMap = {
        ...this.transitionMap,
        ...options.transitionMap
      };
    }
  }
  
  /**
   * Get or initialize user state
   */
  getUserState(userId: string | number): UserState {
    const userIdStr = String(userId);
    if (!this.userStates.has(userIdStr)) {
      this.userStates.set(userIdStr, {
        currentKeyboard: 'main_nav',
        messageIds: [],
        currentData: {
          date: new Date(),
          page: 1
        }
      });
    }
    return this.userStates.get(userIdStr)!;
  }

  /**
   * Transition to a new keyboard based on action
   * Returns the new keyboard ID or null if no transition found
   */
  transitionKeyboard(state: UserState, action: string): string | null {
    const currentKeyboard = state.currentKeyboard;
    
    // Check if we have a transition for this keyboard and action
    if (this.transitionMap[currentKeyboard] && 
        this.transitionMap[currentKeyboard][action]) {
      const newKeyboard = this.transitionMap[currentKeyboard][action];
      state.currentKeyboard = newKeyboard;
      return newKeyboard;
    }
    
    return null;
  }

  /**
   * Update user state with new data
   */
  updateUserState(userId: string | number, data: Partial<UserState>): void {
    const state = this.getUserState(userId);
    Object.assign(state, data);
  }

  /**
   * Store message ID for later cleanup
   */
  storeMessageId(userId: string | number, messageId: number): void {
    const state = this.getUserState(userId);
    state.messageIds.push(messageId);
    
    // Keep only last 5 message IDs to avoid excessive storage
    if (state.messageIds.length > 5) {
      state.messageIds = state.messageIds.slice(-5);
    }
  }

  /**
   * Try to delete a message
   */
  private async deleteMessage(ctx: TelegramContext, messageId: number): Promise<boolean> {
    try {
      await ctx.reply('', { delete_message_id: messageId });
      return true;
    } catch (err) {
      logger.warn(`[KeyboardManager] Couldn't delete message ${messageId}:`, err);
      return false;
    }
  }

  /**
   * Cleanup previous messages
   */
  async cleanupMessages(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    
    for (const messageId of state.messageIds) {
      await this.deleteMessage(ctx, messageId);
    }
    
    // Clear the stored message IDs
    state.messageIds = [];
  }

  /**
   * Process an action and transition keyboard state if needed
   * Returns true if a transition was applied
   */
  async processAction(ctx: TelegramContext, action: string): Promise<boolean> {
    const state = this.getUserState(ctx.userId);
    const newKeyboard = this.transitionKeyboard(state, action);
    
    if (newKeyboard) {
      await this.showKeyboard(ctx, newKeyboard);
      return true;
    }
    
    return false;
  }

  /**
   * Show a keyboard by ID
   * This can show either a persistent keyboard or an inline keyboard
   */
  async showKeyboard(ctx: TelegramContext, keyboardId: string, message?: string): Promise<void> {
    try {
      // Get user's admin status
      const user = await findByTelegramId(String(ctx.userId));
      const isAdmin = user?.role === UserRoles.ADMIN;
      
      // Get keyboard configuration
      const keyboardConfig = KEYBOARDS[keyboardId];
      if (!keyboardConfig) {
        logger.error(`[KeyboardManager] Keyboard with ID ${keyboardId} not found`);
        await ctx.reply('Клавіатуру не знайдено');
        return;
      }
      
      // Check if keyboard requires admin role
      if (keyboardConfig.requiresAdmin && !isAdmin) {
        logger.warn(`[KeyboardManager] User ${ctx.userId} tried to access admin keyboard ${keyboardId}`);
        await ctx.reply('У вас немає доступу до цього меню.');
        return;
      }
      
      // Update user state
      const state = this.getUserState(ctx.userId);
      state.currentKeyboard = keyboardId;
      
      // Generate the appropriate keyboard type
      let keyboard;
      if (keyboardConfig.type === 'persistent') {
        keyboard = createReplyKeyboard(keyboardConfig, isAdmin);
      } else {
        keyboard = createInlineKeyboard(keyboardConfig, isAdmin);
      }
      
      // Set default message if not provided
      const text = message || keyboardConfig.title || 'Виберіть опцію:';
      
      // Send keyboard
      const result = await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      
      // For inline keyboards, store the message ID for later cleanup
      if (keyboardConfig.type === 'inline') {
        this.storeMessageId(ctx.userId, result.message_id);
      }
      
    } catch (error) {
      logger.error(`[KeyboardManager] Error showing keyboard ${keyboardId}:`, error);
      await ctx.reply('Помилка при відображенні меню. Спробуйте пізніше.');
    }
  }
} 