/**
 * Firebase Cloud Functions for Telegram Bot
 * Handles apartment cleaning task management and scheduling
 */

const { logger } = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");

// The Firebase Admin SDK to access Firestore.
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const axios = require("axios");
const OpenAI = require("openai");

// Initialize Firebase Admin SDK
initializeApp();
const db = getFirestore();

// Get environment variables (BEST PRACTICE: no fallback token here)
const openaiApiKey = defineString('OPENAI_API_KEY').value();
const botToken = defineString('TELEGRAM_BOT_TOKEN').value(); 

// Initialize OpenAI client with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || openaiApiKey
});

// Construct Telegram API URL for bot interactions
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN || botToken}`;

/**
 * Main menu keyboard layout for the Telegram bot
 * Provides quick access to common commands and features
 */
const mainMenuKeyboard = {
  keyboard: [
    [
      { text: "📋 Мої завдання" },
      { text: "⚙️ Меню" }
    ],
    [
      { text: "❓ Допомога" },
      { text: "ℹ️ Про бота" }
    ]
  ],
  resize_keyboard: true
};

/** 
 * Get current date in Europe/Kiev timezone with optional offset
 * @param {number} offsetDays - Number of days to offset from current date
 * @returns {string} Date in YYYY-MM-DD format
 */
function getKievDate(offsetDays = 0) {
  try {
    const nowInKiev = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Europe/Kiev' })
    );
    nowInKiev.setDate(nowInKiev.getDate() + offsetDays);
    const year = nowInKiev.getFullYear();
    const month = String(nowInKiev.getMonth() + 1).padStart(2, '0');
    const day = String(nowInKiev.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (error) {
    logger.error('Error getting Kiev date:', error);
    throw new Error('Failed to get Kiev date');
  }
}

/**
 * Sync check-ins and check-outs with Firestore 'bookings' collection
 * Fetches data from external API and updates local database
 * @returns {Promise<boolean>} Success status of sync operation
 */
async function syncBookingsWithDatabase() {
  try {
    logger.info('Starting booking sync with database...');

    const [checkoutsResponse, checkinsResponse] = await Promise.all([
      axios.get("https://kievapts.com/api/1.1/json/checkouts"),
      axios.get("https://kievapts.com/api/1.1/json/checkins")
    ]);

    const checkoutsByDate = checkoutsResponse.data.response || {};
    const checkinsByDate = checkinsResponse.data.response || {};

    const allDates = [...new Set([
      ...Object.keys(checkoutsByDate),
      ...Object.keys(checkinsByDate)
    ])];

    logger.info(`Found ${allDates.length} dates to process for sync`);

    for (const date of allDates) {
      const checkouts = checkoutsByDate[date] || [];
      const checkins = checkinsByDate[date] || [];

      for (const checkout of checkouts) {
        const checkoutRef = db.collection('bookings').doc(`${date}_${checkout.apartment_id}_checkout`);
        const existingCheckout = await checkoutRef.get();

        const hasSameDayCheckin = checkins.some(
          checkin => checkin.apartment_id === checkout.apartment_id
        );

        if (!existingCheckout.exists) {
          logger.info(`Adding new checkout for apartment ${checkout.apartment_id} on ${date}`);
          await checkoutRef.set({
            type: 'checkout',
            date,
            apartmentId: checkout.apartment_id,
            address: checkout.apartment_address,
            guestName: checkout.guest_name,
            guestContact: checkout.guest_contact,
            checkoutTime: '12:00',
            hasSameDayCheckin,
            cleaningTime: null,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        } else {
          await checkoutRef.update({
            hasSameDayCheckin,
            updatedAt: new Date()
          });
        }
      }

      for (const checkin of checkins) {
        const checkinRef = db.collection('bookings').doc(`${date}_${checkin.apartment_id}_checkin`);
        const existingCheckin = await checkinRef.get();

        if (!existingCheckin.exists) {
          logger.info(`Adding new checkin for apartment ${checkin.apartment_id} on ${date}`);
          await checkinRef.set({
            type: 'checkin',
            date,
            apartmentId: checkin.apartment_id,
            address: checkin.apartment_address,
            guestName: checkin.guest_name,
            guestContact: checkin.guest_contact,
            checkinTime: '14:00',
            createdAt: new Date(),
            updatedAt: new Date()
          });
        } else {
          await checkinRef.update({
            updatedAt: new Date()
          });
        }
      }
    }

    logger.info('Booking sync completed successfully');
    return true;
  } catch (err) { 
    logger.error('Error syncing bookings:', err);
    return false;
  }
}

// Schedule booking sync to run every hour
exports.scheduledSyncBookings = onSchedule({ schedule: 'every 60 minutes' }, async () => {
  await syncBookingsWithDatabase();
});

/**
 * Check if user message should be processed by OpenAI
 * Looks for time-related keywords and patterns
 * @param {string} text - User message to analyze
 * @returns {boolean} Whether to use OpenAI processing
 */
function shouldUseOpenAI(text) {
  if (!text) return false;
  
  const timeChangePatterns = [
    /змін/i, /постав/i, /встанов/i,
    /\d{1,2}[:. ]\d{2}/,
    /прибирання/i, /заїзд/i, /виїзд/i
  ];

  return timeChangePatterns.some(pattern => pattern.test(text));
}

/**
 * Get or create conversation state for a user
 * @param {string} userId - Telegram user ID
 * @returns {Promise<Object>} Conversation state
 */
async function getConversationState(userId) {
  try {
    const stateRef = db.collection('conversations').doc(userId.toString());
    const stateDoc = await stateRef.get();
    
    if (!stateDoc.exists) {
      return {
        lastMessage: null,
        lastContext: null,
        partialBooking: null,
        lastUpdated: new Date(),
        messageCount: 0
      };
    }
    
    return stateDoc.data();
  } catch (error) {
    logger.error('Error getting conversation state:', error);
    return null;
  }
}

/**
 * Update conversation state for a user
 * @param {string} userId - Telegram user ID
 * @param {Object} state - New conversation state
 */
async function updateConversationState(userId, state) {
  try {
    const stateRef = db.collection('conversations').doc(userId.toString());
    await stateRef.set({
      ...state,
      lastUpdated: new Date(),
      messageCount: (state.messageCount || 0) + 1
    });
  } catch (error) {
    logger.error('Error updating conversation state:', error);
  }
}

/**
 * Process user text with OpenAI and return structured analysis
 * @param {string} text - User message to process
 * @param {string} userId - Telegram user ID
 * @returns {Promise<Object|null>} Structured analysis of the message
 */
async function processTextMessage(text, userId) {
  try {
    logger.info(`Processing message from user ${userId}: "${text}"`);

    // Get conversation state
    const state = await getConversationState(userId);
    const context = state?.lastContext || {};

    if (!shouldUseOpenAI(text)) {
      logger.debug('Message does not require OpenAI processing');
      return null;
    }

    const today = getKievDate(0);
    const maxDate = getKievDate(10);

    const bookingsSnapshot = await db.collection('bookings')
      .where('date', '>=', today)
      .where('date', '<=', maxDate)
      .orderBy('date')
      .get();

    const currentTasks = [];
    bookingsSnapshot.forEach(doc => {
      const b = doc.data();
      currentTasks.push({
        id: doc.id,
        ...b,
        checkoutTimeDisplay: b.type === 'checkout' ? b.checkoutTime : null,
        checkinTimeDisplay: b.type === 'checkin' ? b.checkinTime : null,
        cleaningTimeDisplay: b.cleaningTime || 'не призначено'
      });
    });

    logger.info(`Found ${currentTasks.length} upcoming tasks for analysis`);

    const systemMsg = `You are a booking schedule assistant for an apartment rental service.
