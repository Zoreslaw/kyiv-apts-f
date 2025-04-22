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
  formatTaskDetailText
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
    
    // Direct action handlers
    if (actionData === 'show_tasks') {
      await this.showTasks(ctx);
      return;
    }
    
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
    
    if (actionData === 'edit_checkin_time') {
      await this.editCheckInTime(ctx);
      return;
    }
    
    if (actionData === 'edit_checkin_keys') {
      await this.editCheckInKeys(ctx);
      return;
    }
    
    if (actionData === 'edit_checkin_money') {
      await this.editCheckInMoney(ctx);
      return;
    }
    
    if (actionData === 'edit_checkout_time') {
      await this.editCheckOutTime(ctx);
      return;
    }
    
    if (actionData === 'edit_checkout_keys') {
      await this.editCheckOutKeys(ctx);
      return;
    }
    
    if (actionData === 'edit_checkout_money') {
      await this.editCheckOutMoney(ctx);
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
    
    // Handle regex patterns
    const checkInPageMatch = /^checkin_page_(\d+)$/.exec(actionData);
    if (checkInPageMatch) {
      await this.handleCheckInPage(ctx, checkInPageMatch);
      return;
    }
    
    const showCheckInEditMatch = /^show_checkin_edit_(\d+)$/.exec(actionData);
    if (showCheckInEditMatch) {
      await this.showCheckInEditMode(ctx, showCheckInEditMatch);
      return;
    }
    
    const checkOutPageMatch = /^checkout_page_(\d+)$/.exec(actionData);
    if (checkOutPageMatch) {
      await this.handleCheckOutPage(ctx, checkOutPageMatch);
      return;
    }
    
    const showCheckOutEditMatch = /^show_checkout_edit_(\d+)$/.exec(actionData);
    if (showCheckOutEditMatch) {
      await this.showCheckOutEditMode(ctx, showCheckOutEditMatch);
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
  }
  
  /**
   * Show user tasks
   */
  private async showTasks(ctx: TelegramContext): Promise<void> {
    try {
      logger.info(`[TaskHandler] Showing tasks for user ${ctx.userId}`);
      
      const result = await this.taskService.getTasksForUser(ctx.userId);
      
      if (!result.success || !result.tasks) {
        await ctx.reply(result.message || "Немає завдань на найближчі дні.", { 
          parse_mode: "Markdown" 
        });
        return;
      }
      
      const grouped = this.taskService.groupTasksByDate(result.tasks);
      const allDates = Object.keys(grouped).sort();
      
      if (allDates.length === 0) {
        await ctx.reply("Немає завдань на найближчі дні.", { 
          parse_mode: "Markdown" 
        });
        return;
      }
      
      // Clean up previous messages
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Send tasks for each date
      for (const date of allDates) {
        const { checkouts, checkins } = grouped[date];
        
        if (!checkouts.length && !checkins.length) {
          continue;
        }
        
        const [y, m, d] = date.split("-");
        const dateString = `${d}.${m}.${y}`;
        
        const msg = this.taskService.formatTasksMessage(dateString, checkouts, checkins);
        
        // Create keyboard options for this date's tasks
        const allTasks = [...checkouts, ...checkins];
        const keyboardOptions: TaskDisplayKeyboardOptions = {
          tasks: allTasks,
          type: allTasks[0]?.type === TaskTypes.CHECKOUT ? TaskTypes.CHECKOUT : TaskTypes.CHECKIN,
          page: 1,
          totalPages: 1,
          forEditing: true
        };
        
        // Create keyboard buttons
        const keyboard = createTaskDisplayKeyboard(keyboardOptions);
        
        // Send message with inline keyboard
        const message = await ctx.reply(msg, { 
          parse_mode: "Markdown",
          reply_markup: createInlineKeyboard({
            id: 'tasks_list',
            type: 'inline',
            buttons: keyboard
          })
        });
        
        // Store message ID for cleanup
        this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      }
      
    } catch (error) {
      logger.error(`[TaskHandler] Error showing tasks:`, error);
      await ctx.reply("Помилка при отриманні завдань. Спробуйте пізніше.", { 
        parse_mode: "Markdown" 
      });
    }
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
    
    // Send the updated list directly
    await this.sendCheckInsList(ctx, state.currentData.date, state.currentData.page, false);
  }
  
  /**
   * Show check-in edit mode
   */
  public async showCheckInEditMode(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    state.currentData.date = state.currentData.date || new Date();
    
    // Just update the state to indicate we're in edit mode WITHOUT changing the keyboard
    state.currentData.editMode = true;
    
    // Clean up messages but don't change the persistent keyboard
    await this.keyboardManager.cleanupMessages(ctx);
    
    // Send the list with edit buttons
    await this.sendCheckInsList(ctx, state.currentData.date, page, true);
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
    const taskId = match[1];
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.selectedTaskId = taskId;
    state.currentData.editType = 'checkin';
    
    try {
      // Get the task from the repository
      const task: Task | null = await findTaskById(taskId);
      
      if (!task) {
        await ctx.reply(`Помилка: Завдання з ID ${taskId} не знайдено.`);
        return;
      }
      
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Get apartment address directly from task
      const apartmentAddress = task.address || task.apartmentId;
      
      // Use our utility functions to generate the buttons and text
      const editButtons = createTaskEditButtons(task, 'checkin', apartmentAddress);
      const detailText = formatTaskDetailText(task, 'checkin', apartmentAddress);
      
      // Send message with inline keyboard
      const message = await ctx.reply(detailText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(editButtons, true)
      });
      
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
    
    // Send the updated list directly
    await this.sendCheckOutsList(ctx, state.currentData.date, state.currentData.page, false);
  }
  
  /**
   * Show check-out edit mode
   */
  public async showCheckOutEditMode(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    state.currentData.date = state.currentData.date || new Date();
    
    // Just update the state to indicate we're in edit mode WITHOUT changing the keyboard
    state.currentData.editMode = true;
    
    // Clean up messages but don't change the persistent keyboard
    await this.keyboardManager.cleanupMessages(ctx);
    
    // Send the list with edit buttons
    await this.sendCheckOutsList(ctx, state.currentData.date, page, true);
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
    const taskId = match[1];
    const state = this.keyboardManager.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.selectedTaskId = taskId;
    state.currentData.editType = 'checkout';
    
    try {
      // Get the task from the repository
      const task: Task | null = await findTaskById(taskId);
      
      if (!task) {
        await ctx.reply(`Помилка: Завдання з ID ${taskId} не знайдено.`);
        return;
      }
      
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Get apartment address directly from task
      const apartmentAddress = task.address || task.apartmentId;
      
      // Use our utility functions to generate the buttons and text
      const editButtons = createTaskEditButtons(task, 'checkout', apartmentAddress);
      const detailText = formatTaskDetailText(task, 'checkout', apartmentAddress);
      
      // Send message with inline keyboard
      const message = await ctx.reply(detailText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(editButtons, true)
      });
      
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