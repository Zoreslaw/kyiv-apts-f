import { logger } from 'firebase-functions';
import { KeyboardManager, TelegramContext, UserState } from './keyboardManager';
import { TaskHandler } from './handlers/taskHandler';
import { UserHandler } from './handlers/userHandler';
import { TaskService } from '../taskService';
import {
  createTaskDisplayKeyboard,
  createTaskEditButtons,
  formatTaskDetailText,
  TaskDisplayKeyboardOptions
} from '../../constants/keyboards';
import { ActionHandler } from './actionHandler';

// Define minimal interfaces for services
interface ITaskService {
  // Add methods as needed
}

/**
 * Simple action registry class 
 */
class ActionRegistry {
  registerHandler(handler: ActionHandler): void {
    // Simple registration - in the new architecture, this is just a stub
    // as we're using direct delegation
  }
}

/**
 * TelegramCoordinator - Coordinates all telegram bot interactions
 * Acts as the entry point for telegram actions and dispatches them to appropriate handlers
 */
export class TelegramCoordinator {
  private keyboardManager: KeyboardManager;
  private actionRegistry: ActionRegistry;
  private handlers: ActionHandler[] = [];
  
  constructor(
    private taskService: TaskService,
    private userService?: ITaskService
  ) {
    this.keyboardManager = new KeyboardManager();
    this.actionRegistry = new ActionRegistry();
    
    // Add handlers
    const taskHandler = new TaskHandler(taskService, this.keyboardManager);
    const userHandler = new UserHandler(this.keyboardManager);
    
    this.handlers = [
      taskHandler,
      userHandler
    ];
    
    // Register handlers with action registry
    this.actionRegistry.registerHandler(taskHandler);
    this.actionRegistry.registerHandler(userHandler);
  }
  
  /**
   * Handle user action (from text command or callback query)
   */
  async handleAction(ctx: TelegramContext, actionData?: string): Promise<boolean> {
    if (!actionData) {
      return false;
    }
    
    logger.info(`[TelegramCoordinator] Handling action: ${actionData} for user ${ctx.userId}`);
    
    // Special case handlers for common actions that need immediate response
    if (actionData === 'help') {
      await this.showHelp(ctx);
      return true;
    }
    
    if (actionData === 'about') {
      await this.showAbout(ctx);
      return true;
    }
    
    if (actionData === 'show_menu') {
      await this.showMenu(ctx);
      return true;
    }
    
    if (actionData === 'admin_panel') {
      await this.showAdminPanel(ctx);
      return true;
    }
    
    if (actionData === 'back_to_main') {
      await this.backToMainMenu(ctx);
      return true;
    }
    
    // Handle task display actions explicitly since they need to show content
    if (actionData === 'edit_checkins') {
      logger.info(`[TelegramCoordinator] Transitioning for action: ${actionData}`);
      await this.keyboardManager.showKeyboard(ctx, 'checkins_nav', 'Керування заїздами');
      
      // Find task handler and call its showCheckIns method
      const taskHandler = this.handlers.find(h => h instanceof TaskHandler) as TaskHandler;
      if (taskHandler && 'showCheckIns' in taskHandler) {
        await (taskHandler as any).showCheckIns(ctx);
      }
      return true;
    }
    
    if (actionData === 'edit_checkouts') {
      logger.info(`[TelegramCoordinator] Transitioning for action: ${actionData}`);
      await this.keyboardManager.showKeyboard(ctx, 'checkouts_nav', 'Керування виїздами');
      
      // Find task handler and call its showCheckOuts method
      const taskHandler = this.handlers.find(h => h instanceof TaskHandler) as TaskHandler;
      if (taskHandler && 'showCheckOuts' in taskHandler) {
        await (taskHandler as any).showCheckOuts(ctx);
      }
      return true;
    }
    
    if (actionData === 'manage_users') {
      logger.info(`[TelegramCoordinator] Transitioning for action: ${actionData}`);
      await this.keyboardManager.showKeyboard(ctx, 'users_nav', 'Керування користувачами');
      
      // Find user handler and call its showUsers method
      const userHandler = this.handlers.find(h => h instanceof UserHandler) as UserHandler;
      if (userHandler && 'showUsers' in userHandler) {
        await (userHandler as any).showUsers(ctx);
      }
      return true;
    }
    
    if (actionData === 'manage_apartments') {
      logger.info(`[TelegramCoordinator] Transitioning for action: ${actionData}`);
      await this.keyboardManager.showKeyboard(ctx, 'apartments_nav', 'Керування квартирами');
      
      // Call apartments display method if it exists
      return true;
    }
    
    // Check if we can process this action via keyboard transitions
    const didTransition = await this.keyboardManager.processAction(ctx, actionData);
    if (didTransition) {
      logger.info(`[TelegramCoordinator] Keyboard transition processed for action: ${actionData}`);
      return true;
    }
    
    // If no transition was found, try delegating to a handler
    for (const handler of this.handlers) {
      try {
        await handler.handleAction(ctx, actionData);
        return true;
      } catch (error) {
        logger.warn(`[TelegramCoordinator] Handler error for action ${actionData}:`, error);
        // Continue with next handler
      }
    }
    
    logger.info(`[TelegramCoordinator] No handler found for action: ${actionData}`);
    return false;
  }
  