You need to analyze the user's message and the current tasks to determine what changes are requested.

Important rules about times:
1. For check-outs:
   - Guest check-out time must be before 14:00
   - Cleaning must be finished by 14:00
   - If there's a same-day check-in, check-out must be before check-in time
   - Minimum 30 minutes between checkout and cleaning
2. For check-ins:
   - Check-in time must be after 14:00
   - No cleaning time for check-ins
3. Time format must be HH:00 (e.g., 13:00, 14:00)
4. Date formats to handle:
   - Explicit dates: "30.03", "30.03.2024", "30/03", "30/03/2024"
   - Relative dates: "tomorrow", "the day after tomorrow", "next Monday"
   - Day names: "Monday", "Tuesday", etc.
   - Day numbers: "1st", "2nd", etc.

When analyzing time changes:
1. Check for conflicts with other bookings on the same day
2. Consider the entire day's schedule (checkout -> cleaning -> checkin)
3. Ensure there's enough time between events
4. If a time change would cause conflicts, suggest an alternative time
5. For same-day check-in/check-out, maintain proper sequence
6. Consider cleaner's schedule and physical constraints

When identifying bookings, follow these rules in order:
1. Match by explicit identifiers first:
   - Full apartment ID (e.g., "598")
   - Full address (e.g., "Baseina")
   - Full guest name (e.g., "Гусак")
   - Full date in DD.MM.YYYY or DD.MM format (e.g., "30.03" or "30.03.2024")

