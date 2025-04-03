import axios from "axios";
import { logger } from "firebase-functions";
import { defineString } from "firebase-functions/params";
import { AIService } from "./aiService";
import { getTasksForUser, TaskService } from "./taskService";
import { findOrCreateUser } from "./userService";
import { FunctionExecutionService } from "./functionExecutionService";

// Types
interface TelegramMessage {
  chat: { id: string };
  from: { id: number; first_name?: string; last_name?: string; username?: string };
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
    this.aiService = new AIService(openaiApiKey);
    this.taskService = new TaskService();
    this.functionService = new FunctionExecutionService();
    this.conversationContexts = new Map();
  }

  private getConversationContext(chatId: string): any[] {
    if (!this.conversationContexts.has(chatId)) {
      this.conversationContexts.set(chatId, []);
    }
    return this.conversationContexts.get(chatId)!;
  }

  private updateConversationContext(chatId: string, message: any): void {
    const context = this.getConversationContext(chatId);
    context.push(message);
    if (context.length > 3) {
      context.shift();
    }
  }

  private clearConversationContext(chatId: string): void {
    this.conversationContexts.delete(chatId);
  }

  private async sendMessage(chatId: string, text: string, parseMode?: string, replyMarkup?: any): Promise<void> {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      reply_markup: replyMarkup,
    });
  }

  async handleStart(message: TelegramMessage): Promise<void> {
    const { chat, from } = message;
    const { id: userId, first_name: firstName, last_name: lastName, username } = from;

    // Convert userId to string
    const userIdStr = String(userId);

    logger.info(`New user: ${firstName} (ID=${userIdStr})`);

    // Check if user exists
    await findOrCreateUser({
      id: userIdStr,
      first_name: firstName,
      last_name: lastName,
      username: username
    });

    await this.sendMessage(chat.id, "🔄 Синхронізую дані з базою... Це може зайняти кілька секунд.");
    await this.sendMessage(
      chat.id,
      `Вітаю, ${firstName || 'користувачу'}! Я бот для управління завданнями.\n\nВикористовуйте меню нижче для навігації:`,
      undefined,
      mainMenuKeyboard
    );
  }

  async handleGetMyTasks(chatId: string): Promise<void> {
    try {
      logger.info(`[TelegramService] Starting handleGetMyTasks for chatId=${chatId}`);
      
      const result = await this.taskService.getTasksForUser(chatId);
      logger.info(`[TelegramService] TaskService result:`, {
        success: result.success,
        hasMessage: !!result.message,
        tasksCount: result.tasks?.length || 0
      });
      
      if (!result.success) {
        logger.warn(`[TelegramService] TaskService returned error: ${result.message}`);
        await this.sendMessage(chatId, result.message || "Помилка при отриманні завдань.");
        return;
      }

      if (!result.tasks) {
        logger.info(`[TelegramService] No tasks returned for chatId=${chatId}`);
        await this.sendMessage(chatId, "Немає завдань на найближчі дні.");
        return;
      }

      // Group tasks by date
      const grouped = this.taskService.groupTasksByDate(result.tasks);
      logger.info(`[TelegramService] Grouped tasks into ${Object.keys(grouped).length} dates`);
      
      const allDates = Object.keys(grouped).sort();
      logger.info(`[TelegramService] Sorted dates: ${allDates.join(', ')}`);

      if (allDates.length === 0) {
        logger.info(`[TelegramService] No dates with tasks found for chatId=${chatId}`);
        await this.sendMessage(chatId, "Немає завдань на найближчі дні.");
        return;
      }

      // Send tasks for each date
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
        logger.info(`[TelegramService] Sending message for date ${dateString}`);
        await this.sendMessage(chatId, msg, "Markdown");
      }
      
      logger.info(`[TelegramService] Successfully completed handleGetMyTasks for chatId=${chatId}`);
    } catch (err) {
      logger.error("[TelegramService] Error in handleGetMyTasks:", err);
      logger.error("[TelegramService] Error details:", {
        chatId,
        error: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined
      });
      await this.sendMessage(chatId, "Помилка при отриманні завдань. Спробуйте пізніше.");
    }
  }

  async handleMenuCommand(chatId: string): Promise<void> {
    await this.sendMessage(chatId, "Оберіть опцію з меню:", undefined, mainMenuKeyboard);
  }

  async handleHelpCommand(chatId: string): Promise<void> {
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
    await this.sendMessage(chatId, text, "Markdown");
  }

  async handleAboutCommand(chatId: string): Promise<void> {
    const text = `🤖 *Бот для управління завданнями*

      Цей бот показує завдання старим способом і оновлює час/суму/ключі через AI.

      Поля у бронюваннях:
      • Сума (sumToCollect)
      • Ключі (keysCount)`;
    await this.sendMessage(chatId, text, "Markdown");
  }

  async handleMessage(message: TelegramMessage): Promise<void> {
    const { chat, from, text } = message;
    if (!text) return;

    // Convert userId to string
    const userId = String(from.id);

    // Handle basic commands
    switch (text) {
      case "/menu":
      case "⚙️ Меню":
        await this.handleMenuCommand(chat.id);
        return;

      case "/help":
      case "❓ Допомога":
        await this.handleHelpCommand(chat.id);
        return;

      case "/about":
      case "ℹ️ Про бота":
        await this.handleAboutCommand(chat.id);
        return;

      case "/get_my_tasks":
      case "📋 Мої завдання":
        await this.handleGetMyTasks(chat.id);
        return;
    }

    // Load user data
    const user = await findOrCreateUser({
      id: userId,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username
    });
    if (!user) {
      await this.sendMessage(chat.id, "Ти не зареєстрований у системі. Будь ласка, скористайся командою /start.");
      return;
    }

    const isAdmin = user.isAdmin();
    const tasks = await getTasksForUser(user.id);

    // Process with AI
    const result = await this.aiService.processMessage(
      text,
      userId,
      chat.id,
      isAdmin,
      tasks.map(t => t.apartmentId),
      tasks
    );

    if (result.type === "function_call") {
      const functionResult = await this.functionService.executeFunction(result.name, result.arguments);
      const followUp = await this.aiService.processFunctionResult(
        chat.id,
        result.name,
        result.arguments,
        functionResult
      );
      await this.sendMessage(chat.id, followUp.content);
    } else {
      await this.sendMessage(chat.id, result.content);
    }

    // Clear context if command
    if (text.startsWith("/")) {
      this.clearConversationContext(chat.id);
    }
  }

  async handleStartCommand(
    chatId: string,
    userId: number,
    firstName: string,
    lastName: string,
    username: string
  ): Promise<void> {
    try {
      // Convert userId to string
      const userIdStr = String(userId);

      // Create or update user
      await findOrCreateUser({
        id: userIdStr,
        first_name: firstName,
        last_name: lastName,
        username: username
      });

      // Send welcome message
      await this.sendMessage(
        chatId,
        `Вітаю, ${firstName}! 👋\n\nЯ бот для управління завданнями з прибирання квартир. Використовуйте /menu для доступу до основних команд.`
      );
    } catch (error) {
      logger.error("Error in handleStartCommand:", error);
      await this.sendMessage(
        chatId,
        "Виникла помилка при реєстрації. Спробуйте ще раз пізніше."
      );
    }
  }
}