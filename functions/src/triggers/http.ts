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

    // Handle callback queries (button clicks)
    if (update.callback_query) {
      await telegramService.handleCallbackQuery(update.callback_query);
      res.status(200).send({ success: true });
      return;
    }

    // // Handle regular messages
    // if (!update.message?.text) {
    //   res.status(200).send({ success: true });
    //   return;
    // }

    // If no message - just end
    if (!update.message) {
      res.status(200).send({ success: true });
      return;
    }

    const chatId = String(update.message.chat.id);
    const userId = String(update.message.from.id);

    // Handle /start command
    if (update.message.text === "/start") {
      const firstName = update.message.from.first_name || "";
      const lastName = update.message.from.last_name || "";
      const username = update.message.from.username || "";

      logger.info(`New user: ${firstName} (ID=${userId})`);
      await telegramService.handleStartCommand(chatId, userId, firstName, lastName, username);
    } else {
      // Otherwise, handle regular message (text, photo, whatever)
      await telegramService.handleMessage(update.message);
    }

    res.status(200).send({ success: true });
  } catch (error) {
    logger.error("Error in telegramWebhook trigger:", error);
    res.status(200).send({ success: true });
  }
});