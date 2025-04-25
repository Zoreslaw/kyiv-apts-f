import axios from "axios";
import { logger } from "firebase-functions";
import { defineString } from "firebase-functions/params";
import { AIService } from "./aiService";
import { TaskService } from "./taskService";
import { findOrCreateUser } from "./userService";
import { FunctionExecutionService } from "./functionExecutionService";
import { syncReservationsAndTasks } from "./syncService";
import { findByTelegramId } from "../repositories/userRepository";
import { findByUserId } from "../repositories/cleaningAssignmentRepository";
import { UserRoles } from "../utils/constants";
import { TelegramCoordinator } from "./keyboard/telegramCoordinator";
import { TelegramContext } from "./keyboard/keyboardManager";
import { updateUser } from "../repositories/userRepository";
import { Timestamp } from "firebase-admin/firestore";
import FormData from 'form-data';

// Types
interface TelegramMessage {
  chat: { id: string | number };
  from: { id: string | number; first_name?: string; last_name?: string; username?: string };
  text?: string;
  callback_query?: {
    data: string;
    message: {
      message_id: number;
    };
  };
}

interface TelegramResponse {
  ok: boolean;
  result: {
    message_id: number;
    chat: { id: number };
    text: string;
  };
}

// Constants
const botToken = defineString("TELEGRAM_BOT_TOKEN");
const TELEGRAM_API = `https://api.telegram.org/bot${botToken.value()}`;

export class TelegramService {
  private aiService: AIService;
  private taskService: TaskService;
  private functionService: FunctionExecutionService;
  private telegramCoordinator: TelegramCoordinator;

  constructor(openaiApiKey?: string) {
    this.aiService = new AIService();
    this.taskService = new TaskService();
    this.functionService = new FunctionExecutionService();
    this.telegramCoordinator = new TelegramCoordinator(this.taskService);
  }

