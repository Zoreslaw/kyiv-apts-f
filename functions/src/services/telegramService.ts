import axios from "axios";
import { defineString } from "firebase-functions/params";

const botToken = defineString("TELEGRAM_BOT_TOKEN");
const TELEGRAM_API = `https://api.telegram.org/bot${botToken.value()}`;

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message: TelegramMessage;
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface SendMessageOptions {
  parse_mode?: string;
  reply_markup?: any;
  [key: string]: any;
}

async function handleTelegramWebhook(update: TelegramUpdate): Promise<void> {
  console.log("Received update:", JSON.stringify(update, null, 2));

  if (!update.message?.text && !update.callback_query) {
    console.log("Ignoring non-message/non-callback update");
    return;
  }

  let chatId: number;
  let userId: number;
  let text: string | undefined;
  let data: string | undefined; // For callback query

  if (update.message) {
    chatId = update.message.chat.id;
    userId = update.message.from.id;
    text = update.message.text;
  } else if (update.callback_query) {
    chatId = update.callback_query.message.chat.id;
    userId = update.callback_query.from.id;
    data = update.callback_query.data;
    text = `Callback: ${data}`;
  } else {
    // This shouldn't happen due to the earlier check, but TypeScript doesn't know that
    console.log("No message or callback_query found");
    return;
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

async function sendMessage(chatId: number, text: string, options: SendMessageOptions = {}): Promise<void> {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "Markdown", // Default parse mode
      ...options, // Pass other options like reply_markup
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Unknown error';
    
    // Check if this is an Axios error
    const axiosError = error as any;
    const responseData = axiosError.response?.data;
      
    console.error(
      `Error sending message to chat ${chatId}:`, responseData || errorMessage
    );
    // Handle specific errors (e.g., bot blocked by user)?
  }
}

// Add other helper functions for editMessageText, answerCallbackQuery etc.

export {
  handleTelegramWebhook,
  sendMessage,
  // ... other telegram interaction functions
}; 