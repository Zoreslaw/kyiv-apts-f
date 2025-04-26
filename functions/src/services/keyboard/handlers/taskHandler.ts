import { logger } from 'firebase-functions';
import { ActionHandler } from '../actionHandler';
import { TelegramContext, KeyboardManager, UserState } from '../keyboardManager';
import { TaskService } from '../../taskService';
import { 
  getTasksForDate, 
  updateTask, 
  updateTaskTime, 
  findById as findTaskById 
} from '../../../repositories/taskRepository';
import { TaskTypes } from '../../../utils/constants';
import { formatDate, generateCalendarText, generateCalendarImage } from '../../../utils/calendarUtils';
import { Timestamp } from 'firebase-admin/firestore';
import {
  createCheckInListKeyboard,
  createCheckOutListKeyboard,
  createApartmentEditKeyboard,
  createInlineKeyboard,
  KeyboardButtonConfig,
  createTaskDisplayKeyboard,
  TaskDisplayKeyboardOptions,
  createTaskEditButtons,
  formatTaskDetailText, TASK_DATE_NAVIGATION
} from '../../../constants/keyboards';
import { Task } from '../../../models/Task';

/**
 * TaskHandler - Handles all task-related keyboard actions
 * Provides methods for check-ins and check-outs management
 */
export class TaskHandler implements ActionHandler {
  constructor(
    private taskService: TaskService,
    private keyboardManager: KeyboardManager
  ) {}
  
  /**
   * Main action handler
   */
  async handleAction(ctx: TelegramContext, actionData?: string): Promise<void> {
    if (!actionData) return;
    
    logger.debug(`[TaskHandler] Handling action: ${actionData}`);
    
    // Handle direct actions
    if (actionData === 'edit_checkins') {
      await this.showCheckIns(ctx);
      return;
    }
    
    if (actionData === 'edit_checkouts') {
      await this.showCheckOuts(ctx);
      return;
    }
    
    if (actionData === 'cancel_checkin_edit') {
      await this.cancelCheckInEdit(ctx);
      return;
    }
    
    if (actionData === 'cancel_checkout_edit') {
      await this.cancelCheckOutEdit(ctx);
      return;
    }
    
    if (actionData === 'prev_checkin_day') {
      await this.navigateCheckInDay(ctx, -1);
      return;
    }
    
    if (actionData === 'next_checkin_day') {
      await this.navigateCheckInDay(ctx, 1);
      return;
    }
    
    if (actionData === 'prev_checkout_day') {
      await this.navigateCheckOutDay(ctx, -1);
      return;
    }
    
    if (actionData === 'next_checkout_day') {
      await this.navigateCheckOutDay(ctx, 1);
      return;
    }
    
    if (actionData === 'back_to_checkins') {
      await this.backToCheckIns(ctx);
      return;
    }
    
    if (actionData === 'back_to_checkouts') {
      await this.backToCheckOuts(ctx);
      return;
    }

    // Handle actions with embedded task IDs (new format)
    const editTimeMatch = /^edit_(checkin|checkout)_time_(.+)$/.exec(actionData);
    if (editTimeMatch) {
      const type = editTimeMatch[1];
      const taskId = editTimeMatch[2];
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData) state.currentData = {};
      state.currentData.selectedTaskId = taskId;
      
      logger.info(`[TaskHandler] Editing ${type} time for task: ${taskId}`);
      
      if (type === 'checkin') {
        await this.editCheckInTime(ctx);
      } else {
        await this.editCheckOutTime(ctx);
      }
      return;
    }
    
    const editKeysMatch = /^edit_(checkin|checkout)_keys_(.+)$/.exec(actionData);
    if (editKeysMatch) {
      const type = editKeysMatch[1];
      const taskId = editKeysMatch[2];
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData) state.currentData = {};
      state.currentData.selectedTaskId = taskId;
      
      logger.info(`[TaskHandler] Editing ${type} keys for task: ${taskId}`);
      
