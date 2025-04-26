import { logger } from 'firebase-functions';
import { ActionHandler } from '../actionHandler';
import { TelegramContext, KeyboardManager } from '../keyboardManager';
import { findByTelegramId } from '../../../repositories/userRepository';
import { UserRoles } from '../../../utils/constants';

/**
 * MenuHandler - Handles basic menu navigation
 */
export class MenuHandler implements ActionHandler {
  constructor(
    private keyboardManager: KeyboardManager
  ) {}
  
  /**
   * Main action handler
   */
  async handleAction(ctx: TelegramContext, actionData?: string): Promise<void> {
    if (!actionData) return;
    
    switch (actionData) {
      case 'show_menu':
        await this.showMenu(ctx);
        break;
      case 'help':
        await this.showHelp(ctx);
        break;
      case 'about':
        await this.showAbout(ctx);
        break;
      case 'admin_panel':
        await this.showAdminPanel(ctx);
        break;
      case 'back_to_main':
        await this.backToMainMenu(ctx);
        break;
      default:
        // Unknown action for this handler
        logger.warn(`[MenuHandler] Unknown action: ${actionData}`);
    }
  }
  
  /**
   * Show the main menu
   */
  public async showMenu(ctx: TelegramContext, preserveMessages: boolean = false): Promise<void> {
    if (!preserveMessages) {
      await this.keyboardManager.cleanupMessages(ctx);
    }
    
    await this.keyboardManager.showKeyboard(ctx, 'main_nav', '*Головне меню*\nВиберіть опцію:');
  }
  
  /**
   * Show help information
   */
  public async showHelp(ctx: TelegramContext): Promise<void> {
    await this.keyboardManager.cleanupMessages(ctx);
    
    const helpText = `*Допомога*\n\n` +
                     `Цей бот допомагає керувати завданнями з прибирання апартаментів.\n\n` +
                     `Команди:\n` +
                     `- /menu - Відкрити головне меню\n` +
                     `- /help - Показати цю довідку\n` +
                     `- /about - Інформація про бота\n` +
                     `- /get_my_tasks - Показати мої завдання\n`;
    
    await ctx.reply(helpText, { parse_mode: 'Markdown' });
    await this.keyboardManager.showKeyboard(ctx, 'main_nav');
  }
  
  /**
   * Show about information
   */
  public async showAbout(ctx: TelegramContext): Promise<void> {
    await this.keyboardManager.cleanupMessages(ctx);
    
    const aboutText = `*Про бота*\n\n` +
                      `Бот для керування апартаментами та завданнями з прибирання.\n\n` +
                      `Версія: 1.0.0\n`;
    
    await ctx.reply(aboutText, { parse_mode: 'Markdown' });
    await this.keyboardManager.showKeyboard(ctx, 'main_nav');
  }
  
  /**
   * Show admin panel (only for admins)
   */
  public async showAdminPanel(ctx: TelegramContext): Promise<void> {
    // Check if user is admin
    const user = await findByTelegramId(String(ctx.userId));
    const isAdmin = user?.role === UserRoles.ADMIN;
    
    if (!isAdmin) {
      await ctx.reply('У вас немає прав для доступу до адмін-панелі.');
      return;
    }
    
    await this.keyboardManager.cleanupMessages(ctx);
    await this.keyboardManager.showKeyboard(ctx, 'admin_nav', '*Адмін-панель*\nВиберіть опцію:');
  }
  
  /**
   * Return to main menu
   */
  public async backToMainMenu(ctx: TelegramContext): Promise<void> {
    await this.keyboardManager.cleanupMessages(ctx);
    await this.keyboardManager.showKeyboard(ctx, 'main_nav', '*Головне меню*\nВиберіть опцію:');
  }
} 