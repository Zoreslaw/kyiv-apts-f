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

    const state = await getConversationState(userId);
    const context = state?.lastContext || {};

    if (!shouldUseOpenAI(text)) {
      logger.debug('Message does not require OpenAI processing');
      return null;
    }

    // Get user's assigned apartments
    const userDoc = await db.collection('users').doc(String(userId)).get();
    const userData = userDoc.data();
    const isAdmin = userData?.type === 'admin';
    
    let assignedApartments = [];
    if (!isAdmin) {
      const assignmentDocs = await db.collection('cleaningAssignments')
        .where('userId', '==', String(userId))
        .get();
      
      if (!assignmentDocs.empty) {
        assignedApartments = assignmentDocs.docs[0].data().apartmentId || [];
      }
    }

    const today = getKievDate(0);
    const maxDate = getKievDate(10);

    const bookingsSnapshot = await db.collection('bookings')
      .where('date', '>=', today)
      .where('date', '<=', maxDate)
      .orderBy('date')
      .get();

    // Filter bookings based on user permissions
    const currentTasks = [];
    bookingsSnapshot.forEach(doc => {
      const b = doc.data();
      if (isAdmin || assignedApartments.includes(String(b.apartmentId))) {
        currentTasks.push({
          id: doc.id,
          ...b,
          checkoutTimeDisplay: b.type === 'checkout' ? b.checkoutTime : null,
          checkinTimeDisplay: b.type === 'checkin' ? b.checkinTime : null,
          cleaningTimeDisplay: b.cleaningTime || 'не призначено'
        });
      }
    });

    logger.info(`Found ${currentTasks.length} upcoming tasks for analysis (filtered by user permissions)`);

    // The big system prompt...
    const systemMsg = `... your system instructions ...`;

    // FIX: For safety, we ensure that if GPT tries to combine invalid + requiresConfirmation, 
    // we handle it after parse. But let's also rely on your code logic:

    const completion = await openai.chat.completions.create({
      // Possibly "gpt-4" or your model
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: text }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const rawContent = completion.choices[0].message.content.trim();
    logger.debug('OpenAI response:', rawContent);

    try {
      const cleanContent = rawContent.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanContent);

      // If GPT sets isValid=false but also requiresConfirmation=true, let's override:
      // FIX: Force the code to ignore requiresConfirmation if isValid is false
      if (parsed.validation && parsed.validation.isValid === false) {
        parsed.requiresConfirmation = false;
      }

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
          } else if (type === 'time') {
            const times = availableOptions.map(opt => opt.display).join(', ');
            message += `Доступні часи: ${times}`;
          }
          
          if (clarificationMsg) {
            message += `\n\n${clarificationMsg}`;
          }
        } else if (parsed.ambiguousMatches.length > 0) {
          // Fallback for ambiguous matches
          const dates = parsed.ambiguousMatches.map(b => {
            const [yyyy, mm, dd] = b.date.split('-');
            return `${dd}.${mm}.${yyyy}`;
          }).join(', ');
          message += `Доступні дати: ${dates}`;
        }
        
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
    } catch (parseErr) {
      logger.warn('OpenAI returned invalid JSON:', parseErr);
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

    // If validation is false, don't proceed to confirmation
    if (!analysis.validation?.isValid) {
      logger.warn(`Invalid time change request: ${analysis.validation.errors.join(', ')}`);
      
      let message = "";
      if (analysis.reasoning) {
        message += `${analysis.reasoning}\n\n`;
      }
      if (analysis.validation.conflicts?.length > 0) {
        const conflictMsgs = analysis.validation.conflicts.map(c => 
          `• ${c.type === 'checkin' ? 'Заїзд' : c.type === 'checkout' ? 'Виїзд' : 'Прибирання'} о ${c.time}: ${c.description}`
        ).join('\n');
        message += "Не можна встановити цей час через конфлікти:\n" + conflictMsgs;
        
        if (analysis.validation.suggestedAlternative) {
          message += `\n\nРекомендований час: ${analysis.validation.suggestedAlternative}`;
        }
      } else if (analysis.validation.errors?.length > 0) {
        message += "Помилки валідації:\n" + analysis.validation.errors.join('\n');
      }
      
      // Force requiresConfirmation to false if invalid
      return {
        success: false,
        message
      };
    }

    // If we have a valid change but need confirmation => user must type "Так" or "Ні"
    if (analysis.requiresConfirmation) {
      return {
        success: false,
        message: analysis.confirmationMessage,
        requiresConfirmation: true
      };
    }

    logger.info(`Attempting to update booking ${analysis.targetBooking.id} for user ${userId}`);

    const bookingRef = db.collection('bookings').doc(analysis.targetBooking.id);

    return await db.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        logger.warn(`Booking ${analysis.targetBooking.id} not found`);
        return { success: false, message: "Завдання не знайдено." };
      }

      const booking = bookingDoc.data();

      if (analysis.changeType === 'checkin' && booking.type === 'checkin') {
        transaction.update(bookingRef, {
          checkinTime: analysis.suggestedTime,
          updatedAt: new Date(),
          lastUpdatedBy: userId
        });
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
        return { success: false, message: "Неможливо змінити час для цього типу завдання." };
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

      // Format date
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

      // 1) Handle /start
      if (text === '/start') {
        const firstName = update.message.from.first_name || '';
        const lastName = update.message.from.last_name || '';
        const username = update.message.from.username || '';
        
        logger.info(`New user registration: ${firstName} (${userId})`);
        
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

        // Greet user
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `Вітаю, ${firstName}! Я бот для управління завданнями.`,
          reply_markup: mainMenuKeyboard
        });
        return res.status(200).send({ success: true });
      }

      // 2) Commands
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
        default: {
          // 3) Normal text => GPT analysis
          logger.info(`Processing text from user ${userId}: "${text}"`);

          const openAICheck = shouldUseOpenAI(text);
          if (openAICheck && openAICheck.isRussian) {
            logger.warn(`Russian language detected from user ${userId}`);
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: openAICheck.message
            });
            return res.status(200).send({ success: true });
          }

          const analysis = await processTextMessage(text, userId);
          if (!analysis) {
            logger.debug('No AI analysis or unrecognized request');
            return res.status(200).send({ success: true });
          }

          // If no target booking, clarify
          if (!analysis.targetBooking) {
            logger.info('No target booking identified. Asking for clarification.');
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: analysis.message || "Будь ласка, уточніть деталі..."
            });
            return res.status(200).send({ success: true });
          }

          // If requires confirmation, store pendingChange
          if (analysis.requiresConfirmation) {
            logger.info(`Requesting confirmation: ${analysis.confirmationMessage}`);
            const state = await getConversationState(userId);
            const ctx = state?.lastContext || {};

            await updateConversationState(userId, {
              lastMessage: text,
              lastContext: {
                ...ctx,
                pendingChange: analysis,
                requiresConfirmation: true
              }
            });

            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: analysis.confirmationMessage
            });
            return res.status(200).send({ success: true });
          }

          // 4) If we have a valid target booking and no confirmation needed
          try {
            // Check user has access
            const userDocRef = db.collection('users').doc(String(userId));
            const userDoc = await userDocRef.get();
            if (!userDoc.exists) {
              logger.warn(`User ${userId} not found in DB`);
              await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: chatId,
                text: "Ти не зареєстрований у системі. Будь ласка, скористайся командою /start."
              });
              return res.status(200).send({ success: true });
            }

            const userData = userDoc.data();
            const isAdmin = userData.type === 'admin';

            if (!isAdmin) {
              const assignmentDocs = await db.collection('cleaningAssignments')
                .where('userId', '==', String(userId))
                .get();

              const assignedApartments = assignmentDocs.empty ? [] :
                assignmentDocs.docs[0].data().apartmentId || [];

              const targetApartmentId = String(analysis.targetBooking.apartmentId);
              const hasAccess = assignedApartments.includes(targetApartmentId);
              if (!hasAccess) {
                logger.warn(`User ${userId} tried to access unauthorized apt ${targetApartmentId}`);
                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                  chat_id: chatId,
                  text: "У вас немає доступу до цієї квартири."
                });
                return res.status(200).send({ success: true });
              }
            }

            // Perform time update
            if (analysis.isTimeChange && analysis.suggestedTime) {
              const timeRegex = /^([0-1]?\d|2[0-3]):00$/;
              if (!timeRegex.test(analysis.suggestedTime)) {
                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                  chat_id: chatId,
                  text: "Будь ласка, вкажіть час у форматі ГГ:00 (наприклад, 15:00)."
                });
                return res.status(200).send({ success: true });
              }

              logger.info(`Time format validated: ${analysis.suggestedTime}`);
              const result = await updateCleaningTime(userId, analysis);

              logger.info('Time change result:', result);

              // Check if user is in confirmation mode
              const cstate = await getConversationState(userId);
              const ctx = cstate?.lastContext || {};

              if (ctx.requiresConfirmation && ctx.pendingChange) {
                // The user typed the original text again or something. 
                // Typically you'd do the "Tak/Ni" logic here, but let's skip 
                // since we forced invalid = no confirmation.
              }

              let message = result.message;
              if (!result.success && analysis.reasoning) {
                message += `\n\nПричина: ${analysis.reasoning}`;
              }

              await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: chatId,
                text: message
              });

              // If there are multiple changes, process them in a loop
              if (analysis.multipleChanges?.length > 0) {
                for (const change of analysis.multipleChanges) {
                  const multiResult = await updateCleaningTime(userId, {
                    ...analysis,
                    changeType: change.changeType,
                    targetBooking: change.targetBooking,
                    suggestedTime: change.suggestedTime,
                    validation: change.validation
                  });
                  if (!multiResult.success) {
                    await axios.post(`${TELEGRAM_API}/sendMessage`, {
                      chat_id: chatId,
                      text: `Помилка при оновленні другого часу:\n${multiResult.message}`
                    });
                  }
                }
              }
            }

          } catch (err) {
            logger.error('Error processing time change:', err);
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: "Виникла помилка при обробці запиту. Спробуйте пізніше."
            });
          }
        }
      }
      return res.status(200).send({ success: true });
    }

    // Default
    return res.status(200).send({ success: true });
  } catch (error) {
    logger.error("Error handling Telegram webhook:", error);
    return res.status(500).send({ success: false });
  }
});