  public async sendMessage(
    chatId: string | number,
    text: string,
    parseMode?: string,
    replyMarkup?: any
  ): Promise<{ message_id: number }> {
    const chatIdStr = String(chatId);
    try {
      const response = await axios.post<TelegramResponse>(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatIdStr,
        text,
        parse_mode: parseMode,
        reply_markup: replyMarkup,
      });
      return { message_id: response.data.result.message_id };
    } catch (error) {
      logger.error(`Error sending message to chat ${chatIdStr}:`, error);
      throw error;
    }
  }

  /**
   * Create a TelegramContext object for a specific user
   */
  private createContext(chatId: string | number, userId: string | number, extras?: { messageIdToEdit?: number }): TelegramContext {
    return {
      chatId,
      userId,
      messageIdToEdit: extras?.messageIdToEdit,
      reply: async (text: string, options?: any) => {
        // Handle message deletion option
        if (options?.delete_message_id) {
          try {
            await axios.post(`${TELEGRAM_API}/deleteMessage`, {
              chat_id: chatId,
              message_id: options.delete_message_id
            });
            return { message_id: 0 }; // Return dummy message ID for deleted messages
          } catch (error) {
            logger.warn(`Failed to delete message ${options.delete_message_id}:`, error);
          }
        }
        
        // Handle photo option
        if (options?.photo) {
          try {
            const formData = new FormData();
            formData.append('chat_id', String(chatId));
            
            if (options.photo.source) {
              // If source is provided, it's a buffer
              formData.append('photo', options.photo.source, 'photo.png');
            } else if (options.photo.url) {
              // If URL is provided
              formData.append('photo', options.photo.url);
            }
            
            if (options.caption) {
              formData.append('caption', options.caption);
            }
            
            if (options.parse_mode) {
              formData.append('parse_mode', options.parse_mode);
            }
            
            if (options.reply_markup) {
              formData.append('reply_markup', JSON.stringify(options.reply_markup));
            }
            
            const response = await axios.post<TelegramResponse>(`${TELEGRAM_API}/sendPhoto`, formData, {
              headers: formData.getHeaders()
            });
            
            return { message_id: response.data.result.message_id };
          } catch (error) {
            logger.error(`Error sending photo to chat ${chatId}:`, error);
            // Fall back to text message
            return this.sendMessage(
              chatId, 
              options.caption || text, 
              options.parse_mode, 
              options.reply_markup
            );
          }
        }
        
        return this.sendMessage(
          chatId, 
          text, 
          options?.parse_mode, 
          options?.reply_markup
        );
      },
      deleteMessage: async (messageId: number) => {
        try {
          await axios.post(`${TELEGRAM_API}/deleteMessage`, {
            chat_id: chatId,
            message_id: messageId
          });
        } catch (err) {
          logger.warn(`Failed to delete message ${messageId}:`, err);
        }
      }
    };
  }

  /**
   * Handle incoming messages from users
   */
  async handleMessage(message: TelegramMessage): Promise<void> {
    const { chat, text, from } = message;
    const chatId = String(chat.id);
    const userId = String(from.id);

    if (!text) {
      await this.sendMessage(chatId, "Будь ласка, надішліть текстове повідомлення.");
      return;
    }

    const user = await findByTelegramId(userId);
    const isAdmin = user?.role === UserRoles.ADMIN;
    const ctx = this.createContext(chatId, userId);

    // Check if we're in an editing mode and try to process the text input
    const isEditingTask = await this.telegramCoordinator.processText(ctx, text);
    if (isEditingTask) {
      return;
    }

    // Handle as keyboard action first (standard commands)
    switch (text) {
      case "/menu":
      case "⚙️ Меню":
        await this.telegramCoordinator.handleAction(ctx, 'show_menu');
        return;

      case "/help":
      case "❓ Допомога":
        await this.telegramCoordinator.handleAction(ctx, 'help');
        return;

      case "/about":
      case "ℹ️ Про бота":
        await this.telegramCoordinator.handleAction(ctx, 'about');
        return;

      case "/get_my_tasks":
      case "📋 Мої завдання":
        await this.telegramCoordinator.handleAction(ctx, 'show_tasks');
        return;
        
      case "/admin":
      case "👨‍💼 Адмін панель":
        if (isAdmin) {
          await this.telegramCoordinator.handleAction(ctx, 'admin_panel');
        } else {
          await ctx.reply("У вас немає доступу до адмін-панелі.");
        }
        return;
        
      // Admin menu button handlers
      case "Змінити заїзди":
        if (isAdmin) {
          await this.telegramCoordinator.handleAction(ctx, 'edit_checkins');
        } else {
          await ctx.reply("У вас немає доступу до цієї функції.");
        }
        return;
        
      case "Змінити виїзди":
        if (isAdmin) {
          await this.telegramCoordinator.handleAction(ctx, 'edit_checkouts');
        } else {
          await ctx.reply("У вас немає доступу до цієї функції.");
        }
        return;
        
      case "Користувачі":
        if (isAdmin) {
          await this.telegramCoordinator.handleAction(ctx, 'manage_users');
        } else {
          await ctx.reply("У вас немає доступу до цієї функції.");
        }
        return;
        
      case "Головне меню":
        await this.telegramCoordinator.handleAction(ctx, 'back_to_main');
        return;
        
      case "/admin":
      case "👨‍💼 Адмін панель":
        if (isAdmin) {
          await this.telegramCoordinator.handleAction(ctx, 'admin_panel');
        } else {
          await ctx.reply("У вас немає доступу до адмін-панелі.");
        }
        return;
      
      // Debug commands for development
      case "/makeadmin":
        await this.makeUserAdmin(ctx.userId, ctx);
        return;
    }

    // Try to handle as a direct action
    const mappedAction = this.telegramCoordinator.resolveActionFromText(text, userId);
    const isActionHandled = await this.telegramCoordinator.handleAction(ctx, mappedAction || text);
    if (isActionHandled) {
      return;
    }

    // Handle AI processing for other messages
    const assignment = await findByUserId(userId);
    const assignedApartments = assignment?.apartmentIds || [];
    const currentTasks = (await this.taskService.getTasksForUser(userId)).tasks || [];

    const result = await this.aiService.processMessage(text, {
      userId,
      chatId,
      isAdmin,
      assignedApartments,
      currentTasks
    });

    if (result.type === 'text') {
      await this.sendMessage(chatId, result.content || "*Операція успішно виконана.*", "Markdown");
    } else if (result.type === 'function_call' && result.function_call) {
      const functionResult = await this.functionService.executeFunction(
        result.function_call.name,
        {
          ...JSON.parse(result.function_call.arguments),
          userId
        }
      );
      
      const followUp = await this.aiService.processFunctionResult(
        chatId,
        result.function_call.name,
        JSON.parse(result.function_call.arguments),
        functionResult
      );
      
      await this.sendMessage(chatId, followUp.content, "Markdown");
    }
  }

  /**
   * Handle callback queries (button clicks)
   */
  async handleCallbackQuery(callbackQuery: {
    data: string;
    from: { id: number };
    message: {
      chat: { id: number };
      message_id: number
    }
  }): Promise<void>
  {
    const { data, from, message } = callbackQuery;
    const chatId = String(message.chat.id);
    const userId = String(from.id);
    
    logger.info(`[TelegramService] Handling callback query: ${data} from user ${userId}`);

    const ctx = this.createContext(chatId, userId, {
      messageIdToEdit: callbackQuery.message.message_id
    });

    // Pass to coordinator for handling
    await this.telegramCoordinator.handleAction(ctx, data);
  }

  /**
   * Handle /start command - initialize user and show welcome message
   */
  async handleStartCommand(chatId: string | number, userId: string | number, firstName?: string, lastName?: string, username?: string): Promise<void> {
    const chatIdStr = String(chatId);
    const userIdStr = String(userId);

    logger.info(`[handleStartCommand] Starting process for user: ${firstName} (ID=${userIdStr})`);

    try {
      // Check if user exists
      logger.info(`[handleStartCommand] Checking/creating user in database`);
      await findOrCreateUser({
        id: userIdStr,
        first_name: firstName,
        last_name: lastName,
        username: username
      });

      // Sync database before sending welcome message
      logger.info(`[handleStartCommand] Starting database sync`);
      await this.sendMessage(chatIdStr, "🔄 Синхронізую дані з базою... Це може зайняти кілька секунд.");
      
      try {
        logger.info(`[handleStartCommand] Calling syncReservationsAndTasks`);
        await syncReservationsAndTasks();
        logger.info(`[handleStartCommand] Sync completed successfully`);
        await this.sendMessage(chatIdStr, "✅ Синхронізація успішно завершена!");
      } catch (syncError) {
        logger.error(`[handleStartCommand] Error during sync:`, syncError);
        await this.sendMessage(chatIdStr, "⚠️ Помилка при синхронізації даних. Спробуйте пізніше.");
      }

      // Create context and show welcome message with keyboard
      const ctx = this.createContext(chatId, userId);

      // Welcome message
      await ctx.reply(`*Вітаю, ${firstName || 'користувачу'}!*\n\nЯ бот для управління завданнями.\n\nВикористовуйте меню нижче для навігації:`, {
        parse_mode: "Markdown"
      });
      
      // Show keyboards
      await this.telegramCoordinator.showKeyboard(ctx, 'main_nav');
      
    } catch (error) {
      logger.error(`[handleStartCommand] Critical error:`, error);
      
      // Create context and show a basic keyboard even if there's an error
      const ctx = this.createContext(chatId, userId);
      await ctx.reply(`*Вітаю, ${firstName || 'користувачу'}!*\n\nЯ бот для управління завданнями.\n\nВикористовуйте меню нижче для навігації:`, {
        parse_mode: "Markdown"
      });
      
      await this.telegramCoordinator.showKeyboard(ctx, 'main_nav');
    }
  }

  // Simple methods for HTTP handler - these are just for backward compatibility
  async handleMenuCommand(chatId: string | number): Promise<void> {
    const ctx = this.createContext(chatId, chatId);
    await this.telegramCoordinator.handleAction(ctx, 'show_menu');
  }

  async handleHelpCommand(chatId: string | number): Promise<void> {
    const ctx = this.createContext(chatId, chatId);
    await this.telegramCoordinator.handleAction(ctx, 'help');
  }

  async handleAboutCommand(chatId: string | number): Promise<void> {
    const ctx = this.createContext(chatId, chatId);
    await this.telegramCoordinator.handleAction(ctx, 'about');
  }

  async handleGetMyTasks(chatId: string | number): Promise<void> {
    const ctx = this.createContext(chatId, chatId);
    await this.telegramCoordinator.handleAction(ctx, 'show_tasks');
  }

  /**
   * Makes the current user an admin
   * @param userId User ID to make admin
   * @param ctx Telegram context for replies
   */
  private async makeUserAdmin(userId: string | number, ctx: TelegramContext): Promise<void> {
    try {
      const user = await findByTelegramId(String(userId));
      
      if (!user) {
        await ctx.reply("❌ Користувача не знайдено.");
        return;
      }
      
      if (user.role === UserRoles.ADMIN) {
        await ctx.reply("✅ Ви вже є адміністратором.");
        return;
      }
      
      // Update user to admin role
      if (user.id) {
        await updateUser(user.id, {
          role: UserRoles.ADMIN,
          updatedAt: Timestamp.now().toDate()
        });
        
        logger.info(`[TelegramService] User ${userId} self-promoted to admin`);
        await ctx.reply("🎉 Вітаємо! Вам надано права адміністратора. Використовуйте команду /admin для доступу до адмін-панелі.");
      } else {
        await ctx.reply("❌ Помилка: користувач знайдений, але ID відсутній.");
      }
    } catch (error) {
      logger.error(`[TelegramService] Error making user ${userId} admin:`, error);
      await ctx.reply("❌ Помилка при наданні прав адміністратора. Спробуйте пізніше.");
    }
  }
}