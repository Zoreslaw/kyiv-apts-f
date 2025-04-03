import axios from "axios";
import { logger } from "firebase-functions";
import { defineString } from "firebase-functions/params";
import { AIService } from "./aiService";
import { getTasksForUser, TaskService } from "./taskService";
import { findOrCreateUser } from "./userService";
import { FunctionExecutionService } from "./functionExecutionService";
import { syncReservationsAndTasks } from "./syncService";
import { findByTelegramId } from "../repositories/userRepository";
import { findByUserId } from "../repositories/cleaningAssignmentRepository";
import { UserRoles } from "../utils/constants";

// Types
interface TelegramMessage {
  chat: { id: string | number };
  from: { id: string | number; first_name?: string; last_name?: string; username?: string };
  text?: string;
}

// Constants
const botToken = defineString("TELEGRAM_BOT_TOKEN");
const TELEGRAM_API = `https://api.telegram.org/bot${botToken.value()}`;

const mainMenuKeyboard = {
  keyboard: [
    [{ text: "📋 Мої завдання" }, { text: "⚙️ Меню" }],
    [{ text: "❓ Допомога" }, { text: "ℹ️ Про бота" }],
  ],
  resize_keyboard: true,
};

export class TelegramService {
  private aiService: AIService;
  private taskService: TaskService;
  private functionService: FunctionExecutionService;
  private conversationContexts: Map<string, any[]>;

  constructor(openaiApiKey: string) {
    this.aiService = new AIService();
    this.taskService = new TaskService();
    this.functionService = new FunctionExecutionService(this.taskService);
    this.conversationContexts = new Map();
  }

  private getConversationContext(chatId: string | number): any[] {
    const chatIdStr = String(chatId);
    if (!this.conversationContexts.has(chatIdStr)) {
      this.conversationContexts.set(chatIdStr, []);
    }
    return this.conversationContexts.get(chatIdStr)!;
  }

  private updateConversationContext(chatId: string | number, message: any): void {
    const chatIdStr = String(chatId);
    const context = this.getConversationContext(chatIdStr);
    context.push(message);
    if (context.length > 3) {
      context.shift();
    }
  }

  private clearConversationContext(chatId: string | number): void {
    const chatIdStr = String(chatId);
    this.conversationContexts.delete(chatIdStr);
  }