  /**
   * Process text input from the user
   */
  async processText(ctx: TelegramContext, text: string): Promise<boolean> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    // Check if in task edit mode
    if (state.currentData?.selectedTaskId && state.currentData?.editingField) {
      if (state.currentKeyboard === 'checkin_edit' || state.currentKeyboard === 'checkout_edit') {
        // Find the TaskHandler and use it to process the text
        const taskHandler = this.handlers.find(h => h instanceof TaskHandler);
        if (taskHandler && 'processTaskEdit' in taskHandler) {
          return (taskHandler as any).processTaskEdit(ctx, text);
        }
      }
    }
    
    // Check if in user edit mode
    if (state.currentData?.addingUser) {
      // Find the UserHandler and use it to process the text
      const userHandler = this.handlers.find(h => h instanceof UserHandler);
      if (userHandler && 'processUserText' in userHandler) {
        return (userHandler as any).processUserText(ctx, text);
      }
    }
    
    return false;
  }
  
  /**
   * Show the main menu
   */
  private async showMenu(ctx: TelegramContext): Promise<void> {
    await this.keyboardManager.cleanupMessages(ctx);
    await this.keyboardManager.showKeyboard(ctx, 'main_nav');
  }
  
  /**
   * Show help information
   */
  private async showHelp(ctx: TelegramContext): Promise<void> {
    const text = `🤖 *Доступні команди:*

📋 *Мої завдання* - переглянути список завдань
⚙️ *Меню* - відкрити головне меню
❓ *Допомога* - показати це повідомлення
ℹ️ *Про бота* - інформація про бота`;

    const message = await ctx.reply(text, { parse_mode: "Markdown" });
    this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
  }
  
  /**
   * Show about information
   */
  private async showAbout(ctx: TelegramContext): Promise<void> {
    const text = `🤖 *Бот для управління завданнями*

Цей бот допомагає керувати заїздами та виїздами гостей.

Версія: 1.0.0`;

    const message = await ctx.reply(text, { parse_mode: "Markdown" });
    this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
  }
  
  /**
   * Show admin panel
   */
  private async showAdminPanel(ctx: TelegramContext): Promise<void> {
    await this.keyboardManager.cleanupMessages(ctx);
    await this.keyboardManager.showKeyboard(ctx, 'admin_nav', '👨‍💼 *Адмін панель*\n\nОберіть операцію:');
  }
  
  /**
   * Go back to main menu
   */
  private async backToMainMenu(ctx: TelegramContext): Promise<void> {
    await this.showMenu(ctx);
  }
  
  /**
   * Show keyboard by ID
   */
  async showKeyboard(ctx: TelegramContext, keyboardId: string, message?: string): Promise<void> {
    await this.keyboardManager.showKeyboard(ctx, keyboardId, message);
  }
  
  /**
   * Get user state
   */
  getUserState(userId: string | number): UserState {
    return this.keyboardManager.getUserState(userId);
  }
  
  /**
   * Clean up messages
   */
  async cleanupMessages(ctx: TelegramContext): Promise<void> {
    await this.keyboardManager.cleanupMessages(ctx);
  }
}
