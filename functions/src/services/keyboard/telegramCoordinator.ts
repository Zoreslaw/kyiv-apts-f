import { logger } from 'firebase-functions';
import { KeyboardManager, TelegramContext } from './keyboardManager';
import { TaskHandler } from './handlers/taskHandler';
import { MyTasksHandler } from "./handlers/myTasksHandler";
import { UserHandler } from './handlers/userHandler';
import { TaskService } from '../taskService';
import { ActionHandler, ActionHandlerRegistry } from './actionHandler';
import { MenuHandler } from './handlers/menuHandler';
import {clearSession, setSession} from "../sessionStore";
import {TelegramMessage} from "../telegramService";

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
  private myTasksHandler!: MyTasksHandler;
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
    this.myTasksHandler = myTasksHandler;
    // Store handlers for cleanup
    this.handlers = [
      menuHandler,
      userHandler,
      taskHandler,
      myTasksHandler,
    ];
    
    // Register common actions
    this.actionRegistry.registerDirectHandler('show_menu', menuHandler);
    this.actionRegistry.registerDirectHandler('help', menuHandler);
    this.actionRegistry.registerDirectHandler('about', menuHandler);
    this.actionRegistry.registerDirectHandler('admin_panel', menuHandler);
    this.actionRegistry.registerDirectHandler('back_to_main', menuHandler);
    
    // User management actions
    this.actionRegistry.registerDirectHandler('manage_users', userHandler);
    this.actionRegistry.registerDirectHandler('back_to_users', userHandler);
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
    this.actionRegistry.registerRegexHandler(/^show_checkin_edit_/, taskHandler);
    this.actionRegistry.registerRegexHandler(/^show_checkout_edit_/, taskHandler);
    
    // Add regex handlers for action formats with embedded task IDs
    this.actionRegistry.registerRegexHandler(/^edit_checkin_time_/, taskHandler);
    this.actionRegistry.registerRegexHandler(/^edit_checkin_keys_/, taskHandler);
    this.actionRegistry.registerRegexHandler(/^edit_checkin_money_/, taskHandler);
    this.actionRegistry.registerRegexHandler(/^edit_checkout_time_/, taskHandler);
    this.actionRegistry.registerRegexHandler(/^edit_checkout_keys_/, taskHandler);
    this.actionRegistry.registerRegexHandler(/^edit_checkout_money_/, taskHandler);
    
    // Add navigation action handlers
    this.actionRegistry.registerDirectHandler('prev_checkin_day', taskHandler);
    this.actionRegistry.registerDirectHandler('next_checkin_day', taskHandler);
    this.actionRegistry.registerDirectHandler('prev_checkout_day', taskHandler);
    this.actionRegistry.registerDirectHandler('next_checkout_day', taskHandler);
    this.actionRegistry.registerDirectHandler('cancel_checkin_edit', taskHandler);
    this.actionRegistry.registerDirectHandler('cancel_checkout_edit', taskHandler);
    this.actionRegistry.registerDirectHandler('back_to_checkins', taskHandler);
    this.actionRegistry.registerDirectHandler('back_to_checkouts', taskHandler);
    
    // My tasks actions
    this.actionRegistry.registerDirectHandler('show_tasks', myTasksHandler);
    this.actionRegistry.registerRegexHandler(/^show_tasks_/, myTasksHandler);
    this.actionRegistry.registerRegexHandler(/^task_detail_/, myTasksHandler);
    this.actionRegistry.registerRegexHandler(/^mark_done_/, myTasksHandler);
    this.actionRegistry.registerRegexHandler(/^report_dirty_/, myTasksHandler);
    this.actionRegistry.registerRegexHandler(/^report_issue_/, myTasksHandler);
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

      // Only reset edit state for actions that shouldn't inherit previous task selection
      const state = this.keyboardManager.getUserState(ctx.userId);
      
      // Create a list of actions that should preserve task editing state
      const preserveTaskStateActions = [
        'show_checkin_edit_', 'show_checkout_edit_'
      ];
      
      // Don't reset task selection for edit actions with task IDs either
      const preserveRegexPatterns = [
        /^edit_checkin_time_/,
        /^edit_checkin_keys_/,
        /^edit_checkin_money_/,
        /^edit_checkout_time_/,
        /^edit_checkout_keys_/,
        /^edit_checkout_money_/
      ];
      
      // Don't reset task selection for edit actions
      const shouldResetTaskState = !(
        preserveTaskStateActions.some(prefix => 
          actionData.startsWith(prefix) || actionData === prefix
        ) ||
        preserveRegexPatterns.some(regex => regex.test(actionData))
      );
      
      if (state && state.currentData && shouldResetTaskState) {
        logger.debug(`[TelegramCoordinator] Resetting edit state for action: ${actionData}`);
        state.currentData.editMode = false;
        state.currentData.editingField = null;
        state.currentData.selectedTaskId = null;
      } else {
        logger.debug(`[TelegramCoordinator] Preserving edit state for action: ${actionData}`);
      }
      
      // Try to process keyboard transition
      const shouldTransition = await this.keyboardManager.processAction(ctx, actionData);
      
      // For most actions, if there was a transition, we're done
      // But for certain actions, we need to also delegate to the handler
      const mustDelegateActions = [
        'edit_checkins', 'edit_checkouts',
        'prev_checkin_day', 'next_checkin_day',
        'prev_checkout_day', 'next_checkout_day',
        'back_to_checkins', 'back_to_checkouts',
        'back_to_users', 'manage_users', 'cancel_user_edit'
      ];
      
      if (shouldTransition && !mustDelegateActions.includes(actionData)) {
        logger.debug(`[TelegramCoordinator] Keyboard transition handled action: ${actionData}`);
        return true;
      }
      
      if (shouldTransition) {
        logger.debug(`[TelegramCoordinator] Keyboard transition occurred, but still delegating action: ${actionData}`);
      }
      
      // Delegate to registered handlers
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

  async handleIncomingMessage(ctx: TelegramContext): Promise<void> {
    const knownNavigationButtons = [
      { text: '📋 Мої завдання', action: 'show_tasks' },
      { text: '⚙️ Меню', action: 'show_menu' },
      { text: '❓ Допомога', action: 'help' },
      { text: 'ℹ️ Про бота', action: 'about' },
      { text: '👨‍💼 Адмін панель', action: 'admin_panel' }
    ];

    const message = ctx.message as TelegramMessage;

    logger.info(`[handleIncomingMessage] Incoming message for user=${ctx.userId}`);
    logger.info(`[handleIncomingMessage] ctx.session: ${JSON.stringify(ctx.session)}`);
    logger.info(`[handleIncomingMessage] ctx.message: ${JSON.stringify(ctx.message)}`);

    if (ctx.session?.isProblemReport && ctx.message?.text) {
      const problemComment = ctx.message.text;

      logger.info(`[handleIncomingMessage] Received problem report comment: ${problemComment}`);

      await this.myTasksHandler.updateTaskNotes(ctx.session.reservationIdForPhoto!, problemComment);
      clearSession(String(ctx.userId));

      await ctx.reply('✅ Проблему збережено! Дякуємо за повідомлення.');
      await this.showKeyboard(ctx, 'main_nav');
      return;
    }

    if (ctx.session?.waitingForPhoto) {
      if (ctx.message?.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        ctx.session.collectedPhotos!.push(photo.file_id);

        if (message.caption) {
          ctx.session.comment = (ctx.session.comment || '') + ' ' + message.caption;
        }

        setSession(String(ctx.userId), ctx.session);
        return;
      }

      if (ctx.message?.text) {
        const comment = ctx.message.text;
        ctx.session.comment = (ctx.session.comment || '') + ' ' + comment;
        setSession(String(ctx.userId), ctx.session);

        logger.info(`[handleIncomingMessage] Received cleaning comment: ${comment}`);
        await ctx.reply(`📝 Коментар отримано: "${comment}"`);
        return;
      }

      await ctx.reply(`⚠️ Будь ласка, надішліть фото або коментар.`);
      return;
    }
  }
}