  private async sendMessage(chatId: string | number, text: string, parseMode?: string, replyMarkup?: any): Promise<void> {
    const chatIdStr = String(chatId);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatIdStr,
      text,
      parse_mode: parseMode,
      reply_markup: replyMarkup,
    });
  }

  async handleStart(message: TelegramMessage): Promise<void> {
    const { chat, from } = message;
    const { id: userId, first_name: firstName, last_name: lastName, username } = from;

    // Convert IDs to strings at the earliest point
    const chatId = String(chat.id);
    const userIdStr = String(userId);

    logger.info(`[handleStart] Starting process for user: ${firstName} (ID=${userIdStr})`);

    try {
      // Check if user exists
      logger.info(`[handleStart] Checking/creating user in database`);
      await findOrCreateUser({
        id: userIdStr,
        first_name: firstName,
        last_name: lastName,
        username: username
      });

      // Sync database before sending welcome message
      logger.info(`[handleStart] Starting database sync`);
      await this.sendMessage(chatId, "🔄 Синхронізую дані з базою... Це може зайняти кілька секунд.");
      
      try {
        logger.info(`[handleStart] Calling syncReservationsAndTasks`);
        await syncReservationsAndTasks();
        logger.info(`[handleStart] Sync completed successfully`);
        await this.sendMessage(chatId, "✅ Синхронізація успішно завершена!");
      } catch (syncError) {
        logger.error(`[handleStart] Error during sync:`, syncError);
        await this.sendMessage(chatId, "⚠️ Помилка при синхронізації даних. Спробуйте пізніше.");
        // Continue with welcome message even if sync fails
      }

      // Send welcome message
      logger.info(`[handleStart] Sending welcome message`);
      await this.sendMessage(
        chatId,
        `Вітаю, ${firstName || 'користувачу'}! Я бот для управління завданнями.\n\nВикористовуйте меню нижче для навігації:`,
        undefined,
        mainMenuKeyboard
      );
    } catch (error) {
      logger.error(`[handleStart] Critical error:`, error);
      // Send welcome message even if there's an error
      await this.sendMessage(
        chatId,
        `Вітаю, ${firstName || 'користувачу'}! Я бот для управління завданнями.\n\nВикористовуйте меню нижче для навігації:`,
        undefined,
        mainMenuKeyboard
      );
    }
  }

  async handleGetMyTasks(chatId: string | number): Promise<void> {
    try {
      const chatIdStr = String(chatId);
      logger.info(`[TelegramService] Starting handleGetMyTasks for chatId=${chatIdStr}`);
      
      const result = await this.taskService.getTasksForUser(chatIdStr);
      logger.info(`[TelegramService] TaskService result:`, {
        success: result.success,
        hasMessage: !!result.message,
        tasksCount: result.tasks?.length || 0
      });
      
      if (!result.success) {
        logger.warn(`[TelegramService] TaskService returned error: ${result.message}`);
        await this.sendMessage(chatIdStr, result.message || "Помилка при отриманні завдань.");
        return;
      }

      if (!result.tasks) {
        logger.info(`[TelegramService] No tasks returned for chatId=${chatIdStr}`);
        await this.sendMessage(chatIdStr, "Немає завдань на найближчі дні.");
        return;
      }

      // Group tasks by date
      const grouped = this.taskService.groupTasksByDate(result.tasks);
      logger.info(`[TelegramService] Grouped tasks into ${Object.keys(grouped).length} dates`);
      
      const allDates = Object.keys(grouped).sort();
      logger.info(`[TelegramService] Sorted dates: ${allDates.join(', ')}`);

      if (allDates.length === 0) {
        logger.info(`[TelegramService] No dates with tasks found for chatId=${chatIdStr}`);
        await this.sendMessage(chatIdStr, "Немає завдань на найближчі дні.");
        return;
      }

      // Send tasks for each date, splitting long messages
      for (const date of allDates) {
        const { checkouts, checkins } = grouped[date];
        logger.info(`[TelegramService] Processing date ${date}: ${checkouts.length} checkouts, ${checkins.length} checkins`);
        
        if (!checkouts.length && !checkins.length) {
          logger.info(`[TelegramService] Skipping empty date ${date}`);
          continue;
        }

        const [y, m, d] = date.split("-");
        const dateString = `${d}.${m}.${y}`;
        let msg = this.taskService.formatTasksMessage(dateString, checkouts, checkins);
        
        // Split message if it's too long
        if (msg.length > 4000) { // Using 4000 as a safe limit
          const parts = this.splitMessage(msg);
          for (const part of parts) {
            logger.info(`[TelegramService] Sending part of message for date ${dateString}`);
            await this.sendMessage(chatIdStr, part, "Markdown");
          }
        } else {
          logger.info(`[TelegramService] Sending message for date ${dateString}`);
          await this.sendMessage(chatIdStr, msg, "Markdown");
        }
      }
      
      logger.info(`[TelegramService] Successfully completed handleGetMyTasks for chatId=${chatIdStr}`);
    } catch (err) {
      logger.error("[TelegramService] Error in handleGetMyTasks:", err);
      logger.error("[TelegramService] Error details:", {
        chatId,
        error: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined
      });
      await this.sendMessage(String(chatId), "Помилка при отриманні завдань. Спробуйте пізніше.");
    }
  }

  // Helper method to split long messages
  private splitMessage(message: string): string[] {
    const MAX_LENGTH = 4000; // Safe limit for Telegram messages
    const parts: string[] = [];
    
    if (message.length <= MAX_LENGTH) {
      return [message];
    }

    // Split by newlines to preserve message structure
    const lines = message.split('\n');
    let currentPart = '';
    
    for (const line of lines) {
      if (currentPart.length + line.length + 1 > MAX_LENGTH) {
        parts.push(currentPart.trim());
        currentPart = line;
      } else {
        currentPart += (currentPart ? '\n' : '') + line;
      }
    }
    
    if (currentPart) {
      parts.push(currentPart.trim());
    }
    
    return parts;
  }

  async handleMenuCommand(chatId: string | number): Promise<void> {
    const chatIdStr = String(chatId);
    await this.sendMessage(chatIdStr, "Оберіть опцію з меню:", undefined, mainMenuKeyboard);
  }

  async handleHelpCommand(chatId: string | number): Promise<void> {
    const chatIdStr = String(chatId);
    const text = `🤖 *Доступні команди:*

      📋 *Мої завдання* - переглянути список завдань (старий метод, без AI)
      ⚙️ *Меню* - відкрити головне меню
      ❓ *Допомога* - показати це повідомлення
      ℹ️ *Про бота* - інформація про бота

      Приклади оновлень через AI:
      - "Змініть виїзд 598 на 11:00"
      - "Встанови заїзд на 15:00"
      - "Постав суму 300 для квартири 598"
      - "Постав 2 ключі для квартири 598"`;
    await this.sendMessage(chatIdStr, text, "Markdown");
  }

  async handleAboutCommand(chatId: string | number): Promise<void> {
    const chatIdStr = String(chatId);
    const text = `🤖 *Бот для управління завданнями*

      Цей бот показує завдання старим способом і оновлює час/суму/ключі через AI.

      Поля у бронюваннях:
      • Сума (sumToCollect)
      • Ключі (keysCount)`;
    await this.sendMessage(chatIdStr, text, "Markdown");
  }

  async handleMessage(message: TelegramMessage): Promise<void> {
    const { chat, text, from } = message;
    const chatId = chat.id;
    const userId = from.id;

    if (!text) {
      await this.sendMessage(chatId, "Будь ласка, надішліть текстове повідомлення.");
      return;
    }

    // Handle basic commands
    if (text.startsWith('/')) {
      switch (text) {
        case '/menu':
        case '/help':
        case '/about':
          await this.handleGetMyTasks(chatId);
          return;
        case '/get_my_tasks':
          await this.handleGetMyTasks(chatId);
          return;
      }
    }

    // Get user's role and assigned apartments
    const user = await findByTelegramId(userId);
    if (!user) {
      await this.sendMessage(chatId, "Користувача не знайдено. Будь ласка, зареєструйтесь.");
      return;
    }

    const isAdmin = user.role === UserRoles.ADMIN;
    const assignment = await findByUserId(String(userId));
    const assignedApartments = assignment?.apartmentIds || [];

    // Process message with AI
    const result = await this.aiService.processMessage(text, {
      userId: String(userId),
      chatId: String(chatId),
      isAdmin,
      assignedApartments,
      currentTasks: [] // We'll get this later if needed
    });

    if (result.type === 'text') {
      await this.sendMessage(String(chatId), result.content || "Операція успішно виконана.");
    } else if (result.type === 'function_call' && result.function_call) {
      // If the function call is for updating a task, try to find the task by apartment ID
      if (result.function_call.name === 'update_task_time' || result.function_call.name === 'update_task_info') {
        const args = JSON.parse(result.function_call.arguments);
        const apartmentId = args.taskId;
        
        // Get tasks for this apartment
        const tasksResult = await this.taskService.getTasksByApartmentId(apartmentId);
        if (!tasksResult.success || !tasksResult.tasks || tasksResult.tasks.length === 0) {
          await this.sendMessage(String(chatId), tasksResult.message || `Завдань для квартири ${apartmentId} не знайдено.`);
          return;
        }

        // Find the most relevant task (check-in for time updates, or first task for info updates)
        let targetTask = tasksResult.tasks[0];
        if (result.function_call.name === 'update_task_time') {
          const checkinTask = tasksResult.tasks.find(task => task.taskType === 'checkin');
          if (checkinTask) {
            targetTask = checkinTask;
          }
        }

        // Update the task ID in the arguments
        args.taskId = targetTask.id;
      }

      const functionResult = await this.functionService.executeFunction(
        result.function_call.name,
        {
          ...JSON.parse(result.function_call.arguments),
          userId: String(userId)
        }
      );
      
      const followUp = await this.aiService.processFunctionResult(
        String(chatId),
        result.function_call.name,
        JSON.parse(result.function_call.arguments),
        functionResult
      );
      
      await this.sendMessage(String(chatId), followUp.content);
    }
  }

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

      // Send welcome message
      logger.info(`[handleStartCommand] Sending welcome message`);
      await this.sendMessage(
        chatIdStr,
        `Вітаю, ${firstName || 'користувачу'}! Я бот для управління завданнями.\n\nВикористовуйте меню нижче для навігації:`,
        undefined,
        mainMenuKeyboard
      );
    } catch (error) {
      logger.error(`[handleStartCommand] Critical error:`, error);
      // Send welcome message even if there's an error
      await this.sendMessage(
        chatIdStr,
        `Вітаю, ${firstName || 'користувачу'}! Я бот для управління завданнями.\n\nВикористовуйте меню нижче для навігації:`,
        undefined,
        mainMenuKeyboard
      );
    }
  }
}