import { logger } from 'firebase-functions';
import { KeyboardManager, TelegramContext, UserState } from './keyboardManager';
import { TaskHandler } from './handlers/taskHandler';
import { MyTasksHandler } from "./handlers/myTasksHandler";
import { UserHandler } from './handlers/userHandler';
import { createTaskDateSelectorKeyboard } from '../../constants/keyboards';


// import { ApartmentHandler } from './handlers/apartmentHandler';
import { TaskService } from '../taskService';
import {
  createTaskDisplayKeyboard,
  createTaskEditButtons,
  formatTaskDetailText,
  TaskDisplayKeyboardOptions,
  createCleaningTaskDisplayKeyboard,
  formatCleaningTaskDetailText,
  CleaningTaskDisplayOptions,
  CLEANING_TASKS_NAVIGATION,
  CLEANING_TASK_EDIT_KEYBOARD,
  CLEANING_TASK_DETAIL_KEYBOARD,
  createInlineKeyboard
} from '../../constants/keyboards';
import { ActionHandler } from './actionHandler';
import { Timestamp } from 'firebase-admin/firestore';
import { TaskStatus, TaskTypes } from '../../utils/constants';
import { 
  findTasksByUserId as findTasksByUserAndType,
  findById as findTaskById,
  updateTask
} from '../../repositories/taskRepository';
import { Task } from '../../models/Task';

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

  public resolveActionFromText(text: string, userId: string): string | null {
    return this.keyboardManager.resolveActionFromText(text, userId);
  }

  constructor(
    private taskService: TaskService,
    private userService?: ITaskService
  ) {
    this.keyboardManager = new KeyboardManager();
    this.actionRegistry = new ActionRegistry();
    
    // Initialize handlers
    const taskHandler = new TaskHandler(taskService, this.keyboardManager);
    this.handlers.push(taskHandler);

    const myTasksHandler = new MyTasksHandler(taskService, this.keyboardManager);
    this.handlers.push(myTasksHandler);

    // Add handlers
    const userHandler = new UserHandler(this.keyboardManager);
    // const apartmentHandler = new ApartmentHandler(this.keyboardManager);
    
    this.handlers = [
      taskHandler,
      myTasksHandler,
      userHandler
    //   apartmentHandler
    ];
    
    // Register handlers with action registry
    this.handlers.forEach(handler => {
      this.actionRegistry.registerHandler(handler);
    });
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

    if (actionData === 'show_tasks') {
      const myTaskHandler = this.handlers.find(h => h instanceof MyTasksHandler) as MyTasksHandler;
      if (myTaskHandler) {
        await myTaskHandler.showTaskSelectorWithSummary(ctx);
      }
      return true;
    }

    if (actionData === 'show_tasks_today') {
      const myTaskHandler = this.handlers.find(h => h instanceof MyTasksHandler) as MyTasksHandler;
      if (myTaskHandler) {
        const today = new Date();
        await myTaskHandler.showTasksForDate(ctx, today);
      }
      return true;
    }

    if (actionData === 'show_tasks_tomorrow') {
      const myTaskHandler = this.handlers.find(h => h instanceof MyTasksHandler) as MyTasksHandler;
      if (myTaskHandler) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        await myTaskHandler.showTasksForDate(ctx, tomorrow);
      }
      return true;
    }

    const pageMatch = /^show_tasks_page_(\d+)$/.exec(actionData);
    if (pageMatch) {
      const page = parseInt(pageMatch[1], 10);
      const myTaskHandler = this.handlers.find(h => h instanceof MyTasksHandler) as MyTasksHandler;
      if (myTaskHandler) {
        logger.info(`[Coordinator] Pagination for page ${page}`);
        await myTaskHandler.showTaskSelectorWithSummary(ctx, page);
      }
      return true;
    }

    const taskDetailMatch = /^task_detail_(\w+)$/.exec(actionData);
    if (taskDetailMatch) {
      const taskId = taskDetailMatch[1];
      const myTaskHandler = this.handlers.find(h => h instanceof MyTasksHandler) as MyTasksHandler;
      if (myTaskHandler) {
        await myTaskHandler.showTaskDetails(ctx, taskId);
      }
      return true;
    }

    // Handle cleaning task actions
    if (actionData === 'show_my_tasks' || actionData === 'show_cleaning_tasks') {
      await this.showMyCleaningTasks(ctx);
      return true;
    }
    
    if (actionData === 'show_active_tasks') {
      await this.showActiveCleaningTasks(ctx);
      return true;
    }
    
    if (actionData === 'show_completed_tasks') {
      await this.showCompletedCleaningTasks(ctx);
      return true;
    }
    
    if (actionData === 'cancel_cleaning_edit') {
      await this.cancelCleaningTaskEdit(ctx);
      return true;
    }
    
    if (actionData === 'back_to_tasks') {
      await this.backToCleaningTasksList(ctx);
      return true;
    }
    
    if (actionData === 'complete_task') {
      await this.completeCleaningTask(ctx);
      return true;
    }
    
    if (actionData === 'start_task') {
      await this.startCleaningTask(ctx);
      return true;
    }
    
    if (actionData === 'cancel_task') {
      await this.cancelCleaningTask(ctx);
      return true;
    }
    
    if (actionData === 'report_problem') {
      await this.reportCleaningProblem(ctx);
      return true;
    }
    
    if (actionData === 'report_dirty') {
      await this.reportCleaningDirty(ctx);
      return true;
    }
    
    // Handle regex patterns for cleaning tasks
    const cleaningPageMatch = /^cleaning_page_(\d+)$/.exec(actionData);
    if (cleaningPageMatch) {
      await this.showCleaningTaskPage(ctx, parseInt(cleaningPageMatch[1]));
      return true;
    }
    
    const showEditMatch = /^show_cleaning_edit_(\d+)$/.exec(actionData);
    if (showEditMatch) {
      await this.showCleaningEditMode(ctx, parseInt(showEditMatch[1]));
      return true;
    }
    
    const editTaskMatch = /^edit_cleaning_task_(.+)$/.exec(actionData);
    if (editTaskMatch) {
      await this.editCleaningTask(ctx, editTaskMatch[1]);
      return true;
    }
    
    // Handle user-related actions first
    if (actionData.startsWith('user_page_') || 
        actionData === 'cancel_user_edit' || 
        actionData === 'back_to_users' ||
        actionData.startsWith('edit_user_') ||
        actionData.startsWith('confirm_delete_user_') ||
        actionData.startsWith('delete_user_confirmed_') ||
        actionData.startsWith('set_user_role_') ||
        actionData.startsWith('set_user_status_')) {
      const userHandler = this.handlers.find(h => h instanceof UserHandler) as UserHandler;
      if (userHandler) {
        await userHandler.handleAction(ctx, actionData);
        return true;
      }
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
      if (userHandler) {
        await userHandler.showUsers(ctx);
      }
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
      // Find the TaskHandler and use it to process the text
      const taskHandler = this.handlers.find(h => h instanceof TaskHandler);
      if (taskHandler && 'processTaskEdit' in taskHandler) {
        return (taskHandler as any).processTaskEdit(ctx, text);
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
  private async showMenu(ctx: TelegramContext, preserveMessages: boolean = false): Promise<void> {
    //await this.keyboardManager.cleanupMessages(ctx);
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
  
  /**
   * Show all cleaning tasks for the current user
   */
  private async showMyCleaningTasks(ctx: TelegramContext): Promise<void> {
    try {
      // Get tasks for the current user
      const tasks = await findTasksByUserAndType(String(ctx.userId));
      
      // Filter active tasks
      const activeTasks = tasks.filter(task => 
        task.status === TaskStatus.PENDING || 
        task.status === TaskStatus.IN_PROGRESS
      );
      
      // Generate message text
      let text = `*Ваші завдання на сьогодні:*\n\n`;
      
      if (activeTasks.length === 0) {
        text += "Немає активних завдань.";
      } else {
        activeTasks.forEach((task: Task) => {
          const statusEmoji = task.status === TaskStatus.IN_PROGRESS ? '⏳' : '⏰';
          text += `${statusEmoji} *${task.apartmentId}*\n`;
          text += `📍 ${task.address}\n`;
          if (task.dueDate) {
            const date = task.dueDate instanceof Timestamp ? task.dueDate.toDate() : new Date(task.dueDate);
            text += `⏰ ${date.toLocaleDateString()}\n`;
          }
          if (task.notes) {
            text += `📝 ${task.notes}\n`;
          }
          text += '\n';
        });
      }
      
      // Clean up previous messages
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Show the cleaning tasks navigation keyboard
      await this.keyboardManager.showKeyboard(ctx, CLEANING_TASKS_NAVIGATION.id);
      
      // Send message with tasks
      const message = await ctx.reply(text, {
        parse_mode: 'Markdown'
      });
      
      // Store message ID for cleanup
      this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error showing cleaning tasks:`, error);
      await ctx.reply('Помилка при отриманні завдань. Спробуйте пізніше.');
    }
  }
  
  /**
   * Show active cleaning tasks
   */
  private async showActiveCleaningTasks(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = state.currentData.page || 1;
    state.currentData.taskStatus = TaskStatus.PENDING;
    
    await this.showCleaningTasksList(ctx, state.currentData.page, [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]);
  }
  
  /**
   * Show completed cleaning tasks
   */
  private async showCompletedCleaningTasks(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = state.currentData.page || 1;
    state.currentData.taskStatus = TaskStatus.COMPLETED;
    
    await this.showCleaningTasksList(ctx, state.currentData.page, [TaskStatus.COMPLETED]);
  }
  
  /**
   * Show cleaning tasks list with pagination
   */
  private async showCleaningTasksList(
    ctx: TelegramContext, 
    page: number = 1,
    statuses: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]
  ): Promise<void> {
    try {
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Get tasks for the current user
      const tasks = await findTasksByUserAndType(String(ctx.userId));
      
      // Filter by status
      const filteredTasks = tasks.filter(task => statuses.includes(task.status as TaskStatus));
      
      const PAGE_SIZE = 5;
      const totalTasks = filteredTasks.length;
      const totalPages = Math.ceil(totalTasks / PAGE_SIZE);
      const startIdx = (page - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalTasks);
      
      const pageTasks = filteredTasks.slice(startIdx, endIdx);
      
      // Generate message text
      let text = `*Завдання на прибирання ${page}/${totalPages || 1}:*\n\n`;
      
      if (pageTasks.length === 0) {
        text += "Немає завдань.";
      } else {
        pageTasks.forEach((task: Task) => {
          const statusEmoji = task.status === TaskStatus.COMPLETED ? '✅' : 
                            task.status === TaskStatus.IN_PROGRESS ? '⏳' : '⏰';
          
          text += `${statusEmoji} *${task.apartmentId}*\n`;
          text += `📍 ${task.address}\n`;
          if (task.dueDate) {
            const date = task.dueDate instanceof Timestamp ? task.dueDate.toDate() : new Date(task.dueDate);
            text += `⏰ ${date.toLocaleDateString()}\n`;
          }
          if (task.notes) {
            text += `📝 ${task.notes}\n`;
          }
          text += '\n';
        });
      }
      
      // Create keyboard options
      const keyboardOptions: CleaningTaskDisplayOptions = {
        tasks: pageTasks,
        page,
        totalPages,
        status: statuses[0],
        forEditing: false
      };
      
      // Create keyboard
      const keyboard = createCleaningTaskDisplayKeyboard(keyboardOptions);
      
      // Send message with keyboard
      const message = await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard({
          id: 'cleaning_tasks',
          type: 'inline',
          buttons: keyboard
        })
      });
      
      // Store message ID for cleanup
      this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error showing cleaning tasks list:`, error);
      await ctx.reply('Помилка при отриманні завдань. Спробуйте пізніше.');
    }
  }
  
  /**
   * Show cleaning task page
   */
  private async showCleaningTaskPage(ctx: TelegramContext, page: number): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    await this.showCleaningTasksList(ctx, page, [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]);
  }
  
  /**
   * Show cleaning task edit mode
   */
  private async showCleaningEditMode(ctx: TelegramContext, page: number): Promise<void> {
    try {
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Get tasks for the current user
      const tasks = await findTasksByUserAndType(String(ctx.userId));
      
      // Filter active tasks
      const activeTasks = tasks.filter(task => 
        task.status === TaskStatus.PENDING || 
        task.status === TaskStatus.IN_PROGRESS
      );
      
      const PAGE_SIZE = 5;
      const totalTasks = activeTasks.length;
      const totalPages = Math.ceil(totalTasks / PAGE_SIZE);
      const startIdx = (page - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalTasks);
      
      const pageTasks = activeTasks.slice(startIdx, endIdx);
      
      // Generate message text
      let text = `*Редагування завдань на прибирання ${page}/${totalPages || 1}:*\n\n`;
      
      if (pageTasks.length === 0) {
        text += "Немає завдань для редагування.";
      } else {
        pageTasks.forEach((task: Task) => {
          const statusEmoji = task.status === TaskStatus.IN_PROGRESS ? '⏳' : '⏰';
          
          text += `${statusEmoji} *${task.apartmentId}*\n`;
          text += `📍 ${task.address}\n`;
          if (task.dueDate) {
            const date = task.dueDate instanceof Timestamp ? task.dueDate.toDate() : new Date(task.dueDate);
            text += `⏰ ${date.toLocaleDateString()}\n`;
          }
          if (task.notes) {
            text += `📝 ${task.notes}\n`;
          }
          text += '\n';
        });
      }
      
      // Create keyboard options
      const keyboardOptions: CleaningTaskDisplayOptions = {
        tasks: pageTasks,
        page,
        totalPages,
        status: TaskStatus.PENDING,
        forEditing: true
      };
      
      // Create keyboard
      const keyboard = createCleaningTaskDisplayKeyboard(keyboardOptions);
      
      // Send message with keyboard
      const message = await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard({
          id: 'cleaning_tasks',
          type: 'inline',
          buttons: keyboard
        })
      });
      
      // Store message ID for cleanup
      this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error showing cleaning edit mode:`, error);
      await ctx.reply('Помилка при відображенні режиму редагування. Спробуйте пізніше.');
    }
  }
  
  /**
   * Edit cleaning task
   */
  private async editCleaningTask(ctx: TelegramContext, taskId: string): Promise<void> {
    try {
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Get task by ID
      const task = await findTaskById(taskId);
      if (!task) {
        await ctx.reply('Завдання не знайдено.');
        return;
      }
      
      // Update user state
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData) {
        state.currentData = {};
      }
      
      state.currentData.selectedTaskId = taskId;
      state.currentData.editingField = null;
      
      // Generate task detail text
      const detailText = formatCleaningTaskDetailText(task);
      
      // Create edit buttons
      const editButtons = [
        { text: '✅ Завершити', action: 'complete_task' },
        { text: '⏳ Почати', action: 'start_task' },
        { text: '❌ Скасувати', action: 'cancel_task' },
        { text: '⚠️ Повідомити про проблему', action: 'report_problem' },
        { text: '🧹 Повідомити про бруд', action: 'report_dirty' },
        { text: '⬅️ Назад', action: 'back_to_tasks' }
      ];
      
      // Send message with task details and edit buttons
      const message = await ctx.reply(detailText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(editButtons)
      });
      
      // Store message ID for cleanup
      this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error editing cleaning task:`, error);
      await ctx.reply('Помилка при редагуванні завдання. Спробуйте пізніше.');
    }
  }
  
  /**
   * Complete cleaning task
   */
  private async completeCleaningTask(ctx: TelegramContext): Promise<void> {
    try {
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData || !state.currentData.selectedTaskId) {
        await ctx.reply('Завдання не вибрано.');
        return;
      }
      
      const taskId = state.currentData.selectedTaskId;
      
      // Update task status
      await updateTask(taskId, {
        status: TaskStatus.COMPLETED,
        updatedAt: Timestamp.now(),
        updatedBy: String(ctx.userId)
      });
      
      await ctx.reply('✅ Завдання успішно завершено!');
      
      // Go back to tasks list
      await this.backToCleaningTasksList(ctx);
      
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error completing cleaning task:`, error);
      await ctx.reply('Помилка при завершенні завдання. Спробуйте пізніше.');
    }
  }
  
  /**
   * Start cleaning task
   */
  private async startCleaningTask(ctx: TelegramContext): Promise<void> {
    try {
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData || !state.currentData.selectedTaskId) {
        await ctx.reply('Завдання не вибрано.');
        return;
      }
      
      const taskId = state.currentData.selectedTaskId;
      
      // Update task status
      await updateTask(taskId, {
        status: TaskStatus.IN_PROGRESS,
        updatedAt: Timestamp.now(),
        updatedBy: String(ctx.userId)
      });
      
      await ctx.reply('⏳ Завдання розпочато!');
      
      // Go back to tasks list
      await this.backToCleaningTasksList(ctx);
      
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error starting cleaning task:`, error);
      await ctx.reply('Помилка при розпочатку завдання. Спробуйте пізніше.');
    }
  }
  
  /**
   * Cancel cleaning task
   */
  private async cancelCleaningTask(ctx: TelegramContext): Promise<void> {
    try {
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData || !state.currentData.selectedTaskId) {
        await ctx.reply('Завдання не вибрано.');
        return;
      }
      
      const taskId = state.currentData.selectedTaskId;
      
      // Update task status
      await updateTask(taskId, {
        status: TaskStatus.CANCELLED,
        updatedAt: Timestamp.now(),
        updatedBy: String(ctx.userId)
      });
      
      await ctx.reply('❌ Завдання скасовано!');
      
      // Go back to tasks list
      await this.backToCleaningTasksList(ctx);
      
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error cancelling cleaning task:`, error);
      await ctx.reply('Помилка при скасуванні завдання. Спробуйте пізніше.');
    }
  }
  
  /**
   * Cancel cleaning task edit
   */
  private async cancelCleaningTaskEdit(ctx: TelegramContext): Promise<void> {
    // Clear editing state
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (state.currentData) {
      state.currentData.selectedTaskId = null;
      state.currentData.editingField = null;
    }
    
    // Go back to tasks list
    await this.backToCleaningTasksList(ctx);
  }
  
  /**
   * Go back to cleaning tasks list
   */
  private async backToCleaningTasksList(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (!state.currentData) {
      state.currentData = {};
    }
    
    const page = state.currentData.page || 1;
    const statuses = state.currentData.taskStatus === TaskStatus.COMPLETED ? 
      [TaskStatus.COMPLETED] : 
      [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];
    
    await this.showCleaningTasksList(ctx, page, statuses);
  }
  
  /**
   * Report cleaning problem
   */
  private async reportCleaningProblem(ctx: TelegramContext): Promise<void> {
    try {
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData || !state.currentData.selectedTaskId) {
        await ctx.reply('Завдання не вибрано.');
        return;
      }
      
      const taskId = state.currentData.selectedTaskId;
      
      // Update task notes
      await updateTask(taskId, {
        notes: '⚠️ Повідомлено про проблему',
        updatedAt: Timestamp.now(),
        updatedBy: String(ctx.userId)
      });
      
      await ctx.reply('⚠️ Проблему зареєстровано!');
      
      // Go back to tasks list
      await this.backToCleaningTasksList(ctx);
      
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error reporting cleaning problem:`, error);
      await ctx.reply('Помилка при реєстрації проблеми. Спробуйте пізніше.');
    }
  }
  
  /**
   * Report cleaning dirty
   */
  private async reportCleaningDirty(ctx: TelegramContext): Promise<void> {
    try {
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData || !state.currentData.selectedTaskId) {
        await ctx.reply('Завдання не вибрано.');
        return;
      }
      
      const taskId = state.currentData.selectedTaskId;
      
      // Update task notes
      await updateTask(taskId, {
        notes: '🧹 Повідомлено про бруд',
        updatedAt: Timestamp.now(),
        updatedBy: String(ctx.userId)
      });
      
      await ctx.reply('🧹 Бруд зареєстровано!');
      
      // Go back to tasks list
      await this.backToCleaningTasksList(ctx);
      
    } catch (error) {
      logger.error(`[TelegramCoordinator] Error reporting cleaning dirty:`, error);
      await ctx.reply('Помилка при реєстрації бруду. Спробуйте пізніше.');
    }
  }
}
