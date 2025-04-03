import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { TelegramService } from "../services/telegramService";
import { defineString } from "firebase-functions/params";

// Define environment variables
const openaiApiKey = defineString("OPENAI_API_KEY");

// Initialize TelegramService
const telegramService = new TelegramService(openaiApiKey.value());

/**
 * HTTP trigger for Telegram webhook
 * Handles incoming messages from Telegram users
 */
export const telegramWebhook = onRequest(async (req, res) => {
  try {
    const update = req.body;
    logger.info("Received Telegram update:", update);

    if (!update.message?.text) {
      res.status(200).send({ success: true });
      return;
    }

    const chatId = String(update.message.chat.id);
    const text = update.message.text;
    const userId = String(update.message.from.id);

    // Handle /start command
    if (text === "/start") {
      const firstName = update.message.from.first_name || "";
      const lastName = update.message.from.last_name || "";
      const username = update.message.from.username || "";

      logger.info(`New user: ${firstName} (ID=${userId})`);
      await telegramService.handleStartCommand(chatId, userId, firstName, lastName, username);
      res.status(200).send({ success: true });
      return;
    }

    // Handle basic commands
    switch (text) {
      case "/menu":
      case "⚙️ Меню":
        await telegramService.handleMenuCommand(chatId);
        res.status(200).send({ success: true });
        return;

      case "/help":
      case "❓ Допомога":
        await telegramService.handleHelpCommand(chatId);
        res.status(200).send({ success: true });
        return;

      case "/about":
      case "ℹ️ Про бота":
        await telegramService.handleAboutCommand(chatId);
        res.status(200).send({ success: true });
        return;

      case "/get_my_tasks":
      case "📋 Мої завдання":
        await telegramService.handleGetMyTasks(chatId);
        res.status(200).send({ success: true });
        return;

      default:
        // Handle AI-powered message processing
        await telegramService.handleMessage(update.message);
        res.status(200).send({ success: true });
        return;
    }
  } catch (error) {
    logger.error("Error in telegramWebhook trigger:", error);
    // Always return 200 to prevent Telegram from retrying
    res.status(200).send({ success: true });
  }
}); 