2. If no explicit match, try partial matches:
   - Partial apartment ID (e.g., "59" matches "598")
   - Partial address (e.g., "Base" matches "Baseina")
   - Partial guest name (e.g., "Гус" matches "Гусак")
   - Partial date (e.g., "30" matches "30.03")

3. If multiple matches found:
   - If dates differ: Require explicit date specification
   - If same date but different apartments: Require explicit apartment ID/address
   - If same apartment but different dates: Require explicit date
   - If same guest but different dates: Require explicit date
   - If same guest but different apartments: Require explicit apartment ID/address

4. For ambiguous cases:
   - Prefer the most recently mentioned booking in the conversation
   - If no recent context, prefer the nearest date
   - If dates are equal, prefer the most recently updated booking

5. Special cases to handle:
   - Multiple bookings for same apartment on different dates
   - Multiple bookings for same guest on different dates
   - Multiple bookings for same address on different dates
   - Multiple bookings on same date for different apartments
   - Bookings with similar names/addresses
   - Bookings with similar IDs
   - Bookings with dates in different formats
   - Multiple changes in one request
   - Time ranges instead of specific times
   - Relative date references

Previous conversation context:
${JSON.stringify(context, null, 2)}

Here are current tasks (limited to the next 10 days):
${JSON.stringify(currentTasks, null, 2)}

Analyze the user message and produce valid JSON with the format:
{
  "isTimeChange": boolean,
  "changeType": "cleaning" or "checkin" or "checkout",
  "targetBooking": { 
    "id": string,
    "type": "checkin" | "checkout",
    "date": "YYYY-MM-DD",
    "apartmentId": string,
    "address": string,
    "guestName": string
  },
  "suggestedTime": string (HH:00),
  "reasoning": string,
  "validation": {
    "isValid": boolean,
    "errors": string[], // List of validation errors if any
    "conflicts": [ // List of potential conflicts
      {
        "type": "checkin" | "checkout" | "cleaning",
        "time": string,
        "description": string
      }
    ],
    "suggestedAlternative": string // Alternative time if current suggestion has conflicts
  },
  "ambiguousMatches": [ // Only included if multiple bookings match without unique identifier
    {
      "id": string,
      "type": "checkin" | "checkout",
      "date": "YYYY-MM-DD",
      "apartmentId": string,
      "address": string,
      "guestName": string
    }
  ],
  "clarificationNeeded": { // Only included if more information is needed
    "type": "date" | "apartment" | "guest", // What information is missing
    "message": string, // User-friendly message explaining what's needed
    "availableOptions": [ // Available options for the missing information
      {
        "value": string,
        "display": string
      }
    ]
  },
  "requiresConfirmation": boolean, // Whether to ask for confirmation
  "confirmationMessage": string, // Message to show for confirmation
  "multipleChanges": [ // Array of changes if multiple changes requested
    {
      "changeType": "cleaning" | "checkin" | "checkout",
      "targetBooking": {
        "id": string,
        "type": "checkin" | "checkout",
        "date": "YYYY-MM-DD",
        "apartmentId": string,
        "address": string,
        "guestName": string
      },
      "suggestedTime": string,
      "validation": {
        "isValid": boolean,
        "errors": string[],
        "conflicts": [
          {
            "type": "checkin" | "checkout" | "cleaning",
            "time": string,
            "description": string
          }
        ],
        "suggestedAlternative": string
      }
    }
  ]
}

