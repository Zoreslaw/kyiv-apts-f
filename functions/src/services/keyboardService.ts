import { logger } from 'firebase-functions';
import { TaskService } from './taskService';
import { 
  findByTelegramId,
  findAllUsers,
  updateUser as updateUserRepo,
  createUser,
  deleteUser,
  findById
} from '../repositories/userRepository';
import { 
  findByUserId, 
  updateAssignment, 
  createAssignment 
} from '../repositories/cleaningAssignmentRepository';
import { UserRoles } from '../utils/constants';
import { 
  KEYBOARDS, 
  KeyboardConfig,
  KeyboardButtonConfig,
  createReplyKeyboard, 
  createInlineKeyboard,
  createCheckInListKeyboard,
  createCheckOutListKeyboard,
  createApartmentEditKeyboard
} from '../constants/keyboards';
import { formatDate, generateCalendarText, getKievDateWithOffset } from '../utils/calendarUtils';
import { 
  findAllApartments, 
  createApartment as createApartmentRepo, 
  updateApartment, 
  deleteApartment 
} from '../repositories/apartmentRepository';
import { Apartment } from '../models/Apartment';
import { User, IUserData } from '../models/User';
import { Timestamp } from 'firebase-admin/firestore';
import { TelegramService } from './telegramService';

// Mock data for apartments (to be replaced with actual database calls)
const MOCK_APARTMENTS = [
  { id: 'A101', address: 'вул. Хрещатик 10, кв. 5', time: '10:00-12:00', money: '500 грн', keys: '2 ключа', checkIn: '14:00', checkOut: '12:00' },
  { id: 'B202', address: 'вул. Саксаганського 25, кв. 12', time: '13:00-15:00', money: '650 грн', keys: '1 ключ', checkIn: '15:00', checkOut: '11:00' },
  { id: 'C303', address: 'вул. Володимирська 15, кв. 8', time: '16:00-18:00', money: '700 грн', keys: '3 ключа', checkIn: '16:00', checkOut: '10:00' },
];

// Mock data for users
const MOCK_USERS = [
  { id: '12345678', name: 'John Doe', role: 'cleaner', active: true },
  { id: '87654321', name: 'Jane Smith', role: 'admin', active: true }
];

// Interface for context object passed to handlers
export interface TelegramContext {
  chatId: string | number;
  userId: string | number;
  reply: (text: string, options?: any) => Promise<{ message_id: number }>;
}

// Store user states
interface UserState {
  currentKeyboard: string;
  messageIds: number[];
  currentData?: {
    date?: Date;
    page?: number;
    selectedApartmentId?: string;
    editingField?: string;
    targetUserId?: string;
    apartmentCreation?: {
      step: string;
      id?: string;
      address?: string;
      name?: string;
      keys?: number;
      notes?: string;
    };
  };
  userListPage?: number;
  editingUser?: User;
}

/**
 * KeyboardService - Handles all keyboard interactions
 * This service manages both persistent navigation keyboards and inline message keyboards
 */
export class KeyboardService {
  private userStates: Map<string, UserState> = new Map();
  private taskService: TaskService;
  private telegramService: TelegramService;
  private actionHandlers: Map<string, (ctx: TelegramContext, data?: any) => Promise<void>> = new Map();
  
  constructor(taskService: TaskService, telegramService?: TelegramService) {
    this.taskService = taskService;
    this.telegramService = telegramService || {} as TelegramService;
    
    // Register all action handlers
    this.registerActionHandlers();
  }

  // Helper method for updating user state
  private updateUserState(userId: string | number, data: Partial<UserState>): void {
    const state = this.getUserState(userId);
    Object.assign(state, data);
  }

  // Helper method to get state
  private getState(userId: string | number): UserState {
    return this.getUserState(userId);
  }

  /**
   * Register all keyboard action handlers in one central place
   * This makes it easy to add new buttons and their handlers
   */
  private registerActionHandlers(): void {
    // Main navigation actions
    this.registerHandler('show_tasks', this.showTasks.bind(this));
    this.registerHandler('show_menu', this.showMenu.bind(this));
    this.registerHandler('help', this.showHelp.bind(this));
    this.registerHandler('about', this.showAbout.bind(this));
    this.registerHandler('admin_panel', this.showAdminPanel.bind(this));
    
    // Admin actions
    this.registerHandler('edit_checkins', this.showCheckIns.bind(this));
    this.registerHandler('edit_checkouts', this.showCheckOuts.bind(this));
    this.registerHandler('manage_users', this.showUserManagement.bind(this));
    this.registerHandler('manage_apartments', this.showApartmentManagement.bind(this));
    this.registerHandler('back_to_main', this.backToMainMenu.bind(this));
    
    // Check-ins/Check-outs navigation
    this.registerHandler('prev_checkin_day', (ctx) => this.navigateCheckInDay(ctx, -1));
    this.registerHandler('next_checkin_day', (ctx) => this.navigateCheckInDay(ctx, 1));
    this.registerHandler('prev_checkout_day', (ctx) => this.navigateCheckOutDay(ctx, -1));
    this.registerHandler('next_checkout_day', (ctx) => this.navigateCheckOutDay(ctx, 1));
    
    // Check-in pagination
    this.registerRegexHandler(/^checkin_page_(\d+)$/, this.handleCheckInPage.bind(this));
    this.registerRegexHandler(/^show_checkin_edit_(\d+)$/, this.showCheckInEditMode.bind(this));
    this.registerHandler('cancel_checkin_edit', this.cancelCheckInEdit.bind(this));
    
    // Check-out pagination
    this.registerRegexHandler(/^checkout_page_(\d+)$/, this.handleCheckOutPage.bind(this));
    this.registerRegexHandler(/^show_checkout_edit_(\d+)$/, this.showCheckOutEditMode.bind(this));
    this.registerHandler('cancel_checkout_edit', this.cancelCheckOutEdit.bind(this));
    
    // Apartment editing
    this.registerRegexHandler(/^edit_checkin_(.+)$/, this.editCheckIn.bind(this));
    this.registerRegexHandler(/^edit_checkout_(.+)$/, this.editCheckOut.bind(this));
    this.registerHandler('edit_checkin_time', this.editCheckInTime.bind(this));
    this.registerHandler('edit_checkin_keys', this.editCheckInKeys.bind(this));
    this.registerHandler('edit_checkin_money', this.editCheckInMoney.bind(this));
    this.registerHandler('edit_checkout_time', this.editCheckOutTime.bind(this));
    this.registerHandler('edit_checkout_keys', this.editCheckOutKeys.bind(this));
    this.registerHandler('edit_checkout_money', this.editCheckOutMoney.bind(this));
    this.registerHandler('back_to_checkins', this.backToCheckIns.bind(this));
    this.registerHandler('back_to_checkouts', this.backToCheckOuts.bind(this));
    
    // User pagination
    this.registerRegexHandler(/^user_page_(\d+)$/, this.handleUserPage.bind(this));
    this.registerRegexHandler(/^show_user_edit_(\d+)$/, this.showUserEditMode.bind(this));
    this.registerHandler('cancel_user_edit', this.cancelUserEdit.bind(this));
    this.registerHandler('add_user', this.addUser.bind(this));
    
    // User management
    this.registerRegexHandler(/^edit_user_(.+)$/, this.editUser.bind(this));
    this.registerHandler('user_list', this.showUserList.bind(this));
    this.registerHandler('user_prev_page', this.showUserPrevPage.bind(this));
    this.registerHandler('user_next_page', this.showUserNextPage.bind(this));
    
    // Role management
    this.registerRegexHandler(/^change_role:(.+)$/, this.changeUserRole.bind(this));
    this.registerRegexHandler(/^set_role:(.+):(.+)$/, this.setUserRole.bind(this));
    this.registerRegexHandler(/^toggle_status:(.+)$/, this.toggleUserStatus.bind(this));
    this.registerRegexHandler(/^delete_user:(.+)$/, this.startDeleteUser.bind(this));
    this.registerRegexHandler(/^confirm_delete_user:(.+)$/, this.confirmDeleteUser.bind(this));
    
    // Apartment pagination
    this.registerRegexHandler(/^apartment_page_(\d+)$/, this.handleApartmentPage.bind(this));
    this.registerRegexHandler(/^show_apartment_edit_(\d+)$/, this.showApartmentEditMode.bind(this));
    this.registerHandler('cancel_apartment_edit', this.cancelApartmentEdit.bind(this));
    this.registerHandler('add_apartment', this.startAddApartment.bind(this));
  }

