import { logger } from 'firebase-functions';
import { TelegramContext } from './keyboardManager';
import { findByTelegramId } from '../../repositories/userRepository';
import { UserRoles } from '../../utils/constants';
import { KEYBOARDS } from '../../constants/keyboards';

/**
 * Interface defining a handler for keyboard actions
 */
export interface ActionHandler {
  handleAction(ctx: TelegramContext, actionData?: string): Promise<void>;
}

/**
 * Registry for action handlers
 * Maps action patterns to their handlers
 */
export class ActionHandlerRegistry {
  private directHandlers: Map<string, ActionHandler> = new Map();
  private regexHandlers: Map<RegExp, ActionHandler> = new Map();
  
  /**
   * Register a handler for a specific action
   */
  registerDirectHandler(action: string, handler: ActionHandler): void {
    this.directHandlers.set(action, handler);
    logger.debug(`[ActionHandlerRegistry] Registered direct handler for: ${action}`);
  }
  
  /**
   * Register a handler for actions matching a regex pattern
   */
  registerRegexHandler(pattern: RegExp, handler: ActionHandler): void {
    this.regexHandlers.set(pattern, handler);
    logger.debug(`[ActionHandlerRegistry] Registered regex handler for: ${pattern}`);
  }
  
  /**
   * Find a handler for an action, including regex handlers
   */
  findHandler(action: string): ActionHandler | undefined {
    // First try direct match
    if (this.directHandlers.has(action)) {
      logger.debug(`[ActionHandlerRegistry] Found direct handler for: ${action}`);
      return this.directHandlers.get(action);
    }
    
    // If no direct match, try regex handlers
    for (const [pattern, handler] of this.regexHandlers.entries()) {
      if (pattern.test(action)) {
        logger.debug(`[ActionHandlerRegistry] Found regex handler for: ${action}, pattern: ${pattern}`);
        return handler;
      }
    }
    
    logger.debug(`[ActionHandlerRegistry] No handler found for: ${action}`);
    return undefined;
  }
  
  /**
   * Process action with appropriate authorization check
   */
  async handleAction(ctx: TelegramContext, action: string): Promise<boolean> {
    try {
      logger.info(`[ActionHandlerRegistry] Handling action: ${action} for user ${ctx.userId}`);
      
      // Find the handler for this action
      const handler = this.findHandler(action);
      if (!handler) {
        logger.warn(`[ActionHandlerRegistry] No handler found for action: ${action}`);
        return false;
      }
      
      // Get user's admin status
      const user = await findByTelegramId(String(ctx.userId));
      const isAdmin = user?.role === UserRoles.ADMIN;
      
      // Check if the action is for an admin-only keyboard
      const actionParts = action.split('_');
      const possibleKeyboardId = actionParts[0] + '_' + actionParts[1]; // e.g., "admin_panel"
      const keyboard = KEYBOARDS[possibleKeyboardId];
      
      if (keyboard && keyboard.requiresAdmin && !isAdmin) {
        logger.warn(`[ActionHandlerRegistry] User ${ctx.userId} tried to access admin action: ${action}`);
        await ctx.reply('У вас немає доступу до цієї функції.');
        return false;
      }
      
      // If the action requires admin, check role
      if (action.startsWith('admin_') && !isAdmin) {
        logger.warn(`[ActionHandlerRegistry] User ${ctx.userId} tried to access admin action: ${action}`);
        await ctx.reply('У вас немає доступу до цієї функції.');
        return false;
      }
      
      // Execute the handler
      await handler.handleAction(ctx, action);
      return true;
    } catch (error) {
      logger.error(`[ActionHandlerRegistry] Error handling action ${action}:`, error);
      await ctx.reply('Помилка при обробці команди. Спробуйте пізніше.');
      return false;
    }
  }
} 