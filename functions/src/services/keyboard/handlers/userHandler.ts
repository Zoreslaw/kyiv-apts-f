import { logger } from 'firebase-functions';
import { ActionHandler } from '../actionHandler';
import { TelegramContext, KeyboardManager } from '../keyboardManager';
import { Timestamp } from 'firebase-admin/firestore';
import { User } from '../../../models/User';
import { UserRoles } from '../../../utils/constants';
import { createInlineKeyboard, KeyboardButtonConfig } from '../../../constants/keyboards';
import { findByUserId } from '../../../repositories/cleaningAssignmentRepository';
import { 
  findAllUsers,
  findByTelegramId,
  updateUser,
  deleteUser
} from '../../../repositories/userRepository';

/**
 * UserHandler - Handles all user-related keyboard actions
 * Provides methods for user management operations
 */
export class UserHandler implements ActionHandler {
  constructor(
    private keyboardManager: KeyboardManager
  ) {}
  
  /**
   * Main action handler
   */
  async handleAction(ctx: TelegramContext, actionData?: string): Promise<void> {
    if (!actionData) return;
    
    // Direct action handlers
    if (actionData === 'manage_users') {
      await this.showUsers(ctx);
      return;
    }
    
    if (actionData === 'list_users') {
      await this.listUsers(ctx);
      return;
    }
    
    if (actionData === 'delete_user') {
      await this.startDeleteUser(ctx);
      return;
    }
    
    if (actionData === 'user_prev_page') {
      await this.navigateUserList(ctx, -1);
      return;
    }
    
    if (actionData === 'user_next_page') {
      await this.navigateUserList(ctx, 1);
      return;
    }
    
    if (actionData === 'cancel_user_edit') {
      await this.cancelUserEdit(ctx);
      return;
    }
    
    if (actionData === 'back_to_users') {
      await this.backToUsersList(ctx);
      return;
    }
    
    // Handle regex patterns
    const userPageMatch = /^user_page_(\d+)$/.exec(actionData);
    if (userPageMatch) {
      await this.showUserPage(ctx, parseInt(userPageMatch[1]));
      return;
    }
    
    const editUserMatch = /^edit_user_(.+)$/.exec(actionData);
    if (editUserMatch) {
      await this.editUser(ctx, editUserMatch[1]);
      return;
    }
    
    const confirmDeleteUserMatch = /^confirm_delete_user_(.+)$/.exec(actionData);
    if (confirmDeleteUserMatch) {
      await this.confirmDeleteUser(ctx, confirmDeleteUserMatch[1]);
      return;
    }
    
    const deleteUserConfirmedMatch = /^delete_user_confirmed_(.+)$/.exec(actionData);
    if (deleteUserConfirmedMatch) {
      await this.deleteUserConfirmed(ctx, deleteUserConfirmedMatch[1]);
      return;
    }
    
    const setUserRoleMatch = /^set_user_role_(.+)_(.+)$/.exec(actionData);
    if (setUserRoleMatch) {
      await this.setUserRole(ctx, setUserRoleMatch[1], setUserRoleMatch[2]);
      return;
    }
    
    const setUserStatusMatch = /^set_user_status_(.+)_(.+)$/.exec(actionData);
    if (setUserStatusMatch) {
      await this.setUserStatus(ctx, setUserStatusMatch[1], setUserStatusMatch[2] as 'active' | 'inactive');
      return;
    }
  }
  
  /**
   * Show users management view
   */
  public async showUsers(ctx: TelegramContext): Promise<void> {
    await this.keyboardManager.cleanupMessages(ctx);
    
    // Show users navigation keyboard
    await this.keyboardManager.showKeyboard(ctx, 'users_nav', 'Керування користувачами');
    
    // Show users list
    await this.listUsers(ctx);
  }
  