Example user messages and how to handle them:
1. "зміни час гусак на 13" -> Match guest name "Гусак"
2. "постав прибирання на 12" -> If multiple dates exist, require date specification
3. "зміни заїзд baseina на 15" -> Match by address "Baseina"
4. "встанови виїзд 598 на 11" -> Match by ID "598"
5. "постав прибирання на 12:00 30.03" -> Match by date "30.03"
6. "постав прибирання на 12:00 для 598" -> Match by ID "598"
7. "постав прибирання на 12:00 для гостя Гусак" -> Match by guest name "Гусак"
8. "постав прибирання на 12:00 на Baseina" -> Match by address "Baseina"
9. "постав прибирання на 12:00 завтра" -> Handle relative date
10. "постав прибирання між 10:00 та 12:00" -> Handle time range
11. "зміни виїзд на 11:00 і прибирання на 12:00" -> Handle multiple changes
12. "постав прибирання на 12:00 в понеділок" -> Handle day name

Validation examples:
1. "встанови виїзд на 15:00" -> Invalid: checkout must be before 14:00
2. "постав прибирання на 10:00" -> Check for conflicts with checkout time
3. "зміни заїзд на 13:00" -> Invalid: check-in must be after 14:00
4. "встанови виїзд на 12:00" -> Check for same-day check-in conflicts
5. "постав прибирання на 11:30" -> Check minimum 30 minutes after checkout

Conflict resolution:
1. If a time change would cause conflicts, suggest an alternative time
2. Consider the entire day's schedule when suggesting alternatives
3. Maintain minimum time gaps between events
4. Prioritize guest convenience while ensuring cleaning can be completed
5. Consider cleaner's physical constraints and schedule

IMPORTANT: Return ONLY the JSON object, no markdown formatting or code blocks.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: text }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const content = completion.choices[0].message.content.trim();
    logger.debug('OpenAI response:', content);

    try {
      // Remove any markdown code block formatting if present
      const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanContent);
      
      // Handle ambiguous matches or clarification needed
      if (parsed.ambiguousMatches?.length > 0 || parsed.clarificationNeeded) {
        logger.info('Multiple bookings matched or clarification needed');
        
        let message = "Будь ласка, уточніть деталі для завдання:\n";
        
        if (parsed.clarificationNeeded) {
          const { type, message: clarificationMsg, availableOptions } = parsed.clarificationNeeded;
          
          if (type === 'date') {
            const dates = availableOptions.map(opt => opt.display).join(', ');
            message += `Доступні дати: ${dates}`;
          } else if (type === 'apartment') {
            const apartments = availableOptions.map(opt => 
              `ID: ${opt.value} - ${opt.display}`
            ).join('\n');
            message += `Доступні квартири:\n${apartments}`;
          } else if (type === 'guest') {
            const guests = availableOptions.map(opt => 
              `${opt.display} (${opt.value})`
            ).join('\n');
            message += `Доступні гості:\n${guests}`;
          }
        } else {
          // Fallback for ambiguous matches
          const dates = parsed.ambiguousMatches.map(b => {
            const [yyyy, mm, dd] = b.date.split('-');
            return `${dd}.${mm}.${yyyy}`;
          }).join(', ');
          message += `Доступні дати: ${dates}`;
        }
        
        // Update conversation state with partial information
        await updateConversationState(userId, {
          lastMessage: text,
          lastContext: {
            ...context,
            partialBooking: parsed.targetBooking || null,
            ambiguousMatches: parsed.ambiguousMatches || [],
            clarificationNeeded: parsed.clarificationNeeded || null
          }
        });
        
        return {
          isTimeChange: false,
          ambiguousMatches: parsed.ambiguousMatches,
          clarificationNeeded: parsed.clarificationNeeded,
          message: message
        };
      }
      
      // If we have a valid change, update conversation state
      if (parsed.isTimeChange && parsed.targetBooking) {
        await updateConversationState(userId, {
          lastMessage: text,
          lastContext: {
            lastBooking: parsed.targetBooking,
            lastChangeType: parsed.changeType,
            lastSuggestedTime: parsed.suggestedTime
          }
        });
      }
      
      return parsed;
    } catch (err) {
      logger.warn('OpenAI returned invalid JSON:', err);
      return null;
    }

  } catch (error) {
    logger.error('Error in processTextMessage:', error);
    return null;
  }
}