  /**
   * Register a handler for a specific action
   */
  public registerHandler(
    action: string, 
    handler: (ctx: TelegramContext, data?: any) => Promise<void>
  ): void {
    this.actionHandlers.set(action, handler);
  }

  /**
   * Register a handler for actions matching a regex pattern
   */
  public registerRegexHandler(
    pattern: RegExp,
    handler: (ctx: TelegramContext, match: RegExpExecArray) => Promise<void>
  ): void {
    this.actionHandlers.set(pattern.toString(), async (ctx: TelegramContext, action: string) => {
      const match = pattern.exec(action);
      if (match) {
        await handler(ctx, match);
      }
    });
  }

  /**
   * Get or initialize user state
   */
  private getUserState(userId: string | number): UserState {
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
   * Store message IDs for cleanup
   */
  private storeMessageId(userId: string | number, messageId: number): void {
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
      logger.warn(`[KeyboardService] Couldn't delete message ${messageId}:`, err);
      return false;
    }
  }

  /**
   * Cleanup previous messages
   */
  private async cleanupMessages(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    
    for (const messageId of state.messageIds) {
      await this.deleteMessage(ctx, messageId);
    }
    
    // Clear the stored message IDs
    state.messageIds = [];
  }

  /**
   * Find a handler for an action, including regex handlers
   */
  private findHandler(action: string): ((ctx: TelegramContext, data?: any) => Promise<void>) | undefined {
    // First try direct match
    if (this.actionHandlers.has(action)) {
      return this.actionHandlers.get(action);
    }
    
    // If no direct match, try regex handlers
    for (const [pattern, handler] of this.actionHandlers.entries()) {
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        const regex = new RegExp(pattern.slice(1, -1));
        if (regex.test(action)) {
          return (ctx: TelegramContext) => handler(ctx, action);
        }
      }
    }
    