  /**
   * List all users with pagination
   */
  private async listUsers(ctx: TelegramContext, page: number = 1): Promise<void> {
    try {
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Get all users from repository
      const users = await findAllUsers();
      
      const PAGE_SIZE = 5;
      const totalUsers = users.length;
      const totalPages = Math.ceil(totalUsers / PAGE_SIZE);
      const startIdx = (page - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalUsers);
      
      const pageUsers = users.slice(startIdx, endIdx);
      
      // Generate message text
      let text = `*Список користувачів (${page}/${totalPages || 1}):*\n\n`;
      
      if (pageUsers.length === 0) {
        text += "Користувачів не знайдено.";
      } else {
        pageUsers.forEach((user, index) => {
          const roleEmoji = user.role === UserRoles.ADMIN ? '👑' : 
                           user.role === UserRoles.CLEANER ? '🧹' : '👤';
          const statusEmoji = user.status === 'active' ? '🟢' : '🔴';
          
          text += `${index + 1}. ${roleEmoji} ${user.firstName} ${user.lastName || ''}\n`;
          text += `   ${statusEmoji} Статус: ${user.status === 'active' ? 'Активний' : 'Неактивний'}\n`;
          text += `   🆔 ID: ${user.telegramId}\n`;
          if (user.username) {
            text += `   👤 Username: @${user.username}\n`;
          }
          text += `   🏠 Призначені квартири: ${user.assignedApartmentIds?.length || 0}\n\n`;
        });
      }
      
      // Create navigation buttons
      const buttons: KeyboardButtonConfig[] = [];
      
      // Edit button
      buttons.push({
        text: '✏️ Редагувати',
        action: `user_page_${page}`,
        role: 'admin',
        position: { row: 0, col: 0 }
      });
      
      // Navigation buttons
      if (page > 1) {
        buttons.push({ 
          text: '⬅️ Попередня', 
          action: 'user_prev_page', 
          role: 'admin', 
          position: { row: 1, col: 0 } 
        });
      }
      
      if (page < totalPages) {
        buttons.push({ 
          text: 'Наступна ➡️', 
          action: 'user_next_page', 
          role: 'admin', 
          position: { row: 1, col: 1 } 
        });
      }
      
      // Back button
      buttons.push({
        text: '↩️ Назад',
        action: 'admin_panel',
        role: 'admin',
        position: { row: 2, col: 0 }
      });
      
      // Store current page in state
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData) {
        state.currentData = {};
      }
      state.currentData.userListPage = page;
      
      // Send message with inline keyboard
      const message = await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(buttons, true)
      });
      
      // Store for cleanup
      this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[UserHandler] Error listing users:`, error);
      await ctx.reply('Помилка при відображенні списку користувачів. Спробуйте пізніше.');
    }
  }
  
  /**
   * Navigate user list pages
   */
  private async navigateUserList(ctx: TelegramContext, offset: number): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    const currentPage = state.currentData?.userListPage || 1;
    const newPage = Math.max(1, currentPage + offset);
    
    await this.listUsers(ctx, newPage);
  }
  
  /**
   * Show user page with edit options
   */
  private async showUserPage(ctx: TelegramContext, page: number): Promise<void> {
    try {
      // Clean up any previous messages
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Get users for current page
      const users = await findAllUsers();
      
      const PAGE_SIZE = 5;
      const startIdx = (page - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, users.length);
      
      const pageUsers = users.slice(startIdx, endIdx);
      
      if (pageUsers.length === 0) {
        await ctx.reply('Немає користувачів для редагування на цій сторінці.');
        return;
      }
      
      // Create edit buttons for each user
      const buttons: KeyboardButtonConfig[] = pageUsers.map((user, index) => {
        const roleEmoji = user.role === UserRoles.ADMIN ? '👑' : 
                          user.role === UserRoles.CLEANER ? '🧹' : '👤';
        const statusEmoji = user.status === 'active' ? '🟢' : '🔴';
        
        return {
          text: `${roleEmoji} ${statusEmoji} ${user.firstName} ${user.lastName || ''}`,
          action: `edit_user_${user.telegramId}`,
          role: 'admin',
          position: { row: index, col: 0 }
        };
      });
      
      // Add cancel button
      buttons.push({
        text: '❌ Скасувати',
        action: 'cancel_user_edit',
        role: 'admin',
        position: { row: pageUsers.length, col: 0 }
      });
      
      const message = await ctx.reply('*Виберіть користувача для редагування:*', {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(buttons, true)
      });
      
      // Store for cleanup
      this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[UserHandler] Error showing user page:`, error);
      await ctx.reply('Помилка при відображенні сторінки користувачів. Спробуйте пізніше.');
    }
  }
  
  /**
   * Edit a specific user
   */
  private async editUser(ctx: TelegramContext, telegramId: string): Promise<void> {
    try {
      // Find user
      const user = await findByTelegramId(telegramId);
      
      if (!user) {
        await ctx.reply(`Помилка: Користувача з ID ${telegramId} не знайдено.`);
        return;
      }
      
      // Store the user being edited
      const state = this.keyboardManager.getUserState(ctx.userId);
      if (!state.currentData) {
        state.currentData = {};
      }
      state.currentData.editingUser = user;
      
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Get apartment assignments
      const assignment = await findByUserId(telegramId);
      const assignedApartments = assignment?.apartmentIds || [];
      
      // Create role buttons
      const roleButtons: KeyboardButtonConfig[] = [
        {
          text: user.role === UserRoles.ADMIN ? '👑 Адмін ✓' : '👑 Зробити адміном',
          action: `set_user_role_${user.telegramId}_${UserRoles.ADMIN}`,
          role: 'admin',
          position: { row: 0, col: 0 }
        },
        {
          text: user.role === UserRoles.CLEANER ? '🧹 Клінер ✓' : '🧹 Зробити клінером',
          action: `set_user_role_${user.telegramId}_${UserRoles.CLEANER}`,
          role: 'admin',
          position: { row: 0, col: 1 }
        },
        {
          text: user.role === UserRoles.USER ? '👤 Користувач ✓' : '👤 Зробити користувачем',
          action: `set_user_role_${user.telegramId}_${UserRoles.USER}`,
          role: 'admin',
          position: { row: 1, col: 0 }
        }
      ];
      
      // Create status buttons
      const statusButtons: KeyboardButtonConfig[] = [
        {
          text: user.status === 'active' ? '🟢 Активний ✓' : '🟢 Активувати',
          action: `set_user_status_${user.telegramId}_active`,
          role: 'admin',
          position: { row: 2, col: 0 }
        },
        {
          text: user.status === 'inactive' ? '🔴 Неактивний ✓' : '🔴 Деактивувати',
          action: `set_user_status_${user.telegramId}_inactive`,
          role: 'admin',
          position: { row: 2, col: 1 }
        }
      ];
      
      // Create delete button
      const deleteButton: KeyboardButtonConfig = {
        text: '🗑️ Видалити користувача',
        action: `confirm_delete_user_${user.telegramId}`,
        role: 'admin',
        position: { row: 3, col: 0 }
      };
      
      // Create back button
      const backButton: KeyboardButtonConfig = {
        text: '↩️ Назад до списку',
        action: 'back_to_users',
        role: 'admin',
        position: { row: 4, col: 0 }
      };
      
      // All buttons
      const buttons: KeyboardButtonConfig[] = [...roleButtons, ...statusButtons, deleteButton, backButton];
      
      // Format user info
      const roleEmoji = user.role === UserRoles.ADMIN ? '👑' : 
                       user.role === UserRoles.CLEANER ? '🧹' : '👤';
      const statusEmoji = user.status === 'active' ? '🟢' : '🔴';
      
      let infoText = `*Редагування користувача:*\n\n`;
      infoText += `👤 *${user.firstName} ${user.lastName || ''}*\n`;
      infoText += `${roleEmoji} Роль: ${user.role}\n`;
      infoText += `${statusEmoji} Статус: ${user.status === 'active' ? 'Активний' : 'Неактивний'}\n`;
      infoText += `🆔 Telegram ID: ${user.telegramId}\n`;
      
      if (user.username) {
        infoText += `👤 Username: @${user.username}\n`;
      }
      
      // Add apartment assignment information
      if (assignedApartments.length > 0) {
        infoText += `🏠 Призначені квартири: ${assignedApartments.join(', ')}\n`;
      } else {
        infoText += `🏠 Немає призначених квартир\n`;
      }
      
      infoText += `\n*Виберіть дію:*`;
      
      const message = await ctx.reply(infoText, {
        parse_mode: 'Markdown',
        reply_markup: createInlineKeyboard(buttons, true)
      });
      
      // Store for cleanup
      this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[UserHandler] Error editing user:`, error);
      await ctx.reply('Помилка при редагуванні користувача. Спробуйте пізніше.');
    }
  }
  
  /**
   * Set user role
   */
  private async setUserRole(ctx: TelegramContext, telegramId: string, role: string): Promise<void> {
    try {
      const user = await findByTelegramId(telegramId);
      
      if (!user || !user.id) {
        await ctx.reply(`Помилка: Користувача з ID ${telegramId} не знайдено.`);
        return;
      }
      
      if (user.role === role) {
        await ctx.reply(`Користувач вже має роль ${role}`);
        return;
      }
      
      // Update user
      await updateUser(user.id, {
        role: role as "admin" | "cleaner" | "user",
        updatedAt: new Date()
      });
      
      await ctx.reply(`✅ Роль користувача ${user.firstName} змінено на ${role}`);
      
      // Refresh edit view
      await this.editUser(ctx, telegramId);
      
    } catch (error) {
      logger.error(`[UserHandler] Error setting user role:`, error);
      await ctx.reply('Помилка при зміні ролі користувача. Спробуйте пізніше.');
    }
  }
  
  /**
   * Set user status
   */
  private async setUserStatus(ctx: TelegramContext, telegramId: string, status: 'active' | 'inactive'): Promise<void> {
    try {
      const user = await findByTelegramId(telegramId);
      
      if (!user || !user.id) {
        await ctx.reply(`Помилка: Користувача з ID ${telegramId} не знайдено.`);
        return;
      }
      
      if (user.status === status) {
        await ctx.reply(`Користувач вже має статус ${status === 'active' ? 'активний' : 'неактивний'}`);
        return;
      }
      
      // Update user
      await updateUser(user.id, {
        status,
        updatedAt: new Date()
      });
      
      await ctx.reply(`✅ Статус користувача ${user.firstName} змінено на ${status === 'active' ? 'активний' : 'неактивний'}`);
      
      // Refresh edit view
      await this.editUser(ctx, telegramId);
      
    } catch (error) {
      logger.error(`[UserHandler] Error setting user status:`, error);
      await ctx.reply('Помилка при зміні статусу користувача. Спробуйте пізніше.');
    }
  }
  
  /**
   * Confirm delete user
   */
  private async confirmDeleteUser(ctx: TelegramContext, telegramId: string): Promise<void> {
    try {
      const user = await findByTelegramId(telegramId);
      
      if (!user || !user.id) {
        await ctx.reply(`Помилка: Користувача з ID ${telegramId} не знайдено.`);
        return;
      }
      
      await this.keyboardManager.cleanupMessages(ctx);
      
      // Confirmation buttons
      const buttons: KeyboardButtonConfig[] = [
        {
          text: '✅ Так, видалити',
          action: `delete_user_confirmed_${user.id}`,
          role: 'admin',
          position: { row: 0, col: 0 }
        },
        {
          text: '❌ Ні, скасувати',
          action: `edit_user_${user.telegramId}`,
          role: 'admin',
          position: { row: 0, col: 1 }
        }
      ];
      
      const message = await ctx.reply(
        `⚠️ *Ви впевнені, що хочете видалити користувача?*\n\n` +
        `👤 *${user.firstName} ${user.lastName || ''}*\n` +
        `🆔 Telegram ID: ${user.telegramId}\n\n` +
        `Це незворотна дія!`,
        {
          parse_mode: 'Markdown',
          reply_markup: createInlineKeyboard(buttons, true)
        }
      );
      
      // Store for cleanup
      this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
      
    } catch (error) {
      logger.error(`[UserHandler] Error confirming user deletion:`, error);
      await ctx.reply('Помилка при підтвердженні видалення користувача. Спробуйте пізніше.');
    }
  }
  
  /**
   * Delete user (after confirmation)
   */
  private async deleteUserConfirmed(ctx: TelegramContext, userId: string): Promise<void> {
    try {
      // Delete user
      const result = await deleteUser(userId);
      
      if (result) {
        await ctx.reply('✅ Користувача успішно видалено');
      } else {
        await ctx.reply('❌ Не вдалося видалити користувача');
      }
      
      // Return to users list
      await this.listUsers(ctx);
      
    } catch (error) {
      logger.error(`[UserHandler] Error deleting user:`, error);
      await ctx.reply('Помилка при видаленні користувача. Спробуйте пізніше.');
    }
  }
  
  /**
   * Cancel user edit and return to list
   */
  private async cancelUserEdit(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    const page = state.currentData?.userListPage || 1;
    
    await this.listUsers(ctx, page);
  }
  
  /**
   * Return to users list
   */
  private async backToUsersList(ctx: TelegramContext): Promise<void> {
    // Clear editing user
    const state = this.keyboardManager.getUserState(ctx.userId);
    if (state.currentData) {
      state.currentData.editingUser = undefined;
    }
    
    const page = state.currentData?.userListPage || 1;
    await this.listUsers(ctx, page);
  }
  
  /**
   * Start process of deleting a user
   */
  private async startDeleteUser(ctx: TelegramContext): Promise<void> {
    const state = this.keyboardManager.getUserState(ctx.userId);
    const page = state.currentData?.userListPage || 1;
    
    await this.showUserPage(ctx, page);
  }
} 