/**
 * Update time in Firestore with a transaction to avoid race conditions
 * @param {string} userId - Telegram user ID
 * @param {Object} analysis - OpenAI analysis of the user's request
 * @returns {Promise<Object>} Result of the update operation
 */
async function updateCleaningTime(userId, analysis) {
  try {
    if (!analysis?.targetBooking?.id) {
      logger.warn('Invalid analysis object or missing booking ID');
      return { 
        success: false,
        message: "Не вдалося визначити завдання. Будь ласка, уточни більше деталей."
      };
    }

    // Check validation from ChatGPT
    if (!analysis.validation?.isValid) {
      logger.warn(`Invalid time change request: ${analysis.validation.errors.join(', ')}`);
      
      // If there are conflicts, show them and suggest alternatives
      if (analysis.validation.conflicts?.length > 0) {
        const conflictMessages = analysis.validation.conflicts.map(c => 
          `• ${c.type === 'checkin' ? 'Заїзд' : c.type === 'checkout' ? 'Виїзд' : 'Прибирання'} о ${c.time}: ${c.description}`
        ).join('\n');

        let message = "Не можна встановити цей час через конфлікти:\n" + conflictMessages;
        
        if (analysis.validation.suggestedAlternative) {
          message += `\n\nРекомендований час: ${analysis.validation.suggestedAlternative}`;
        }
        
        return {
          success: false,
          message: message
        };
      }

      return {
        success: false,
        message: analysis.validation.errors.join('\n')
      };
    }

    logger.info(`Attempting to update booking ${analysis.targetBooking.id} for user ${userId}`);

    const bookingRef = db.collection('bookings').doc(analysis.targetBooking.id);

    // Transaction ensures consistent read-update
    return await db.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);

      if (!bookingDoc.exists) {
        logger.warn(`Booking ${analysis.targetBooking.id} not found`);
        return {
          success: false,
          message: "Завдання не знайдено."
        };
      }
      const booking = bookingDoc.data();

      // Handle each change type
      if (analysis.changeType === 'checkin' && booking.type === 'checkin') {
        logger.info(`Updating checkin time for booking ${booking.id}`);
        transaction.update(bookingRef, {
          checkinTime: analysis.suggestedTime,
          updatedAt: new Date(),
          lastUpdatedBy: userId
        });

        // Save time change record for audit
        await db.collection('timeChanges').add({
          bookingId: analysis.targetBooking.id,
          apartmentId: booking.apartmentId,
          address: booking.address,
          date: booking.date,
          oldTime: booking.checkinTime,
          newTime: analysis.suggestedTime,
          bookingType: booking.type,
          guestName: booking.guestName,
          changeType: 'checkin',
          reasoning: analysis.reasoning,
          updatedAt: new Date(),
          updatedBy: userId
        });

        const [yyyy, mm, dd] = booking.date.split('-');
        const displayDate = `${dd}.${mm}.${yyyy}`;
        return {
          success: true,
          message: `Час заїзду оновлено для квартири ${booking.address} (ID: ${booking.apartmentId}) на ${displayDate}.\nНовий час: ${analysis.suggestedTime}`
        };
      }
      else if (analysis.changeType === 'checkout' && booking.type === 'checkout') {
        logger.info(`Updating checkout time for booking ${booking.id}`);
        transaction.update(bookingRef, {
          checkoutTime: analysis.suggestedTime,
          updatedAt: new Date(),
          lastUpdatedBy: userId
        });

        await db.collection('timeChanges').add({
          bookingId: analysis.targetBooking.id,
          apartmentId: booking.apartmentId,
          address: booking.address,
          date: booking.date,
          oldTime: booking.checkoutTime,
          newTime: analysis.suggestedTime,
          bookingType: booking.type,
          guestName: booking.guestName,
          changeType: 'checkout',
          cleaningTime: booking.cleaningTime,
          reasoning: analysis.reasoning,
          updatedAt: new Date(),
          updatedBy: userId
        });

        const [yyyy, mm, dd] = booking.date.split('-');
        const displayDate = `${dd}.${mm}.${yyyy}`;
        return {
          success: true,
          message: `Час виїзду оновлено для квартири ${booking.address} (ID: ${booking.apartmentId}) на ${displayDate}.\nНовий час виїзду: ${analysis.suggestedTime}`
        };
      }
      else if (analysis.changeType === 'cleaning' && booking.type === 'checkout') {
        logger.info(`Updating cleaning time for booking ${booking.id}`);
        transaction.update(bookingRef, {
          cleaningTime: analysis.suggestedTime,
          updatedAt: new Date(),
          lastUpdatedBy: userId
        });

        await db.collection('timeChanges').add({
          bookingId: analysis.targetBooking.id,
          apartmentId: booking.apartmentId,
          address: booking.address,
          date: booking.date,
          oldTime: booking.cleaningTime,
          newTime: analysis.suggestedTime,
          bookingType: booking.type,
          guestName: booking.guestName,
          checkoutTime: booking.checkoutTime,
          hasSameDayCheckin: booking.hasSameDayCheckin,
          changeType: 'cleaning',
          reasoning: analysis.reasoning,
          updatedAt: new Date(),
          updatedBy: userId
        });

        const [yyyy, mm, dd] = booking.date.split('-');
        const displayDate = `${dd}.${mm}.${yyyy}`;
        return {
          success: true,
          message: `Час прибирання оновлено для виїзду квартири ${booking.address} (ID: ${booking.apartmentId}) на ${displayDate}.\nПрибирання о ${analysis.suggestedTime}`
        };
      }
      else {
        logger.warn(`Invalid change type ${analysis.changeType} for booking type ${booking.type}`);
        return {
          success: false,
          message: "Неможливо змінити час для цього типу завдання."
        };
      }
    })
    .then((transactionResult) => transactionResult) 
    .catch((transactionError) => {
      logger.error("Transaction failed:", transactionError);
      return {
        success: false,
        message: "Помилка при оновленні часу (транзакція)."
      };
    });

  } catch (err) {
    logger.error('Error in updateCleaningTime:', err);
    return { success: false, message: "Помилка при оновленні часу" };
  }
}

