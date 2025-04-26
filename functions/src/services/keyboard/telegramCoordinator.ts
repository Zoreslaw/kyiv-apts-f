import { logger } from 'firebase-functions';
import { KeyboardManager, TelegramContext } from './keyboardManager';
import { TaskHandler } from './handlers/taskHandler';
import { MyTasksHandler } from "./handlers/myTasksHandler";
import { UserHandler } from './handlers/userHandler';
import { TaskService } from '../taskService';
import { ActionHandler, ActionHandlerRegistry } from './actionHandler';
import { CleaningTaskHandler } from './handlers/cleaningTaskHandler';
import { MenuHandler } from './handlers/menuHandler'; 

// Task service interface to allow for dependency injection
export interface ITaskService {
  getTasksForUser(userId: string | number): Promise<any>;
  updateTaskStatus(taskId: string, status: string, userId: string): Promise<any>;
  getTaskById(taskId: string): Promise<any>;
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
 * TelegramCoordinator - Main coordinator for Telegram bot interactions
 * Responsible for routing actions to appropriate handlers and managing user state
 */
export class TelegramCoordinator {
  private keyboardManager: KeyboardManager;
  private actionRegistry: ActionHandlerRegistry;
  private handlers: ActionHandler[] = [];
  private userStates: Map<string, any> = new Map();

  /**
   * Resolve action from text based on current keyboard context
   */
  public resolveActionFromText(text: string, userId: string): string | null {
    return this.keyboardManager.resolveActionFromText(text, userId);
  }

  constructor(
    private taskService: TaskService,
    private userService?: ITaskService
  ) {
    this.keyboardManager = new KeyboardManager();
    this.actionRegistry = new ActionHandlerRegistry();
    
    // Initialize and register handlers
    this.initializeHandlers();
  }

  /**
   * Initialize all action handlers
   */
  private initializeHandlers(): void {
    // Create handlers with dependencies
    const menuHandler = new MenuHandler(this.keyboardManager);
    const userHandler = new UserHandler(this.keyboardManager);
    const taskHandler = new TaskHandler(this.taskService, this.keyboardManager);
    const myTasksHandler = new MyTasksHandler(this.taskService, this.keyboardManager);
    const cleaningTaskHandler = new CleaningTaskHandler(this.taskService, this.keyboardManager);
    
    // Store handlers for cleanup
    this.handlers = [
      menuHandler,
      userHandler,
      taskHandler,
      myTasksHandler,
      cleaningTaskHandler
    ];
    
    // Register common actions
    this.actionRegistry.registerDirectHandler('show_menu', menuHandler);
    this.actionRegistry.registerDirectHandler('help', menuHandler);
    this.actionRegistry.registerDirectHandler('about', menuHandler);
    this.actionRegistry.registerDirectHandler('admin_panel', menuHandler);
    this.actionRegistry.registerDirectHandler('back_to_main', menuHandler);
    
    // User management actions
    this.actionRegistry.registerDirectHandler('manage_users', userHandler);
    this.actionRegistry.registerRegexHandler(/^user/, userHandler);
    this.actionRegistry.registerRegexHandler(/^edit_user_/, userHandler);
    this.actionRegistry.registerRegexHandler(/^confirm_delete_user_/, userHandler);
    this.actionRegistry.registerRegexHandler(/^delete_user_/, userHandler);
    this.actionRegistry.registerRegexHandler(/^set_user_/, userHandler);
    
    // Task management actions
    this.actionRegistry.registerDirectHandler('edit_checkins', taskHandler);
    this.actionRegistry.registerDirectHandler('edit_checkouts', taskHandler);
    this.actionRegistry.registerRegexHandler(/^checkin_/, taskHandler);
    this.actionRegistry.registerRegexHandler(/^checkout_/, taskHandler);
    
    // My tasks actions
    this.actionRegistry.registerDirectHandler('show_tasks', myTasksHandler);
    this.actionRegistry.registerRegexHandler(/^show_tasks_/, myTasksHandler);
    this.actionRegistry.registerRegexHandler(/^task_detail_/, myTasksHandler);
    
    // Cleaning task actions
    this.actionRegistry.registerRegexHandler(/^(my|active|completed|page|edit|complete|start|cancel|back|report)_/, cleaningTaskHandler);
  }

  /**
   * Handle an action from user interaction
   * @param ctx Telegram context
   * @param actionData The action to handle
   * @returns True if action was handled, false otherwise
   */
  async handleAction(ctx: TelegramContext, actionData?: string): Promise<boolean> {
    if (!actionData) {
      return false;
    }
    
    try {
      logger.info(`[TelegramCoordinator] Handling action: ${actionData} for user ${ctx.userId}`);
      
      // Try to process keyboard transition
      const state = this.keyboardManager.getUserState(ctx.userId);
      const shouldTransition = await this.keyboardManager.processAction(ctx, actionData);
      
      if (shouldTransition) {
        logger.debug(`[TelegramCoordinator] Keyboard transition handled action: ${actionData}`);
        return true;
      }
      
      // Otherwise, delegate to registered handlers
      return await this.actionRegistry.handleAction(ctx, actionData);
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error handling action ${actionData}:`, error);
      await ctx.reply(`Помилка при обробці команди. Спробуйте пізніше.`);
      return false;
    }
  }

  /**
   * Process text input for current user state
   * @param ctx Telegram context
   * @param text The text to process
   * @returns True if text was handled as input, false if it should be treated as a message
   */
  async processText(ctx: TelegramContext, text: string): Promise<boolean> {
    // Find task handler for processing text input for tasks
    try {
      const taskHandler = this.handlers.find(h => h instanceof TaskHandler) as TaskHandler;
      if (taskHandler) {
        return await taskHandler.processTaskEdit(ctx, text);
      }
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error processing text input:`, error);
    }
    
    return false;
  }

  /**
   * Show a specific keyboard to the user
   */
  async showKeyboard(ctx: TelegramContext, keyboardId: string, message?: string): Promise<void> {
    await this.keyboardManager.showKeyboard(ctx, keyboardId, message);
  }

  /**
   * Get user state
   */
  getUserState(userId: string | number): any {
    return this.keyboardManager.getUserState(userId);
  }

  /**
   * Clean up messages for a user
   */
  async cleanupMessages(ctx: TelegramContext): Promise<void> {
    await this.keyboardManager.cleanupMessages(ctx);
  }
}