    return undefined;
  }

  /**
   * Handle user action (from text command or callback query)
   */
  async handleAction(ctx: TelegramContext, action: string, data?: any): Promise<boolean> {
    try {
      logger.info(`[KeyboardService] Handling action: ${action} for user ${ctx.userId}`);
      
      // Find the handler for this action
      const handler = this.findHandler(action);
      if (!handler) {
        logger.warn(`[KeyboardService] No handler found for action: ${action}`);
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
        logger.warn(`[KeyboardService] User ${ctx.userId} tried to access admin action: ${action}`);
        await ctx.reply('У вас немає доступу до цієї функції.');
        return false;
      }
      
      // If the action requires admin, check role
      if (action.startsWith('admin_') && !isAdmin) {
        logger.warn(`[KeyboardService] User ${ctx.userId} tried to access admin action: ${action}`);
        await ctx.reply('У вас немає доступу до цієї функції.');
        return false;
      }
      
      // Execute the handler
      await handler(ctx, data);
      return true;
      
    } catch (error) {
      logger.error(`[KeyboardService] Error handling action ${action}:`, error);
      await ctx.reply('Помилка при обробці команди. Спробуйте пізніше.');
      return false;
    }
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
        logger.error(`[KeyboardService] Keyboard with ID ${keyboardId} not found`);
        await ctx.reply('Клавіатуру не знайдено');
        return;
      }
      
      // Check if keyboard requires admin role
      if (keyboardConfig.requiresAdmin && !isAdmin) {
        logger.warn(`[KeyboardService] User ${ctx.userId} tried to access admin keyboard ${keyboardId}`);
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
      logger.error(`[KeyboardService] Error showing keyboard ${keyboardId}:`, error);
      await ctx.reply('Помилка при відображенні меню. Спробуйте пізніше.');
    }
  }

  /**
   * Action Handlers
   * Each of these methods handles a specific keyboard action
   */
  
  // ---------- Main Navigation Actions ----------
  
  /**
   * Show the main menu
   */
  private async showMenu(ctx: TelegramContext): Promise<void> {
    await this.cleanupMessages(ctx);
    // Only show the navigation keyboard, not the message menu
    await this.showKeyboard(ctx, 'main_nav');
  }
  
  /**
   * Show tasks for user
   */
  private async showTasks(ctx: TelegramContext): Promise<void> {
    try {
      logger.info(`[KeyboardService] Showing tasks for user ${ctx.userId}`);
      
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
      
      // Send tasks for each date
      for (const date of allDates) {
        const { checkouts, checkins } = grouped[date];
        
        if (!checkouts.length && !checkins.length) {
          continue;
        }
        
        const [y, m, d] = date.split("-");
        const dateString = `${d}.${m}.${y}`;
        
        const msg = this.taskService.formatTasksMessage(dateString, checkouts, checkins);
        
        // Send message and store ID for later cleanup
        const message = await ctx.reply(msg, { parse_mode: "Markdown" });
        this.storeMessageId(ctx.userId, message.message_id);
      }
      
    } catch (error) {
      logger.error(`[KeyboardService] Error showing tasks:`, error);
      await ctx.reply("Помилка при отриманні завдань. Спробуйте пізніше.", { 
        parse_mode: "Markdown" 
      });
    }
  }
  
  /**
   * Show help information
   */
  private async showHelp(ctx: TelegramContext): Promise<void> {
    const text = `🤖 *Доступні команди:*

📋 *Мої завдання* - переглянути список завдань
⚙️ *Меню* - відкрити головне меню
❓ *Допомога* - показати це повідомлення
ℹ️ *Про бота* - інформація про бота

Приклади оновлень через AI:
- "Змініть виїзд 598 на 11:00"
- "Встанови заїзд на 15:00"
- "Постав суму 300 для квартири 598"
- "Постав 2 ключі для квартири 598"`;

    const message = await ctx.reply(text, { parse_mode: "Markdown" });
    this.storeMessageId(ctx.userId, message.message_id);
  }
  
  /**
   * Show about information
   */
  private async showAbout(ctx: TelegramContext): Promise<void> {
    const text = `🤖 *Бот для управління завданнями*

Цей бот допомагає керувати заїздами та виїздами гостей.

Версія: 1.0.0
Розробник: @username`;

    const message = await ctx.reply(text, { parse_mode: "Markdown" });
    this.storeMessageId(ctx.userId, message.message_id);
  }

  // ---------- Admin Actions ----------
  
  /**
   * Show admin panel
   */
  private async showAdminPanel(ctx: TelegramContext): Promise<void> {
    try {
      logger.info(`[KeyboardService] Showing admin panel for user ${ctx.userId}`);
      
      // Get user's admin status - double check
      const user = await findByTelegramId(String(ctx.userId));
      const isAdmin = user?.role === UserRoles.ADMIN;
      
      if (!isAdmin) {
        logger.warn(`[KeyboardService] Non-admin user ${ctx.userId} tried to access admin panel`);
        await ctx.reply('У вас немає доступу до адмін-панелі');
        return;
      }
      
      // Start with clean screen
      await this.cleanupMessages(ctx);
      
      // Show only admin navigation keyboard
      logger.info(`[KeyboardService] Displaying admin panel to user ${ctx.userId}`);
      await this.showKeyboard(ctx, 'admin_nav', '👨‍💼 *Адмін панель*\n\nОберіть операцію:');
    } catch (error) {
      logger.error(`[KeyboardService] Error showing admin panel:`, error);
      await ctx.reply('Помилка при відображенні адмін-панелі. Спробуйте пізніше.');
    }
  }
  
  /**
   * Show check-ins management
   */
  private async showCheckIns(ctx: TelegramContext): Promise<void> {
    await this.cleanupMessages(ctx);
    
    // Show only navigation keyboard without message menu
    await this.showKeyboard(ctx, 'checkins_nav', 'Керування заїздами');
    
    // Initialize or get state
    const state = this.getUserState(ctx.userId);
    if (!state.currentData) {
      state.currentData = {};
    }
    
    // Default to today if no date is set
    state.currentData.date = state.currentData.date || new Date();
    state.currentData.page = state.currentData.page || 1;
    
    // Show check-ins list
    await this.sendCheckInsList(ctx, state.currentData.date!, state.currentData.page!, false);
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
      // For simplicity, using mock data in this example
      const PAGE_SIZE = 5;
      const totalApartments = MOCK_APARTMENTS.length;
      const totalPages = Math.ceil(totalApartments / PAGE_SIZE);
      const startIdx = (page - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalApartments);
      
      const pageApartments = MOCK_APARTMENTS.slice(startIdx, endIdx);
      
      // Generate calendar text
      const calendarText = generateCalendarText(date, 'Заїзди');
      
      // Generate message text
      let text = `*Список заїздів на ${formatDate(date)} (${page}/${totalPages}):*\n\n`;
      
      pageApartments.forEach(apt => {
        text += `🏠 *${apt.id}:* ${apt.address}\n`;
        text += `⏰ *Заїзд:* ${apt.checkIn}\n`;
        text += `🔑 *Ключі:* ${apt.keys}\n`;
        text += `💰 *Сума:* ${apt.money}\n\n`;
      });
      
      // Add calendar
      text = `${calendarText}\n\n${text}`;
      
      // Create keyboard
      const keyboard = forEditing ? 
        createApartmentEditKeyboard(pageApartments, 'checkin') : 
        createCheckInListKeyboard(page, totalPages, false);
      
      const message = await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(keyboard, true)
      });
      
      // Store for cleanup
      this.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[KeyboardService] Error sending check-ins list:`, error);
      await ctx.reply('Помилка при відображенні списку заїздів. Спробуйте пізніше.');
    }
  }
  
  /**
   * Handle check-in page navigation
   */
  private async handleCheckInPage(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    state.currentData.date = state.currentData.date || new Date();
    
    await this.cleanupMessages(ctx);
    await this.sendCheckInsList(ctx, state.currentData.date, page, false);
  }
  
  /**
   * Navigate check-in days
   */
  private async navigateCheckInDay(ctx: TelegramContext, offset: number): Promise<void> {
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.date = state.currentData.date || new Date();
    state.currentData.page = 1; // Reset to first page when changing date
    
    // Create a new date to avoid mutating the original
    const newDate = new Date(state.currentData.date);
    newDate.setDate(newDate.getDate() + offset);
    state.currentData.date = newDate;
    
    await this.cleanupMessages(ctx);
    await this.sendCheckInsList(ctx, newDate, 1, false);
  }
  
  /**
   * Show check-in edit mode
   */
  private async showCheckInEditMode(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    state.currentData.date = state.currentData.date || new Date();
    
    await this.cleanupMessages(ctx);
    await this.sendCheckInsList(ctx, state.currentData.date, page, true);
  }
  
  /**
   * Cancel check-in edit mode
   */
  private async cancelCheckInEdit(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = state.currentData.page || 1;
    state.currentData.date = state.currentData.date || new Date();
    
    await this.cleanupMessages(ctx);
    await this.sendCheckInsList(ctx, state.currentData.date, state.currentData.page, false);
  }
  
  /**
   * Edit a specific check-in
   */
  private async editCheckIn(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const apartmentId = match[1];
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.selectedApartmentId = apartmentId;
    
    // Find the apartment
    const apartment = MOCK_APARTMENTS.find(apt => apt.id === apartmentId);
    
    if (!apartment) {
      await ctx.reply(`Помилка: Квартиру з ID ${apartmentId} не знайдено.`);
      return;
    }
    
    await this.cleanupMessages(ctx);
    
    // Show editing keyboard
    await this.showKeyboard(ctx, 'checkin_edit', 
      `📝 *Редагування заїзду - ${apartment.id}*\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📍 *Адреса:* ${apartment.address}\n\n` +
      `*Поточні дані:*\n` +
      `⏰ *Час:* ${apartment.checkIn}\n` +
      `🔑 *Ключі:* ${apartment.keys}\n` +
      `💰 *Сума:* ${apartment.money}\n\n` +
      `*Оберіть параметр для редагування:*`
    );
  }
  
  /**
   * Edit check-in time
   */
  private async editCheckInTime(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    if (!state.currentData || !state.currentData.selectedApartmentId) {
      await ctx.reply('Помилка: Не вибрано квартиру для редагування.');
      return;
    }
    
    state.currentData.editingField = 'time';
    
    await ctx.reply('⏰ Введіть новий час заїзду у форматі HH:MM\nНаприклад: 14:00');
  }
  
  /**
   * Edit check-in keys
   */
  private async editCheckInKeys(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    if (!state.currentData || !state.currentData.selectedApartmentId) {
      await ctx.reply('Помилка: Не вибрано квартиру для редагування.');
      return;
    }
    
    state.currentData.editingField = 'keys';
    
    await ctx.reply('🔑 Введіть кількість ключів\nНаприклад: 2 ключа');
  }
  
  /**
   * Edit check-in money
   */
  private async editCheckInMoney(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    if (!state.currentData || !state.currentData.selectedApartmentId) {
      await ctx.reply('Помилка: Не вибрано квартиру для редагування.');
      return;
    }
    
    state.currentData.editingField = 'money';
    
    await ctx.reply('💰 Введіть суму оплати\nНаприклад: 500 грн');
  }
  
  /**
   * Back to check-ins list
   */
  private async backToCheckIns(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    
    // Clear apartment selection
    if (state.currentData) {
      state.currentData.selectedApartmentId = undefined;
      state.currentData.editingField = undefined;
    }
    
    await this.showCheckIns(ctx);
  }
  
  /**
   * Show check-outs management
   */
  private async showCheckOuts(ctx: TelegramContext): Promise<void> {
    await this.cleanupMessages(ctx);
    
    // Show only navigation keyboard without message menu
    await this.showKeyboard(ctx, 'checkouts_nav', 'Керування виїздами');
    
    // Initialize or get state
    const state = this.getUserState(ctx.userId);
    if (!state.currentData) {
      state.currentData = {};
    }
    
    // Default to today if no date is set
    state.currentData.date = state.currentData.date || new Date();
    state.currentData.page = state.currentData.page || 1;
    
    // Show check-outs list
    await this.sendCheckOutsList(ctx, state.currentData.date!, state.currentData.page!, false);
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
      // For simplicity, using mock data in this example
      const PAGE_SIZE = 5;
      const totalApartments = MOCK_APARTMENTS.length;
      const totalPages = Math.ceil(totalApartments / PAGE_SIZE);
      const startIdx = (page - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalApartments);
      
      const pageApartments = MOCK_APARTMENTS.slice(startIdx, endIdx);
      
      // Generate calendar text
      const calendarText = generateCalendarText(date, 'Виїзди');
      
      // Generate message text
      let text = `*Список виїздів на ${formatDate(date)} (${page}/${totalPages}):*\n\n`;
      
      pageApartments.forEach(apt => {
        text += `🏠 *${apt.id}:* ${apt.address}\n`;
        text += `⏰ *Виїзд:* ${apt.checkOut}\n`;
        text += `🔑 *Ключі:* ${apt.keys}\n`;
        text += `💰 *Сума:* ${apt.money}\n\n`;
      });
      
      // Add calendar
      text = `${calendarText}\n\n${text}`;
      
      // Create keyboard
      const keyboard = forEditing ? 
        createApartmentEditKeyboard(pageApartments, 'checkout') : 
        createCheckOutListKeyboard(page, totalPages, false);
      
      const message = await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(keyboard, true)
      });
      
      // Store for cleanup
      this.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[KeyboardService] Error sending check-outs list:`, error);
      await ctx.reply('Помилка при відображенні списку виїздів. Спробуйте пізніше.');
    }
  }
  
  /**
   * Handle check-out page navigation
   */
  private async handleCheckOutPage(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    state.currentData.date = state.currentData.date || new Date();
    
    await this.cleanupMessages(ctx);
    await this.sendCheckOutsList(ctx, state.currentData.date, page, false);
  }
  
  /**
   * Navigate check-out days
   */
  private async navigateCheckOutDay(ctx: TelegramContext, offset: number): Promise<void> {
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.date = state.currentData.date || new Date();
    state.currentData.page = 1; // Reset to first page when changing date
    
    // Create a new date to avoid mutating the original
    const newDate = new Date(state.currentData.date);
    newDate.setDate(newDate.getDate() + offset);
    state.currentData.date = newDate;
    
    await this.cleanupMessages(ctx);
    await this.sendCheckOutsList(ctx, newDate, 1, false);
  }
  
  /**
   * Show check-out edit mode
   */
  private async showCheckOutEditMode(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    state.currentData.date = state.currentData.date || new Date();
    
    await this.cleanupMessages(ctx);
    await this.sendCheckOutsList(ctx, state.currentData.date, page, true);
  }
  
  /**
   * Cancel check-out edit mode
   */
  private async cancelCheckOutEdit(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = state.currentData.page || 1;
    state.currentData.date = state.currentData.date || new Date();
    
    await this.cleanupMessages(ctx);
    await this.sendCheckOutsList(ctx, state.currentData.date, state.currentData.page, false);
  }
  
  /**
   * Edit a specific check-out
   */
  private async editCheckOut(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const apartmentId = match[1];
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.selectedApartmentId = apartmentId;
    
    // Find the apartment
    const apartment = MOCK_APARTMENTS.find(apt => apt.id === apartmentId);
    
    if (!apartment) {
      await ctx.reply(`Помилка: Квартиру з ID ${apartmentId} не знайдено.`);
      return;
    }
    
    await this.cleanupMessages(ctx);
    
    // Show editing keyboard
    await this.showKeyboard(ctx, 'checkout_edit', 
      `📝 *Редагування виїзду - ${apartment.id}*\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📍 *Адреса:* ${apartment.address}\n\n` +
      `*Поточні дані:*\n` +
      `⏰ *Час:* ${apartment.checkOut}\n` +
      `🔑 *Ключі:* ${apartment.keys}\n` +
      `💰 *Сума:* ${apartment.money}\n\n` +
      `*Оберіть параметр для редагування:*`
    );
  }
  
  /**
   * Edit check-out time
   */
  private async editCheckOutTime(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    if (!state.currentData || !state.currentData.selectedApartmentId) {
      await ctx.reply('Помилка: Не вибрано квартиру для редагування.');
      return;
    }
    
    state.currentData.editingField = 'time';
    
    await ctx.reply('⏰ Введіть новий час виїзду у форматі HH:MM\nНаприклад: 12:00');
  }
  
  /**
   * Edit check-out keys
   */
  private async editCheckOutKeys(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    if (!state.currentData || !state.currentData.selectedApartmentId) {
      await ctx.reply('Помилка: Не вибрано квартиру для редагування.');
      return;
    }
    
    state.currentData.editingField = 'keys';
    
    await ctx.reply('🔑 Введіть кількість ключів\nНаприклад: 2 ключа');
  }
  
  /**
   * Edit check-out money
   */
  private async editCheckOutMoney(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    if (!state.currentData || !state.currentData.selectedApartmentId) {
      await ctx.reply('Помилка: Не вибрано квартиру для редагування.');
      return;
    }
    
    state.currentData.editingField = 'money';
    
    await ctx.reply('💰 Введіть суму оплати\nНаприклад: 500 грн');
  }
  
  /**
   * Back to check-outs list
   */
  private async backToCheckOuts(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    
    // Clear apartment selection
    if (state.currentData) {
      state.currentData.selectedApartmentId = undefined;
      state.currentData.editingField = undefined;
    }
    
    await this.showCheckOuts(ctx);
  }
  
  /**
   * Show user management
   */
  private async showUserManagement(ctx: TelegramContext): Promise<void> {
    await this.cleanupMessages(ctx);
    
    // Show only navigation keyboard without message menu
    await this.showKeyboard(ctx, 'users_nav', 'Керування користувачами');
    
    // Initialize or get state
    const state = this.getUserState(ctx.userId);
    if (!state.currentData) {
      state.currentData = {};
    }
    
    // Default to page 1 if not set
    state.currentData.page = state.currentData.page || 1;
    
    // Show users list with pagination
    await this.sendUsersList(ctx, state.currentData.page!, false);
  }
  
  /**
   * Send users list with pagination
   */
  private async sendUsersList(
    ctx: TelegramContext, 
    page: number = 1, 
    forEditing: boolean = false
  ): Promise<void> {
    try {
      // Get real users from Firebase
      const users = await findAllUsers();
      
      const PAGE_SIZE = 5;
      const totalUsers = users.length;
      const totalPages = Math.ceil(totalUsers / PAGE_SIZE);
      const currentPage = Math.min(page, totalPages || 1);
      const startIdx = (currentPage - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalUsers);
      
      const pageUsers = users.slice(startIdx, endIdx);
      
      // Generate message text
      let text = `*Список користувачів (${currentPage}/${totalPages || 1}):*\n\n`;
      
      if (pageUsers.length === 0) {
        text += "Користувачів не знайдено.";
      } else {
        pageUsers.forEach(user => {
          const displayName = user.username ? 
            `@${user.username}` : 
            `${user.firstName} ${user.lastName || ''}`.trim();
          
          text += `👤 *${displayName}* (ID: ${user.telegramId})\n`;
          text += `🔑 *Роль:* ${user.role}\n`;
          text += `📊 *Статус:* ${user.status}\n\n`;
        });
      }
      
      // Create keyboard for pagination
      const buttons: KeyboardButtonConfig[] = [];
      
      if (forEditing) {
        // In edit mode, add user edit buttons
        pageUsers.forEach((user, index) => {
          const displayName = user.username ? 
            `@${user.username}` : 
            `${user.firstName} ${user.lastName || ''}`.trim();
            
          buttons.push({ 
            text: `✏️ ${displayName}`, 
            action: `edit_user_${user.id}`, 
            role: 'admin', 
            position: { row: index, col: 0 } 
          });
        });
        
        // Add cancel button
        buttons.push({ 
          text: '❌ Скасувати', 
          action: 'cancel_user_edit', 
          role: 'admin', 
          position: { row: pageUsers.length, col: 0 } 
        });
      } else {
        // Navigation row: Previous page, Edit, Next page
        const navRow: KeyboardButtonConfig[] = [];
        
        if (currentPage > 1) {
          navRow.push({ 
            text: '⬅️', 
            action: `user_page_${currentPage - 1}`, 
            role: 'admin', 
            position: { row: 0, col: 0 } 
          });
        }
        
        navRow.push({ 
          text: '✏️ Редагувати', 
          action: `show_user_edit_${currentPage}`, 
          role: 'admin', 
          position: { row: 0, col: 1 } 
        });
        
        if (currentPage < totalPages) {
          navRow.push({ 
            text: '➡️', 
            action: `user_page_${currentPage + 1}`, 
            role: 'admin', 
            position: { row: 0, col: 2 } 
          });
        }
        
        buttons.push(...navRow);
        
        // Add user management buttons
        buttons.push({ 
          text: '➕ Додати користувача', 
          action: 'add_user', 
          role: 'admin', 
          position: { row: 1, col: 0 } 
        });
        
        // Back button
        buttons.push({ 
          text: '↩️ Назад', 
          action: 'admin_panel', 
          role: 'admin', 
          position: { row: 2, col: 0 } 
        });
      }
      
      const message = await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(buttons, true)
      });
      
      // Store for cleanup
      this.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[KeyboardService] Error sending users list:`, error);
      await ctx.reply('Помилка при відображенні списку користувачів. Спробуйте пізніше.');
    }
  }
  
  /**
   * Show user list (for callbacks only)
   */
  private async showUserList(ctx: TelegramContext, page = 0): Promise<void> {
    page = page || 0;
    await this.cleanupMessages(ctx);
    await this.sendUsersList(ctx, page + 1, false);
  }
  
  /**
   * Navigation to previous user page
   */
  private async showUserPrevPage(ctx: TelegramContext): Promise<void> {
    const state = this.getState(ctx.userId);
    const currentPage = state?.userListPage || 0;
    
    if (currentPage > 0) {
      await this.showUserList(ctx, currentPage - 1);
    }
  }
  
  /**
   * Navigation to next user page
   */
  private async showUserNextPage(ctx: TelegramContext): Promise<void> {
    const state = this.getState(ctx.userId);
    const currentPage = state?.userListPage || 0;
    await this.showUserList(ctx, currentPage + 1);
  }
  
  /**
   * Show apartment management
   */
  private async showApartmentManagement(ctx: TelegramContext): Promise<void> {
    await this.cleanupMessages(ctx);
    
    // Show only navigation keyboard without message menu
    await this.showKeyboard(ctx, 'apartments_nav', 'Керування квартирами');
    
    // Initialize or get state
    const state = this.getUserState(ctx.userId);
    if (!state.currentData) {
      state.currentData = {};
    }
    
    // Default to page 1 if not set
    state.currentData.page = state.currentData.page || 1;
    
    // Show apartments list with pagination
    await this.sendApartmentsList(ctx, state.currentData.page!, false);
  }
  
  /**
   * Send apartments list with pagination using real data
   */
  private async sendApartmentsList(
    ctx: TelegramContext, 
    page: number = 1, 
    forEditing: boolean = false
  ): Promise<void> {
    try {
      // Get real apartments from Firebase
      const apartments = await findAllApartments();
      
      const PAGE_SIZE = 5;
      const totalApartments = apartments.length;
      const totalPages = Math.ceil(totalApartments / PAGE_SIZE);
      const currentPage = Math.min(page, totalPages || 1);
      const startIdx = (currentPage - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalApartments);
      
      const pageApartments = apartments.slice(startIdx, endIdx);
      
      // Generate message text
      let text = `*Список квартир (${currentPage}/${totalPages || 1}):*\n\n`;
      
      if (pageApartments.length === 0) {
        text += "Квартир не знайдено. Додайте першу квартиру.";
      } else {
        pageApartments.forEach(apt => {
          text += `🏠 *ID ${apt.id}:* ${apt.address}\n`;
          text += `📝 *Назва:* ${apt.name || 'Не вказано'}\n`;
          text += `🔑 *Ключів:* ${apt.standardKeysCount || 1}\n`;
          if (apt.notes) {
            text += `📌 *Примітки:* ${apt.notes}\n`;
          }
          text += `\n`;
        });
      }
      
      // Create keyboard for pagination
      const buttons: KeyboardButtonConfig[] = [];
      
      if (forEditing) {
        // In edit mode, add apartment edit buttons
        pageApartments.forEach((apt, index) => {
          buttons.push({ 
            text: `✏️ ${apt.id}: ${apt.address.substring(0, 20)}`, 
            action: `edit_apartment_${apt.id}`, 
            role: 'admin', 
            position: { row: index, col: 0 } 
          });
        });
        
        // Add cancel button
        buttons.push({ 
          text: '❌ Скасувати', 
          action: 'cancel_apartment_edit', 
          role: 'admin', 
          position: { row: pageApartments.length, col: 0 } 
        });
      } else {
        // Navigation row: Previous page, Edit, Next page
        const navRow: KeyboardButtonConfig[] = [];
        
        if (currentPage > 1) {
          navRow.push({ 
            text: '⬅️', 
            action: `apartment_page_${currentPage - 1}`, 
            role: 'admin', 
            position: { row: 0, col: 0 } 
          });
        }
        
        navRow.push({ 
          text: '✏️ Редагувати', 
          action: `show_apartment_edit_${currentPage}`, 
          role: 'admin', 
          position: { row: 0, col: 1 } 
        });
        
        if (currentPage < totalPages) {
          navRow.push({ 
            text: '➡️', 
            action: `apartment_page_${currentPage + 1}`, 
            role: 'admin', 
            position: { row: 0, col: 2 } 
          });
        }
        
        buttons.push(...navRow);
        
        // Add apartment management buttons
        buttons.push({ 
          text: '➕ Додати квартиру', 
          action: 'add_apartment', 
          role: 'admin', 
          position: { row: 1, col: 0 } 
        });
        
        // Back button
        buttons.push({ 
          text: '↩️ Назад', 
          action: 'admin_panel', 
          role: 'admin', 
          position: { row: 2, col: 0 } 
        });
      }
      
      const message = await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(buttons, true)
      });
      
      // Store for cleanup
      this.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[KeyboardService] Error sending apartments list:`, error);
      await ctx.reply('Помилка при відображенні списку квартир. Спробуйте пізніше.');
    }
  }
  
  /**
   * Go back to main menu
   */
  private async backToMainMenu(ctx: TelegramContext): Promise<void> {
    await this.showMenu(ctx);
  }
  
  /**
   * Process text input for apartment editing
   * Called externally from TelegramService when a user sends text after selecting a field to edit
   */
  public async processApartmentEdit(ctx: TelegramContext, text: string): Promise<boolean> {
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData || 
        !state.currentData.selectedApartmentId || 
        !state.currentData.editingField) {
      return false;
    }
    
    const apartmentId = state.currentData.selectedApartmentId;
    const editingField = state.currentData.editingField;
    const isCheckIn = state.currentKeyboard === 'checkin_edit';
    
    // Find the apartment
    const apartmentIndex = MOCK_APARTMENTS.findIndex(apt => apt.id === apartmentId);
    if (apartmentIndex === -1) {
      await ctx.reply(`Помилка: Квартиру з ID ${apartmentId} не знайдено.`);
      return false;
    }
    
    const apartment = MOCK_APARTMENTS[apartmentIndex];
    
    // Process the edit based on field
    switch (editingField) {
      case 'time':
        // Validate time format
        if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(text)) {
          await ctx.reply('❌ Неправильний формат часу\nВведіть у форматі HH:MM\nНаприклад: 14:00');
          return true;
        }
        
        if (isCheckIn) {
          MOCK_APARTMENTS[apartmentIndex].checkIn = text;
          await ctx.reply(`✅ Оновлено час заїзду для ${apartment.id} на ${text}`);
        } else {
          MOCK_APARTMENTS[apartmentIndex].checkOut = text;
          await ctx.reply(`✅ Оновлено час виїзду для ${apartment.id} на ${text}`);
        }
        break;
        
      case 'keys':
        MOCK_APARTMENTS[apartmentIndex].keys = `${text}`;
        await ctx.reply(`✅ Оновлено кількість ключів для ${apartment.id} на ${text}`);
        break;
        
      case 'money':
        MOCK_APARTMENTS[apartmentIndex].money = `${text}`;
        await ctx.reply(`✅ Оновлено суму для ${apartment.id} на ${text}`);
        break;
        
      default:
        return false;
    }
    
    // Show updated apartment info
    if (isCheckIn) {
        const fakeMatch = Object.assign([null, apartmentId], {
          index: 0,
          input: '',
          groups: undefined
        }) as RegExpExecArray;
        await this.editCheckIn(ctx, fakeMatch);
      } else {
        const fakeMatch = Object.assign([null, apartmentId], {
          index: 0,
          input: '',
          groups: undefined
        }) as RegExpExecArray;
        await this.editCheckOut(ctx, fakeMatch);
      }
    
    return true;
  }

  /**
   * Handle user page navigation
   */
  private async handleUserPage(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    
    await this.cleanupMessages(ctx);
    await this.sendUsersList(ctx, state.currentData.page, false);
  }
  
  /**
   * Show user edit mode
   */
  private async showUserEditMode(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    
    await this.cleanupMessages(ctx);
    await this.sendUsersList(ctx, state.currentData.page, true);
  }
  
  /**
   * Cancel user edit mode
   */
  private async cancelUserEdit(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = state.currentData.page || 1;
    
    await this.cleanupMessages(ctx);
    await this.sendUsersList(ctx, state.currentData.page, false);
  }
  
  /**
   * Add a new user (placeholder)
   */
  private async addUser(ctx: TelegramContext): Promise<void> {
    await ctx.reply('🔄 Функція додавання користувача буде реалізована пізніше.');
  }
  
  /**
   * Handle apartment page navigation
   */
  private async handleApartmentPage(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    
    await this.cleanupMessages(ctx);
    await this.sendApartmentsList(ctx, state.currentData.page, false);
  }
  
  /**
   * Show apartment edit mode
   */
  private async showApartmentEditMode(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const page = parseInt(match[1]);
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = page;
    
    await this.cleanupMessages(ctx);
    await this.sendApartmentsList(ctx, state.currentData.page, true);
  }
  
  /**
   * Cancel apartment edit mode
   */
  private async cancelApartmentEdit(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData) {
      state.currentData = {};
    }
    
    state.currentData.page = state.currentData.page || 1;
    
    await this.cleanupMessages(ctx);
    await this.sendApartmentsList(ctx, state.currentData.page, false);
  }
  
  /**
   * Add a new apartment (placeholder)
   */
  private async startAddApartment(ctx: TelegramContext): Promise<void> {
    const state = this.getUserState(ctx.userId);
    state.currentData = {
      apartmentCreation: {
        step: 'id'
      }
    };
    
    await ctx.reply('🏠 Введіть ID нової квартири (унікальний код):');
  }

  /**
   * Process apartment creation steps
   */
  public async processAddApartment(ctx: TelegramContext, text: string): Promise<boolean> {
    const state = this.getUserState(ctx.userId);
    
    if (!state.currentData?.apartmentCreation) {
      return false;
    }
    
    const apartmentCreation = state.currentData.apartmentCreation;
    
    try {
      const step = apartmentCreation.step;
      
      switch(step) {
        case 'id':
          // Validate ID
          const id = text.trim();
          if (!id) {
            await ctx.reply('❌ ID не може бути порожнім. Введіть унікальний ID:');
            return true;
          }
          
          // Check if apartment already exists
          const existingApt = await findAllApartments();
          if (existingApt.some(apt => apt.id === id)) {
            await ctx.reply(`❌ Квартира з ID "${id}" вже існує. Введіть інший ID:`);
            return true;
          }
          
          // Store ID and move to next step
          apartmentCreation.id = id;
          apartmentCreation.step = 'address';
          await ctx.reply('Введіть адресу квартири:');
          return true;
          
        case 'address':
          // Store address and move to next step
          apartmentCreation.address = text.trim();
          apartmentCreation.step = 'name';
          await ctx.reply('Введіть назву квартири (або "-" якщо немає):');
          return true;
          
        case 'name':
          // Store name and move to next step
          apartmentCreation.name = text.trim() === '-' ? '' : text.trim();
          apartmentCreation.step = 'keys';
          await ctx.reply('Введіть стандартну кількість ключів (число):');
          return true;
          
        case 'keys':
          // Validate and store keys count
          const keysCount = parseInt(text.trim());
          if (isNaN(keysCount) || keysCount < 0) {
            await ctx.reply('❌ Некоректна кількість ключів. Введіть додатне число:');
            return true;
          }
          
          apartmentCreation.keys = keysCount;
          apartmentCreation.step = 'notes';
          await ctx.reply('Введіть примітки для квартири (або "-" якщо немає):');
          return true;
          
        case 'notes':
          // Store notes and create apartment
          apartmentCreation.notes = text.trim() === '-' ? '' : text.trim();
          
          // Create apartment
          const newApartment = {
            id: apartmentCreation.id!,
            address: apartmentCreation.address!,
            name: apartmentCreation.name,
            standardKeysCount: apartmentCreation.keys || 1,
            notes: apartmentCreation.notes,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          };
          
          await createApartmentRepo(newApartment);
          
          await ctx.reply(`✅ Квартиру "${newApartment.id}" успішно створено!`);
          
          // Return to apartment management
          setTimeout(() => {
            this.showApartmentManagement(ctx);
          }, 1000);
          
          return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`[KeyboardService] Error processing add apartment:`, error);
      await ctx.reply('Помилка при створенні квартири. Спробуйте пізніше.');
      return true;
    }
  }
  
  /**
   * Edit user details
   */
  private async editUser(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const userId = match[1];
    
    try {
      const user = await findById(userId);
      if (!user) {
        await ctx.reply(`Користувача з ID ${userId} не знайдено.`);
        return;
      }
      
      const messageText = `✏️ *Редагування користувача:*\n\n` +
        `👤 *${user.firstName} ${user.lastName || ''}*\n` +
        `🔤 Username: ${user.username ? '@'+user.username : 'Не вказано'}\n` +
        `🆔 ID: ${user.telegramId}\n` +
        `🔑 Роль: ${user.role}\n` +
        `📊 Статус: ${user.status}\n\n` +
        `Оберіть дію:`;
      
      const buttons: KeyboardButtonConfig[] = [
        { 
          text: '🔄 Змінити роль', 
          action: `change_role:${userId}`, 
          role: 'admin', 
          position: { row: 0, col: 0 } 
        },
        { 
          text: user.status === 'active' ? '🔴 Деактивувати' : '🟢 Активувати', 
          action: `toggle_status:${userId}`, 
          role: 'admin', 
          position: { row: 1, col: 0 } 
        },
        { 
          text: '🗑️ Видалити користувача', 
          action: `delete_user:${userId}`, 
          role: 'admin', 
          position: { row: 2, col: 0 } 
        },
        { 
          text: '↩️ Назад', 
          action: 'user_list', 
          role: 'admin', 
          position: { row: 3, col: 0 } 
        }
      ];
      
      const message = await ctx.reply(messageText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(buttons, true)
      });
      
      this.storeMessageId(ctx.userId, message.message_id);
      this.updateUserState(ctx.userId, { editingUser: user as any });
    } catch (error) {
      logger.error(`[KeyboardService] Error editing user:`, error);
      await ctx.reply('Помилка при редагуванні користувача. Спробуйте пізніше.');
    }
  }
  
  /**
   * Change the role of a user
   */
  private async changeUserRole(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const userId = match[1];
    
    try {
      const user = await findById(userId);
      if (!user) {
        await ctx.reply(`Користувача з ID ${userId} не знайдено.`);
        return;
      }
      
      const messageText = `🔄 *Зміна ролі користувача:*\n\n` +
        `👤 *${user.firstName} ${user.lastName || ''}*\n` +
        `🔑 Поточна роль: ${user.role}\n\n` +
        `Оберіть нову роль:`;
      
      const buttons: KeyboardButtonConfig[] = [
        { 
          text: 'Адміністратор', 
          action: `set_role:${userId}:admin`, 
          role: 'admin', 
          position: { row: 0, col: 0 } 
        },
        { 
          text: 'Прибиральник', 
          action: `set_role:${userId}:cleaner`, 
          role: 'admin', 
          position: { row: 1, col: 0 } 
        },
        { 
          text: 'Користувач', 
          action: `set_role:${userId}:user`, 
          role: 'admin', 
          position: { row: 2, col: 0 } 
        },
        { 
          text: '↩️ Скасувати', 
          action: `edit_user_${userId}`, 
          role: 'admin', 
          position: { row: 3, col: 0 } 
        }
      ];
      
      const message = await ctx.reply(messageText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(buttons, true)
      });
      
      this.storeMessageId(ctx.userId, message.message_id);
    } catch (error) {
      logger.error(`[KeyboardService] Error changing user role:`, error);
      await ctx.reply('Помилка при зміні ролі користувача. Спробуйте пізніше.');
    }
  }
  
  /**
   * Set user role
   */
  private async setUserRole(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const userId = match[1];
    const role = match[2] as 'admin' | 'cleaner' | 'user';
    
    try {
      // First check if user exists
      const user = await findById(userId);
      if (!user) {
        await ctx.reply(`Користувача з ID ${userId} не знайдено.`);
        return;
      }
      
      const result = await updateUserRepo(userId, { 
        role, 
        updatedAt: Timestamp.now().toDate() 
      });
      
      if (result) {
        await ctx.reply(`✅ Роль користувача змінено на "${role}".`);
        
        // Show edit screen again
        const fakeMatch = Object.assign([null, userId], {
          index: 0,
          input: '',
          groups: undefined
        }) as RegExpExecArray;
        
        await this.editUser(ctx, fakeMatch);
      } else {
        await ctx.reply('❌ Не вдалося змінити роль користувача.');
      }
    } catch (error) {
      logger.error(`[KeyboardService] Error setting user role:`, error);
      await ctx.reply('Помилка при зміні ролі користувача. Спробуйте пізніше.');
    }
  }
  
  /**
   * Toggle user status
   */
  private async toggleUserStatus(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const userId = match[1];
    
    try {
      const user = await findById(userId);
      if (!user) {
        await ctx.reply(`Користувача з ID ${userId} не знайдено.`);
        return;
      }
      
      const newStatus = user.status === 'active' ? 'inactive' : 'active';
      
      const result = await updateUserRepo(userId, { 
        status: newStatus, 
        updatedAt: Timestamp.now().toDate() 
      });
      
      if (result) {
        await ctx.reply(`✅ Статус користувача змінено на "${newStatus}".`);
        
        // Show edit screen again
        const fakeMatch = Object.assign([null, userId], {
          index: 0,
          input: '',
          groups: undefined
        }) as RegExpExecArray;
        
        await this.editUser(ctx, fakeMatch);
      } else {
        await ctx.reply('❌ Не вдалося змінити статус користувача.');
      }
    } catch (error) {
      logger.error(`[KeyboardService] Error toggling user status:`, error);
      await ctx.reply('Помилка при зміні статусу користувача. Спробуйте пізніше.');
    }
  }
  
  /**
   * Confirm user deletion
   */
  private async startDeleteUser(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const userId = match[1];
    
    try {
      const user = await findById(userId);
      if (!user) {
        await ctx.reply(`Користувача з ID ${userId} не знайдено.`);
        return;
      }
      
      const messageText = `⚠️ *Видалення користувача:*\n\n` +
        `👤 *${user.firstName} ${user.lastName || ''}*\n` +
        `🔤 Username: ${user.username ? '@'+user.username : 'Не вказано'}\n` +
        `🆔 ID: ${user.telegramId}\n\n` +
        `⚠️ Ця дія незворотня. Ви впевнені?`;
      
      const buttons: KeyboardButtonConfig[] = [
        { 
          text: '✅ Так, видалити', 
          action: `confirm_delete_user:${userId}`, 
          role: 'admin', 
          position: { row: 0, col: 0 } 
        },
        { 
          text: '❌ Ні, скасувати', 
          action: `edit_user_${userId}`, 
          role: 'admin', 
          position: { row: 1, col: 0 } 
        }
      ];
      
      const message = await ctx.reply(messageText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(buttons, true)
      });
      
      this.storeMessageId(ctx.userId, message.message_id);
    } catch (error) {
      logger.error(`[KeyboardService] Error showing delete confirmation:`, error);
      await ctx.reply('Помилка при відображенні підтвердження видалення. Спробуйте пізніше.');
    }
  }
  
  /**
   * Confirm and delete a user
   */
  private async confirmDeleteUser(ctx: TelegramContext, match: RegExpExecArray): Promise<void> {
    const userId = match[1];
    
    try {
      const result = await deleteUser(userId);
      
      if (result) {
        await ctx.reply(`✅ Користувача успішно видалено.`);
        // Show user list
        setTimeout(() => {
          this.showUserManagement(ctx);
        }, 1000);
      } else {
        await ctx.reply('❌ Не вдалося видалити користувача.');
      }
    } catch (error) {
      logger.error(`[KeyboardService] Error deleting user:`, error);
      await ctx.reply('Помилка при видаленні користувача. Спробуйте пізніше.');
    }
  }
} 