/**
 * Handle menu command - show main menu to user
 * @param {string} chatId - Telegram chat ID
 */
async function handleMenuCommand(chatId) {
  logger.info(`Showing menu to user ${chatId}`);
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: "Оберіть опцію з меню:",
    reply_markup: mainMenuKeyboard
  });
}

/**
 * Handle help command - show help message to user
 * @param {string} chatId - Telegram chat ID
 */
async function handleHelpCommand(chatId) {
  logger.info(`Showing help to user ${chatId}`);
  const helpText = `🤖 *Доступні команди:*

📋 *Мої завдання* - переглянути список завдань
⚙️ *Меню* - відкрити головне меню
❓ *Допомога* - показати це повідомлення
ℹ️ *Про бота* - інформація про бота

*Як змінити час:*
• Напишіть "змінити час виїзду на 11:00"
• Або "встановити прибирання о 12:00"
• Або "перенести заїзд на 15:00"

*Важливо:*
• Виїзд має бути до 14:00
• Прибирання не може початися до виїзду
• Прибирання має бути завершене до 14:00`;

  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: helpText,
    parse_mode: 'Markdown'
  });
}

/**
 * Handle about command - show bot information
 * @param {string} chatId - Telegram chat ID
 */
async function handleAboutCommand(chatId) {
  logger.info(`Showing about info to user ${chatId}`);
  const aboutText = `🤖 *Бот для управління завданнями*

Цей бот допомагає управляти завданнями з прибирання квартир:
• Переглядати список завдань
• Змінювати час виїзду/заїзду
• Встановлювати час прибирання

*Версія:* 1.0.0
*Розробник:* Kiev Apartments`;

  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: aboutText,
    parse_mode: 'Markdown'
  });
}

/**
 * Handle get tasks command - show user's assigned tasks
 * @param {string} chatId - Telegram chat ID
 */
