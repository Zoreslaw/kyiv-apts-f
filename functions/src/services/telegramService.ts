// Service for interacting with the Telegram Bot API
const axios = require("axios");
const functions = require("firebase-functions"); // To access defined params
const { defineString } = require("firebase-functions/params");

// Define params (consider moving to a central config/env file)
const botToken = defineString("TELEGRAM_BOT_TOKEN");
const TELEGRAM_API = `https://api.telegram.org/bot${botToken.value()}`;

// Placeholder for the main webhook handler logic (to be moved from old index.js)
async function handleTelegramWebhook(update) {
  console.log("Received update:", JSON.stringify(update, null, 2));

  if (!update.message?.text && !update.callback_query) {
    console.log("Ignoring non-message/non-callback update");
    return;
  }

  let chatId;
  let userId;
  let text;
  let data; // For callback query

  if (update.message) {
    chatId = update.message.chat.id;
    userId = update.message.from.id;
    text = update.message.text;
  } else if (update.callback_query) {
    chatId = update.callback_query.message.chat.id;
    userId = update.callback_query.from.id;
    data = update.callback_query.data; // Example: "complete_task:task123"
    text = `Callback: ${data}`; // For logging/context
  }

  console.log(`Processing message from userId=${userId}, chatId=${chatId}, text/data='${text || data}'`);

  // --- TODO: Move logic from old index.js here ---
  // 1. Parse command/text/callback_data
  // 2. Get user from userRepository
  // 3. Check permissions
  // 4. Call appropriate service (taskService, assignmentService, aiService)
  // 5. Format response
  // 6. Send message using sendMessage()
  // -----------------------------------------------

  // Placeholder response
  await sendMessage(chatId, `Received: ${text || data}`);
}

async function sendMessage(chatId, text, options = {}) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "Markdown", // Default parse mode
      ...options, // Pass other options like reply_markup
    });
  } catch (error) {
    console.error(
      `Error sending message to chat ${chatId}:`, error.response?.data || error.message
    );
    // Handle specific errors (e.g., bot blocked by user)?
  }
}

// Add other helper functions for editMessageText, answerCallbackQuery etc.

module.exports = {
  handleTelegramWebhook,
  sendMessage,
  // ... other telegram interaction functions
}; 