      if (type === 'checkin') {
        await this.editCheckInKeys(ctx);
      } else {
        await this.editCheckOutKeys(ctx);
      }
      return;
    }
    
    const editMoneyMatch = /^edit_(checkin|checkout)_money_(.+)$/.exec(actionData);
    if (editMoneyMatch) {
      const type = editMoneyMatch[1];
      const taskId = editMoneyMatch[2];
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData) state.currentData = {};
      state.currentData.selectedTaskId = taskId;
      
      logger.info(`[TaskHandler] Editing ${type} money for task: ${taskId}`);
      
      if (type === 'checkin') {
        await this.editCheckInMoney(ctx);
      } else {
        await this.editCheckOutMoney(ctx);
      }
      return;
    }
    
    // Handle complex patterns
    
    // Handle check-in edit mode
    if (actionData.startsWith('show_checkin_edit_')) {
      const match = { input: actionData } as RegExpExecArray;
      await this.showCheckInEditMode(ctx, match);
      return;
    }
    
    // Handle check-out edit mode
    if (actionData.startsWith('show_checkout_edit_')) {
      const match = { input: actionData } as RegExpExecArray;
      await this.showCheckOutEditMode(ctx, match);
      return;
    }
    
    // Handle regex patterns
    const checkInPageMatch = /^checkin_page_(\d+)$/.exec(actionData);
    if (checkInPageMatch) {
      await this.handleCheckInPage(ctx, checkInPageMatch);
      return;
    }
    
    const checkOutPageMatch = /^checkout_page_(\d+)$/.exec(actionData);
    if (checkOutPageMatch) {
      await this.handleCheckOutPage(ctx, checkOutPageMatch);
      return;
    }
    
    const editCheckInMatch = /^edit_checkin_(.+)$/.exec(actionData);
    if (editCheckInMatch) {
      await this.editCheckIn(ctx, editCheckInMatch);
      return;
    }
    
    const editCheckOutMatch = /^edit_checkout_(.+)$/.exec(actionData);
    if (editCheckOutMatch) {
      await this.editCheckOut(ctx, editCheckOutMatch);
      return;
    }
    
    logger.warn(`[TaskHandler] Unhandled action: ${actionData}`);
  }

  /**
   * Show check-ins management
   */
  public async showCheckIns(ctx: TelegramContext): Promise<void> {
    await this.keyboardManager.cleanupMessages(ctx);
    
    // Get state
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (!state.currentData) {
      state.currentData = {};
    }
    
    // Default to today if no date is set
    state.currentData.date = state.currentData.date || new Date();
    state.currentData.page = state.currentData.page || 1;
    
    // EXPLICITLY SHOW THE PERSISTENT KEYBOARD
    await this.keyboardManager.showKeyboard(ctx, 'checkins_nav', 'Керування заїздами');
    
    // Show check-ins list with navigation
    await this.sendCheckInsList(ctx, state.currentData.date, state.currentData.page, false);
  }
  
  /**
   * Send check-ins list with pagination
   */
  private async sendCheckInsList(
    ctx: TelegramContext, 
    date: Date, 
    page: number = 1, 
    forEditing: boolean = false
  ): Promise<void> {
    try {
      // Get tasks for the specified date from the repository
      const tasks = await getTasksForDate(date, TaskTypes.CHECKIN);
      
      const PAGE_SIZE = 5;
      const totalTasks = tasks.length;
      const totalPages = Math.ceil(totalTasks / PAGE_SIZE);
      const startIdx = (page - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalTasks);
      
      const pageTasks = tasks.slice(startIdx, endIdx);
      
      // Generate message text
      let text = `*Список заїздів на ${formatDate(date)} (${page}/${totalPages || 1}):*\n\n`;
      
      if (pageTasks.length === 0) {
        text += "Заїздів на цю дату не знайдено.";
      } else {
        pageTasks.forEach(task => {
          text += `🏠 *${task.apartmentId}:* ${task.address}\n`;
          text += `⏰ *Заїзд:* ${task.checkinTime || 'Не вказано'}\n`;
          text += `🔑 *Ключі:* ${task.keysCount || '1'}\n`;
          text += `💰 *Сума:* ${task.sumToCollect || '0'} грн\n`;
          if (task.guestName) {
            text += `👤 *Гість:* ${task.guestName}\n`;
          }
          if (task.notes) {
            text += `📝 *Примітки:* ${task.notes}\n`;
          }
          text += `\n`;
        });
      }
      
      // Use our enhanced keyboard generator with correct options
      const keyboardOptions: TaskDisplayKeyboardOptions = {
        tasks: pageTasks,
        type: 'checkin',
        page: page,
        totalPages: totalPages,
        forEditing: forEditing
      };
      
      // Generate a consistent keyboard
      const allButtons = createTaskDisplayKeyboard(keyboardOptions);
      
      try {
        // Try to generate and send calendar image
        const calendarBuffer = await generateCalendarImage(date, 'Заїзди');
        
        // Send message with calendar image
        const message = await ctx.reply('', {
          photo: { source: calendarBuffer },
          caption: `*Керування заїздами*\n\n${text}`,
          parse_mode: 'Markdown',
          reply_markup: createInlineKeyboard(allButtons, true)
        });
        
        // Store for cleanup
        this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      } catch (imageError) {
        logger.warn(`[TaskHandler] Could not generate calendar image:`, imageError);
        
        // Fallback to text calendar
        const calendarText = generateCalendarText(date, 'Заїзди');
        
        // Send message with text calendar
        const message = await ctx.reply(`*Керування заїздами*\n\n${calendarText}\n\n${text}`, {
          parse_mode: 'Markdown',
          reply_markup: createInlineKeyboard(allButtons, true)
        });
        
        // Store for cleanup
        this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      }
      
    } catch (error) {
      logger.error(`[TaskHandler] Error sending check-ins list:`, error);
      await ctx.reply('Помилка при відображенні списку заїздів. Спробуйте пізніше.');
    }
  }
  
  /**
   * Navigate check-in days
   */
  private async navigateCheckInDay(ctx: TelegramContext, offset: number): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.date = state.currentData.date || new Date();
    state.currentData.page = 1; // Reset to first page when changing date
    
    // Create a new date to avoid mutating the original
    const newDate = new Date(state.currentData.date);
    newDate.setDate(newDate.getDate() + offset);
    state.currentData.date = newDate;
    
    // Clean up existing messages
    await this.keyboardManager.cleanupMessages(ctx);
    
    // Ensure persistent keyboard is shown
    await this.keyboardManager.showKeyboard(ctx, 'checkins_nav', 'Керування заїздами');
    
    // Send the updated list directly
    await this.sendCheckInsList(ctx, state.currentData.date, state.currentData.page, false);
  }
  
  /**
   * Show check-in edit mode
   */
  public async showCheckInEditMode(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    try {
      logger.info(`[TaskHandler] Showing check-in edit mode with action: ${match.input}`);
      
      // Extract task ID from the complex string
      // Format: show_checkin_edit_FULL_TASK_ID
      // Where FULL_TASK_ID might be something like: 361_2025-04-06_checkin_checkin
      const parts = match.input?.split('_') || [];
      logger.debug(`[TaskHandler] Parsed action parts: ${JSON.stringify(parts)}`);
      
      if (parts.length < 4) {
        logger.error(`[TaskHandler] Invalid check-in edit action format: ${match.input}`);
        await ctx.reply('Помилка: Неправильний формат дії редагування.');
        return;
      }
      
      // The full task ID is everything after "show_checkin_edit_"
      // We need to reconstruct it because it contains underscores
      const taskId = parts.slice(3).join('_');
      logger.debug(`[TaskHandler] Extracted full taskId: ${taskId}`);
      
      // Default page to 1
      const page = 1;
      const state = this.keyboardManager.getUserState(ctx.userId);
      
      if (!state.currentData) {
        state.currentData = {};
      }
      
      state.currentData.page = page;
      state.currentData.date = state.currentData.date || new Date();
      state.currentData.selectedTaskId = taskId;
      state.currentData.editMode = true;
      
      logger.debug(`[TaskHandler] Updated state: editMode=${state.currentData.editMode}, selectedTaskId=${state.currentData.selectedTaskId}`);
      
      // Clean up messages but don't change the persistent keyboard
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Show the task edit view
      // Create a properly shaped RegExpExecArray object
      const fakeRegex = /^edit_checkin_(.+)$/;
      const fakeInput = `edit_checkin_${taskId}`;
      logger.debug(`[TaskHandler] Creating regex match with input: ${fakeInput}`);
      
      const fakeMatch = fakeRegex.exec(fakeInput);
      if (!fakeMatch) {
        logger.error(`[TaskHandler] Failed to create regex match for: ${fakeInput}`);
        await ctx.reply('Помилка при підготовці редагування заїзду.');
        return;
      }
      
      logger.debug(`[TaskHandler] Regex match created successfully: ${JSON.stringify(fakeMatch)}`);
      
      // Call the edit method directly
      logger.debug(`[TaskHandler] Calling editCheckIn with taskId: ${taskId}`);
      await this.editCheckIn(ctx, fakeMatch as RegExpExecArray);
    } catch (error) {
      logger.error(`[TaskHandler] Error in showCheckInEditMode:`, error);
      await ctx.reply('Помилка при відображенні редагування заїзду. Спробуйте пізніше.');
    }
  }
  
  /**
   * Handle check-in page navigation
   */
  private async handleCheckInPage(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    state.currentData.date = state.currentData.date || new Date();
    
    await this.keyboardManager.cleanupMessages(ctx);
    await this.sendCheckInsList(ctx, state.currentData.date, page, false);
  }
  
  /**
   * Cancel check-in edit mode
   */
  private async cancelCheckInEdit(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = state.currentData.page || 1;
    state.currentData.date = state.currentData.date || new Date();
    
    // Reset the edit mode flag without changing the keyboard
    state.currentData.editMode = false;
    
    await this.keyboardManager.cleanupMessages(ctx);
    
    // Just show the regular check-ins list without changing persistent keyboard
    await this.sendCheckInsList(ctx, state.currentData.date, state.currentData.page, false);
  }
  
  /**
   * Edit a specific check-in task
   */
  private async editCheckIn(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    try {
      logger.info(`[TaskHandler] Editing check-in with match: ${JSON.stringify(match)}`);
      
      const taskId = match[1];
      logger.debug(`[TaskHandler] Extracted taskId from match: ${taskId}`);
      
      const state = this.keyboardManager.getUserState(ctx.userId);
      
      if (!state.currentData) {
        state.currentData = {};
      }
      
      state.currentData.selectedTaskId = taskId;
      state.currentData.editType = 'checkin';
      
      logger.debug(`[TaskHandler] Updated state for edit: editType=${state.currentData.editType}, selectedTaskId=${state.currentData.selectedTaskId}`);
      
      // Get the task directly by ID - these are unique in Firestore
      logger.debug(`[TaskHandler] Finding task with exact ID: ${taskId}`);
      let task = await findTaskById(taskId);
      
      if (!task) {
        logger.error(`[TaskHandler] Task not found with ID: ${taskId}`);
        
        // Try to fetch tasks to show available options
        const currentDate = new Date();
        const tasks = await getTasksForDate(currentDate, TaskTypes.CHECKIN);
        
        // More detailed error message with available task information
        let errorMsg = `Помилка: Завдання з ID ${taskId} не знайдено.\n\n`;
        errorMsg += `Доступні заїзди на сьогодні: ${tasks.length}\n`;
        
        if (tasks.length > 0) {
          errorMsg += "Можливо ви хотіли вибрати одне з цих:\n";
          tasks.slice(0, 3).forEach((t, i) => {
            errorMsg += `${i+1}. ID: ${t.id}, Адреса: ${t.address || t.apartmentId}\n`;
          });
        }
        
        await ctx.reply(errorMsg);
        return;
      }
      
      logger.debug(`[TaskHandler] Found task: ${JSON.stringify(task)}`);
      
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Get apartment address directly from task
      const apartmentAddress = task.address || task.apartmentId;
      
      // Use our utility functions to generate the buttons and text
      logger.debug(`[TaskHandler] Creating edit buttons for task`);
      const editButtons = createTaskEditButtons(task, 'checkin', apartmentAddress);
      const detailText = formatTaskDetailText(task, 'checkin', apartmentAddress);
      
      logger.debug(`[TaskHandler] Sending edit message with keyboard`);
      
      // Send message with inline keyboard
      const message = await ctx.reply(detailText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(editButtons, true)
      });
      
      logger.debug(`[TaskHandler] Edit message sent successfully: ${message.message_id}`);
      
      // Store for cleanup
      this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[TaskHandler] Error editing check-in:`, error);
      await ctx.reply('Помилка при редагуванні заїзду. Спробуйте пізніше.');
    }
  }
  
  /**
   * Edit check-in time
   */
  private async editCheckInTime(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (!state.currentData || !state.currentData.selectedTaskId) {
      await ctx.reply('Помилка: Не вибрано завдання для редагування.');
      return;
    }
    
    state.currentData.editingField = 'time';
    
    await ctx.reply('⏰ Введіть новий час заїзду у форматі HH:MM\nНаприклад: 14:00');
  }
  
  /**
   * Edit check-in keys
   */
  private async editCheckInKeys(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (!state.currentData || !state.currentData.selectedTaskId) {
      await ctx.reply('Помилка: Не вибрано завдання для редагування.');
      return;
    }
    
    state.currentData.editingField = 'keys';
    
    await ctx.reply('🔑 Введіть кількість ключів\nНаприклад: 2 ключа');
  }
  
  /**
   * Edit check-in money
   */
  private async editCheckInMoney(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (!state.currentData || !state.currentData.selectedTaskId) {
      await ctx.reply('Помилка: Не вибрано завдання для редагування.');
      return;
    }
    
    state.currentData.editingField = 'money';
    
    await ctx.reply('💰 Введіть суму оплати\nНаприклад: 500 грн');
  }
  
  /**
   * Back to check-ins list
   */
  private async backToCheckIns(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    // Clear task selection
    if (state.currentData) {
      state.currentData.selectedTaskId = undefined;
      state.currentData.editingField = undefined;
    }
    
    // Restore the navigation keyboard
    state.currentKeyboard = 'checkins_nav';
    await this.keyboardManager.showKeyboard(ctx, 'checkins_nav');
    
    await this.showCheckIns(ctx);
  }
  
  /**
   * Show check-outs management
   */
  public async showCheckOuts(ctx: TelegramContext): Promise<void> {
    await this.keyboardManager.cleanupMessages(ctx);
    
    // Get state
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (!state.currentData) {
      state.currentData = {};
    }
    
    // Default to today if no date is set
    state.currentData.date = state.currentData.date || new Date();
    state.currentData.page = state.currentData.page || 1;
    
    // EXPLICITLY SHOW THE PERSISTENT KEYBOARD
    await this.keyboardManager.showKeyboard(ctx, 'checkouts_nav', 'Керування виїздами');
    
    // Show check-outs list with navigation
    await this.sendCheckOutsList(ctx, state.currentData.date, state.currentData.page, false);
  }
  
  /**
   * Send check-outs list with pagination
   */
  private async sendCheckOutsList(
    ctx: TelegramContext, 
    date: Date, 
    page: number = 1, 
    forEditing: boolean = false
  ): Promise<void> {
    try {
      // Get tasks for the specified date from the repository
      const tasks = await getTasksForDate(date, TaskTypes.CHECKOUT);
      
      const PAGE_SIZE = 5;
      const totalTasks = tasks.length;
      const totalPages = Math.ceil(totalTasks / PAGE_SIZE);
      const startIdx = (page - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalTasks);
      
      const pageTasks = tasks.slice(startIdx, endIdx);
      
      // Generate message text
      let text = `*Список виїздів на ${formatDate(date)} (${page}/${totalPages || 1}):*\n\n`;
      
      if (pageTasks.length === 0) {
        text += "Виїздів на цю дату не знайдено.";
      } else {
        pageTasks.forEach(task => {
          text += `🏠 *${task.apartmentId}:* ${task.address}\n`;
          text += `⏰ *Виїзд:* ${task.checkoutTime || 'Не вказано'}\n`;
          text += `🔑 *Ключі:* ${task.keysCount || '1'}\n`;
          text += `💰 *Сума:* ${task.sumToCollect || '0'} грн\n`;
          if (task.guestName) {
            text += `👤 *Гість:* ${task.guestName}\n`;
          }
          if (task.notes) {
            text += `📝 *Примітки:* ${task.notes}\n`;
          }
          text += `\n`;
        });
      }
      
      // Use our enhanced keyboard generator with correct options
      const keyboardOptions: TaskDisplayKeyboardOptions = {
        tasks: pageTasks,
        type: 'checkout',
        page: page,
        totalPages: totalPages,
        forEditing: forEditing
      };
      
      // Generate a consistent keyboard
      const allButtons = createTaskDisplayKeyboard(keyboardOptions);
      
      try {
        // Try to generate and send calendar image
        const calendarBuffer = await generateCalendarImage(date, 'Виїзди');
        
        // Send message with calendar image
        const message = await ctx.reply('', {
          photo: { source: calendarBuffer },
          caption: `*Керування виїздами*\n\n${text}`,
          parse_mode: 'Markdown',
          reply_markup: createInlineKeyboard(allButtons, true)
        });
        
        // Store for cleanup
        this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      } catch (imageError) {
        logger.warn(`[TaskHandler] Could not generate calendar image:`, imageError);
        
        // Fallback to text calendar
        const calendarText = generateCalendarText(date, 'Виїзди');
        
        // Send message with text calendar
        const message = await ctx.reply(`*Керування виїздами*\n\n${calendarText}\n\n${text}`, {
          parse_mode: 'Markdown',
          reply_markup: createInlineKeyboard(allButtons, true)
        });
        
        // Store for cleanup
        this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      }
      
    } catch (error) {
      logger.error(`[TaskHandler] Error sending check-outs list:`, error);
      await ctx.reply('Помилка при відображенні списку виїздів. Спробуйте пізніше.');
    }
  }
  
  /**
   * Handle check-out page navigation
   */
  private async handleCheckOutPage(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    state.currentData.date = state.currentData.date || new Date();
    
    await this.keyboardManager.cleanupMessages(ctx);
    await this.sendCheckOutsList(ctx, state.currentData.date, page, false);
  }
  
  /**
   * Navigate check-out days
   */
  private async navigateCheckOutDay(ctx: TelegramContext, offset: number): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.date = state.currentData.date || new Date();
    state.currentData.page = 1; // Reset to first page when changing date
    
    // Create a new date to avoid mutating the original
    const newDate = new Date(state.currentData.date);
    newDate.setDate(newDate.getDate() + offset);
    state.currentData.date = newDate;
    
    // Clean up existing messages
    await this.keyboardManager.cleanupMessages(ctx);
    
    // Ensure persistent keyboard is shown
    await this.keyboardManager.showKeyboard(ctx, 'checkouts_nav', 'Керування виїздами');
    
    // Send the updated list directly
    await this.sendCheckOutsList(ctx, state.currentData.date, state.currentData.page, false);
  }
  
  /**
   * Show check-out edit mode
   */
  public async showCheckOutEditMode(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    try {
      logger.info(`[TaskHandler] Showing check-out edit mode with action: ${match.input}`);
      
      // Extract task ID from the complex string
      // Format: show_checkout_edit_FULL_TASK_ID
      // Where FULL_TASK_ID might be something like: 361_2025-04-06_checkout_checkout
      const parts = match.input?.split('_') || [];
      logger.debug(`[TaskHandler] Parsed action parts: ${JSON.stringify(parts)}`);
      
      if (parts.length < 4) {
        logger.error(`[TaskHandler] Invalid check-out edit action format: ${match.input}`);
        await ctx.reply('Помилка: Неправильний формат дії редагування.');
        return;
      }
      
      // The full task ID is everything after "show_checkout_edit_"
      // We need to reconstruct it because it contains underscores
      const taskId = parts.slice(3).join('_');
      logger.debug(`[TaskHandler] Extracted full taskId: ${taskId}`);
      
      // Default page to 1
      const page = 1;
      const state = this.keyboardManager.getUserState(ctx.userId);
      
      if (!state.currentData) {
        state.currentData = {};
      }
      
      state.currentData.page = page;
      state.currentData.date = state.currentData.date || new Date();
      state.currentData.selectedTaskId = taskId;
      state.currentData.editMode = true;
      
      logger.debug(`[TaskHandler] Updated state: editMode=${state.currentData.editMode}, selectedTaskId=${state.currentData.selectedTaskId}`);
      
      // Clean up messages but don't change the persistent keyboard
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Show the task edit view
      // Create a properly shaped RegExpExecArray object
      const fakeRegex = /^edit_checkout_(.+)$/;
      const fakeInput = `edit_checkout_${taskId}`;
      logger.debug(`[TaskHandler] Creating regex match with input: ${fakeInput}`);
      
      const fakeMatch = fakeRegex.exec(fakeInput);
      if (!fakeMatch) {
        logger.error(`[TaskHandler] Failed to create regex match for: ${fakeInput}`);
        await ctx.reply('Помилка при підготовці редагування виїзду.');
        return;
      }
      
      logger.debug(`[TaskHandler] Regex match created successfully: ${JSON.stringify(fakeMatch)}`);
      
      // Call the edit method directly
      logger.debug(`[TaskHandler] Calling editCheckOut with taskId: ${taskId}`);
      await this.editCheckOut(ctx, fakeMatch as RegExpExecArray);
    } catch (error) {
      logger.error(`[TaskHandler] Error in showCheckOutEditMode:`, error);
      await ctx.reply('Помилка при відображенні редагування виїзду. Спробуйте пізніше.');
    }
  }
  
  /**
   * Cancel check-out edit mode
   */
  private async cancelCheckOutEdit(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = state.currentData.page || 1;
    state.currentData.date = state.currentData.date || new Date();
    
    // Reset the edit mode flag without changing the keyboard
    state.currentData.editMode = false;
    
    await this.keyboardManager.cleanupMessages(ctx);
    
    // Just show the regular check-outs list without changing persistent keyboard
    await this.sendCheckOutsList(ctx, state.currentData.date, state.currentData.page, false);
  }
  
  /**
   * Edit a specific check-out task
   */
  private async editCheckOut(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    try {
      logger.info(`[TaskHandler] Editing check-out with match: ${JSON.stringify(match)}`);
      
      const taskId = match[1];
      logger.debug(`[TaskHandler] Extracted taskId from match: ${taskId}`);
      
      const state = this.keyboardManager.getUserState(ctx.userId);
      
      if (!state.currentData) {
        state.currentData = {};
      }
      
      state.currentData.selectedTaskId = taskId;
      state.currentData.editType = 'checkout';
      
      logger.debug(`[TaskHandler] Updated state for edit: editType=${state.currentData.editType}, selectedTaskId=${state.currentData.selectedTaskId}`);
      
      // Get the task directly by ID - these are unique in Firestore
      logger.debug(`[TaskHandler] Finding task with exact ID: ${taskId}`);
      let task = await findTaskById(taskId);
      
      if (!task) {
        logger.error(`[TaskHandler] Task not found with ID: ${taskId}`);
        
        // Try to fetch tasks to show available options
        const currentDate = new Date();
        const tasks = await getTasksForDate(currentDate, TaskTypes.CHECKOUT);
        
        // More detailed error message with available task information
        let errorMsg = `Помилка: Завдання з ID ${taskId} не знайдено.\n\n`;
        errorMsg += `Доступні виїзди на сьогодні: ${tasks.length}\n`;
        
        if (tasks.length > 0) {
          errorMsg += "Можливо ви хотіли вибрати одне з цих:\n";
          tasks.slice(0, 3).forEach((t, i) => {
            errorMsg += `${i+1}. ID: ${t.id}, Адреса: ${t.address || t.apartmentId}\n`;
          });
        }
        
        await ctx.reply(errorMsg);
        return;
      }
      
      logger.debug(`[TaskHandler] Found task: ${JSON.stringify(task)}`);
      
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Get apartment address directly from task
      const apartmentAddress = task.address || task.apartmentId;
      
      // Use our utility functions to generate the buttons and text
      logger.debug(`[TaskHandler] Creating edit buttons for task`);
      const editButtons = createTaskEditButtons(task, 'checkout', apartmentAddress);
      const detailText = formatTaskDetailText(task, 'checkout', apartmentAddress);
      
      logger.debug(`[TaskHandler] Sending edit message with keyboard`);
      
      // Send message with inline keyboard
      const message = await ctx.reply(detailText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(editButtons, true)
      });
      
      logger.debug(`[TaskHandler] Edit message sent successfully: ${message.message_id}`);
      
      // Store for cleanup
      this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[TaskHandler] Error editing check-out:`, error);
      await ctx.reply('Помилка при редагуванні виїзду. Спробуйте пізніше.');
    }
  }
  
  /**
   * Edit check-out time
   */
  private async editCheckOutTime(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    logger.info(`[TaskHandler] Editing check-out time, selected task ID: ${state.currentData?.selectedTaskId}`);
    
    if (!state.currentData || !state.currentData.selectedTaskId) {
      await ctx.reply('Помилка: Не вибрано завдання для редагування.');
      return;
    }
    
    state.currentData.editingField = 'time';
    
    await ctx.reply('⏰ Введіть новий час виїзду у форматі HH:MM\nНаприклад: 12:00');
  }
  
  /**
   * Edit check-out keys
   */
  private async editCheckOutKeys(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    logger.info(`[TaskHandler] Editing check-out keys, selected task ID: ${state.currentData?.selectedTaskId}`);
    
    if (!state.currentData || !state.currentData.selectedTaskId) {
      await ctx.reply('Помилка: Не вибрано завдання для редагування.');
      return;
    }
    
    state.currentData.editingField = 'keys';
    
    await ctx.reply('🔑 Введіть кількість ключів\nНаприклад: 2 ключа');
  }
  
  /**
   * Edit check-out money
   */
  private async editCheckOutMoney(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    logger.info(`[TaskHandler] Editing check-out money, selected task ID: ${state.currentData?.selectedTaskId}`);
    
    if (!state.currentData || !state.currentData.selectedTaskId) {
      await ctx.reply('Помилка: Не вибрано завдання для редагування.');
      return;
    }
    
    state.currentData.editingField = 'money';
    
    await ctx.reply('💰 Введіть суму оплати\nНаприклад: 500 грн');
  }
  
  /**
   * Back to check-outs list
   */
  private async backToCheckOuts(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    // Clear task selection
    if (state.currentData) {
      state.currentData.selectedTaskId = undefined;
      state.currentData.editingField = undefined;
    }
    
    // Restore the navigation keyboard
    state.currentKeyboard = 'checkouts_nav';
    await this.keyboardManager.showKeyboard(ctx, 'checkouts_nav');
    
    await this.showCheckOuts(ctx);
  }
  
  /**
   * Process text input for task editing
   * Called externally from TelegramService when a user sends text after selecting a field to edit
   */
  public async processTaskEdit(ctx: TelegramContext, text: string): Promise<boolean> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData || 
        !state.currentData.selectedTaskId || 
        !state.currentData.editingField) {
      return false;
    }
    
    const taskId = state.currentData.selectedTaskId;
    const editingField = state.currentData.editingField;
    const isCheckIn = state.currentKeyboard === 'checkin_edit';
    
    try {
      // Find the task
      const task: Task | null = await findTaskById(taskId);
      if (!task) {
        await ctx.reply(`Помилка: Завдання з ID ${taskId} не знайдено.`);
        return false;
      }
      
      // Process the edit based on field
      switch (editingField) {
        case 'time':
          // Validate time format
          if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(text)) {
            await ctx.reply('❌ Неправильний формат часу\nВведіть у форматі HH:MM\nНаприклад: 14:00');
            return true;
          }
          
          const result = await updateTaskTime(
            taskId, 
            text, 
            isCheckIn ? 'checkin' : 'checkout',
            String(ctx.userId)
          );
          
          if (result.success) {
            await ctx.reply(`✅ ${result.message}`);
          } else {
            await ctx.reply(`❌ ${result.message}`);
          }
          break;
          
        case 'keys':
          // Validate keys count
          const keysCount = parseInt(text);
          if (isNaN(keysCount) || keysCount < 0) {
            await ctx.reply('❌ Некоректна кількість ключів. Введіть додатне число.');
            return true;
          }
          
          await updateTask(taskId, {
            keysCount: keysCount,
            updatedAt: Timestamp.now(),
            updatedBy: String(ctx.userId)
          });
          
          await ctx.reply(`✅ Оновлено кількість ключів для ${task.apartmentId} на ${keysCount}`);
          break;
          
        case 'money':
          // Validate money amount
          let amount = text;
          // Remove "грн" if present
          amount = amount.replace(/грн/ig, '').trim();
          const sumToCollect = parseFloat(amount);
          
          if (isNaN(sumToCollect) || sumToCollect < 0) {
            await ctx.reply('❌ Некоректна сума. Введіть додатне число.');
            return true;
          }
          
          await updateTask(taskId, {
            sumToCollect: sumToCollect,
            updatedAt: Timestamp.now(),
            updatedBy: String(ctx.userId)
          });
          
          await ctx.reply(`✅ Оновлено суму для ${task.apartmentId} на ${sumToCollect} грн`);
          break;
          
        default:
          return false;
      }
      
      // Show updated task info
      if (isCheckIn) {
        // Restore the normal keyboard
        await this.keyboardManager.showKeyboard(ctx, 'checkin_edit');
        
        const fakeMatch = Object.assign([null, taskId], {
          index: 0,
          input: '',
          groups: undefined
        }) as RegExpExecArray;
        await this.editCheckIn(ctx, fakeMatch);
      } else {
        // Restore the normal keyboard
        await this.keyboardManager.showKeyboard(ctx, 'checkout_edit');
        
        const fakeMatch = Object.assign([null, taskId], {
          index: 0,
          input: '',
          groups: undefined
        }) as RegExpExecArray;
        await this.editCheckOut(ctx, fakeMatch);
      }
      
      return true;
    } catch (error) {
      logger.error(`[TaskHandler] Error processing task edit:`, error);
      await ctx.reply('Помилка при редагуванні. Спробуйте пізніше.');
      return true;
    }
  }
} 