async function handleGetMyTasks(chatId) {
  try {
    logger.info(`Fetching tasks for user ${chatId}`);
    
    // Get user ID from chat ID
    const userDoc = await db.collection('users')
      .where('chatId', '==', chatId)
      .limit(1)
      .get();

    if (userDoc.empty) {
      logger.warn(`User not found for chat ID ${chatId}`);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "Ти не зареєстрований у системі. Будь ласка, скористайся командою /start."
      });
      return;
    }

    const userData = userDoc.docs[0].data();
    const userId = userData.userId;
    const isAdmin = userData.type === 'admin';
    logger.info(`User ${userId} is ${isAdmin ? 'admin' : 'cleaner'}`);

    let assignedApartments = [];
    if (!isAdmin) {
      const assignmentDocs = await db.collection('cleaningAssignments')
        .where('userId', '==', userId.toString())
        .get();

      if (!assignmentDocs.empty) {
        assignedApartments = assignmentDocs.docs[0].data().apartmentId || [];
      }
      if (assignedApartments.length === 0) {
        logger.warn(`No apartments assigned to user ${userId}`);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: "На тебе не додано жодних квартир. :("
        });
        return;
      }
    }

    // Load tasks from today to +7 days
    const today = getKievDate(0);
    const maxDate = getKievDate(7);

    const bookingsSnap = await db.collection('bookings')
      .where('date', '>=', today)
      .where('date', '<=', maxDate)
      .orderBy('date')
      .get();

    const allBookings = [];
    bookingsSnap.forEach(doc => allBookings.push(doc.data()));

    // Group by date
    const grouped = {};
    for (const b of allBookings) {
      if (!isAdmin && !assignedApartments.includes(String(b.apartmentId))) {
        continue;
      }
      if (!grouped[b.date]) {
        grouped[b.date] = { checkouts: [], checkins: [] };
      }
      if (b.type === 'checkout') grouped[b.date].checkouts.push(b);
      if (b.type === 'checkin') grouped[b.date].checkins.push(b);
    }

    const allDates = Object.keys(grouped).sort();
    if (allDates.length === 0) {
      logger.info(`No tasks found for user ${userId}`);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "Немає даних про заїзди або виїзди на найближчі дні."
      });
      return;
    }

    let hasAnyTasks = false;

    for (const date of allDates) {
      const { checkouts, checkins } = grouped[date];
      if (checkouts.length === 0 && checkins.length === 0) continue;
      hasAnyTasks = true;

      // Format date as DD.MM.YYYY for display
      const [yyyy, mm, dd] = date.split('-');
      const formattedDate = `${dd}.${mm}.${yyyy}`;

      let msg = `\n\n📅 *${formattedDate}* 📅\n\n====================\n\n`;

      // Checkouts
      if (checkouts.length > 0) {
        msg += `🔥 *ВИЇЗДИ:* 🔥\n\n`;
        for (const c of checkouts) {
          msg += `🔴 *ID:* ${c.apartmentId}\n`;
          msg += `🏠 *Aдреса:* ${c.address}\n`;
          msg += `👤 *Гість:* ${c.guestName}\n`;
          msg += c.checkoutTime
            ? `⏰ *Виїзд гостя:* ${c.checkoutTime}\n`
            : `⏰ *Виїзд гостя:* не призначено\n`;

          msg += c.cleaningTime
            ? `🧹 *Час прибирання:* ${c.cleaningTime}\n`
            : `🧹 *Час прибирання:* не призначено\n`;

          msg += `⚠️ *Прибирання має бути завершено до 14:00*\n`;
          msg += `📞 *Контакти:* ${c.guestContact}\n\n`;
        }
      }

      // Checkins
      if (checkins.length > 0) {
        msg += `✨ *ЗАЇЗДИ:* ✨\n\n`;
        for (const ci of checkins) {
          msg += `🟢 *ID:* ${ci.apartmentId}\n`;
          msg += `🏠 *Aдреса:* ${ci.address}\n`;
          msg += `👤 *Гість:* ${ci.guestName}\n`;
          msg += ci.checkinTime
            ? `⏰ *Заїзд:* ${ci.checkinTime}\n`
            : `⏰ *Заїзд:* не призначено\n`;
          msg += `⚠️ *Квартира має бути готова до заїзду*\n`;
          msg += `📞 *Контакти:* ${ci.guestContact}\n\n`;
        }
      }

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: msg,
        parse_mode: 'Markdown'
      });
    }

    if (!hasAnyTasks) {
      const msg = isAdmin
        ? "Немає жодних заїздів або виїздів на найближчі дні."
        : "Наразі немає квартир для прибирання. Перевір пізніше.";
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: msg
      });
    }

    logger.info(`Task request completed for user ${userId}`);
  } catch (error) {
    logger.error('Error in handleGetMyTasks:', error);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "Помилка при отриманні завдань. Спробуйте пізніше."
    });
  }
}

/**
 * Telegram webhook handler
 * Processes incoming messages and commands
 */
exports.telegramWebhook = onRequest(async (req, res) => {
  try {
    const update = req.body;
    logger.info("Received Telegram update:", update);

    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;
      const userId = update.message.from.id;

      // Handle commands first
      if (text === '/start') {
        const firstName = update.message.from.first_name;
        const lastName = update.message.from.last_name || '';
        const username = update.message.from.username || '';
        
        logger.info(`New user registration: ${firstName} (${userId})`);
        
        // Store or update user
        await db.collection('users').doc(userId.toString()).set({
          userId,
          firstName,
          lastName,
          username,
          startedAt: new Date(),
          chatId: chatId,
          type: 'cleaning', // default
          status: 'test'
        }, { merge: true });
        
        await syncBookingsWithDatabase();

        // Greet the user with menu
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `Вітаю, ${firstName}! Я бот для управління завданнями.`,
          reply_markup: mainMenuKeyboard
        });
        return res.status(200).send({ success: true });
      }

      // Handle menu buttons and commands
      switch (text) {
        case '/menu':
        case '⚙️ Меню':
          await handleMenuCommand(chatId);
          break;
        case '/help':
        case '❓ Допомога':
          await handleHelpCommand(chatId);
          break;
        case '/about':
        case 'ℹ️ Про бота':
          await handleAboutCommand(chatId);
          break;
        case '/get_my_tasks':
        case '📋 Мої завдання':
          await handleGetMyTasks(chatId);
          break;
        default:
          // Handle normal text messages (time changes etc)
          logger.info(`Processing text from user ${userId}: "${text}"`);

          // Check for Russian language first
          const openAICheck = shouldUseOpenAI(text);
          if (openAICheck && openAICheck.isRussian) {
            logger.warn(`Russian language detected in message from user ${userId}`);
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: openAICheck.message
            });
            break;
          }

          // Attempt AI analysis (only if text triggers it)
          const analysis = await processTextMessage(text, userId);

          // If analysis is null, do nothing or respond politely
          if (!analysis) {
            logger.debug('No AI analysis or unrecognized request');
            break;
          }

          try {
            // Check if user have apartments ids
            const userDocRef = db.collection('users').doc(String(userId));
            const userDoc = await userDocRef.get();
            
            if (!userDoc.exists) {
              logger.warn(`User ${userId} not found in database`);
              await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: chatId,
                text: "Ти не зареєстрований у системі. Будь ласка, скористайся командою /start."
              });
              break;
            }

            const userData = userDoc.data();
            const isAdmin = userData.type === 'admin';

            if (!isAdmin) {
              const assignmentDocs = await db.collection('cleaningAssignments')
                .where('userId', '==', String(userId))
                .get();

              if (assignmentDocs.empty || !assignmentDocs.docs[0].data().apartmentId?.includes(analysis.targetBooking.apartmentId)) {
                logger.warn(`User ${userId} attempted to access unauthorized apartment ${analysis.targetBooking.apartmentId}`);
                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                  chat_id: chatId,
                  text: "У вас немає доступу до цієї квартири."
                });
                break;
              }
            }

            // If analysis is valid, handle time update
            if (analysis.isTimeChange && analysis.suggestedTime) {
              // Validate time format
              const timeRegex = /^([0-1]?\d|2[0-3]):00$/;
              if (!timeRegex.test(analysis.suggestedTime)) {
                logger.warn(`Invalid time format from user ${userId}: ${analysis.suggestedTime}`);
                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                  chat_id: chatId,
                  text: "Будь ласка, вкажіть час у форматі ГГ:00 (наприклад, 15:00)."
                });
                break;
              }

              logger.info(`Time format validated: ${analysis.suggestedTime}`);
              const result = await updateCleaningTime(userId, analysis);

              logger.info('Time change result:', result);
              await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: chatId,
                text: result.message
              });
            }
          } catch (err) {
            logger.error('Error processing time change:', err);
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: "Виникла помилка при обробці запиту. Спробуйте пізніше."
            });
          }
      }
      return res.status(200).send({ success: true });
    }

    // Default case
    return res.status(200).send({ success: true });

  } catch (error) {
    logger.error("Error handling Telegram webhook:", error);
    return res.status(500).send({ success: false });
  }
});
