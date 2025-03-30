// The Cloud Functions for Firebase SDK to create Cloud Functions and triggers.
const { logger } = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");

// The Firebase Admin SDK to access Firestore.
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const axios = require("axios");
const OpenAI = require("openai");

// Initialize Firebase
initializeApp();
const db = getFirestore();

// Get environment variables (BEST PRACTICE: no fallback token here)
const openaiApiKey = defineString('OPENAI_API_KEY').value();
const botToken = defineString('TELEGRAM_BOT_TOKEN').value(); 
// If you absolutely MUST keep a fallback, you could do: 
// const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "YOUR_HARD_CODED_FALLBACK_TOKEN";

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || openaiApiKey
});

// Construct Telegram API URL
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN || botToken}`;

// Define keyboard markup for the menu
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
 * Utility to get "today" in Europe/Kiev, plus a day offset if needed. 
 * This ensures consistency with local business logic. 
 */
function getKievDate(offsetDays = 0) {
  const nowInKiev = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Kiev' })
  );
  // Optional offset if you want future or past days
  nowInKiev.setDate(nowInKiev.getDate() + offsetDays);
  // Return a formatted string "YYYY-MM-DD"
  const year = nowInKiev.getFullYear();
  const month = String(nowInKiev.getMonth() + 1).padStart(2, '0');
  const day = String(nowInKiev.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Sync check-ins and check-outs with Firestore 'bookings' collection.
 * Called by scheduled function (below).
 */
async function syncBookingsWithDatabase() {
  try {
    logger.log('Starting booking sync with database...');

    // Fetch current data from external API
    const [checkoutsResponse, checkinsResponse] = await Promise.all([
      axios.get("https://kievapts.com/api/1.1/json/checkouts"),
      axios.get("https://kievapts.com/api/1.1/json/checkins")
    ]);

    const checkoutsByDate = checkoutsResponse.data.response || {};
    const checkinsByDate = checkinsResponse.data.response || {};

    // Collect all unique dates
    const allDates = [...new Set([
      ...Object.keys(checkoutsByDate),
      ...Object.keys(checkinsByDate)
    ])];

    logger.log(`Found ${allDates.length} dates to process for sync.`);

    // Process each date
    for (const date of allDates) {
      const checkouts = checkoutsByDate[date] || [];
      const checkins = checkinsByDate[date] || [];

      // Process checkouts
      for (const checkout of checkouts) {
        const checkoutRef = db.collection('bookings').doc(`${date}_${checkout.apartment_id}_checkout`);
        const existingCheckout = await checkoutRef.get();

        // Check if same-day checkin
        const hasSameDayCheckin = checkins.some(
          checkin => checkin.apartment_id === checkout.apartment_id
        );

        if (!existingCheckout.exists) {
          logger.log(`Adding new checkout for apartment ${checkout.apartment_id} on ${date}`);
          await checkoutRef.set({
            type: 'checkout',
            date,
            apartmentId: checkout.apartment_id,
            address: checkout.apartment_address,
            guestName: checkout.guest_name,
            guestContact: checkout.guest_contact,
            checkoutTime: '12:00', // default
            hasSameDayCheckin,
            cleaningTime: null,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        } else {
          // Update minimal fields
          await checkoutRef.update({
            hasSameDayCheckin,
            updatedAt: new Date()
          });
        }
      }

      // Process checkins
      for (const checkin of checkins) {
        const checkinRef = db.collection('bookings').doc(`${date}_${checkin.apartment_id}_checkin`);
        const existingCheckin = await checkinRef.get();

        if (!existingCheckin.exists) {
          logger.log(`Adding new checkin for apartment ${checkin.apartment_id} on ${date}`);
          await checkinRef.set({
            type: 'checkin',
            date,
            apartmentId: checkin.apartment_id,
            address: checkin.apartment_address,
            guestName: checkin.guest_name,
            guestContact: checkin.guest_contact,
            checkinTime: '14:00', // default
            createdAt: new Date(),
            updatedAt: new Date()
          });
        } else {
          // Update minimal fields
          await checkinRef.update({
            updatedAt: new Date()
          });
        }
      }
    }

    logger.log('Booking sync completed successfully');
    return true;
  } catch (err) {
    logger.error('Error syncing bookings:', err);
    return false;
  }
}

/**
 * Scheduled function to sync every hour. 
 * You could adjust the CRON as needed, e.g. '0 * * * *' for every hour. 
 */
exports.scheduledSyncBookings = onSchedule({ schedule: 'every 60 minutes' }, async () => {
  await syncBookingsWithDatabase();
});

/**
 * Minimal filter to see if user message should go to OpenAI or not.
 * Example: if text includes "please change time"
 */
function shouldUseOpenAI(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  
  // Russian words to detect
  const russianWords = [
    'изменить', 'установить', 'поставить', 'назначить', 'отложить',
    'время', 'выезд', 'заезд', 'уборка', 'гость', 'квартира',
    'поменять', 'перенести', 'отменить', 'отменить', 'отложить',
    'изменение', 'установка', 'назначение', 'отмена', 'отсрочка',
    'временной', 'временные', 'временное', 'временная'
  ];

  // Check for Russian words first
  for (const word of russianWords) {
    if (lower.includes(word)) {
      return {
        isRussian: true,
        message: "🇺🇦 Бот підтримує тільки українську мову. Будь ласка, напишіть ваше повідомлення українською."
      };
    }
  }
  
  // Common time-related keywords (Ukrainian and English)
  const timeKeywords = [
    'change', 'update', 'set', 'make', 'put', 'schedule', 'arrange',
    'змінити', 'встановити', 'поставити', 'призначити', 'відкласти',
    'перенести', 'передвинути', 'відкласти', 'відмінити', 'скасувати',
    'відтермінувати', 'відстрочити', 'відкласти', 'відкласти', 'відкласти',
    'перенести', 'передвинути', 'відкласти', 'відмінити', 'скасувати',
    'відтермінувати', 'відстрочити', 'відкласти', 'відкласти', 'відкласти',
    'перенести', 'передвинути', 'відкласти', 'відмінити', 'скасувати',
    'відтермінувати', 'відстрочити', 'відкласти', 'відкласти', 'відкласти'
  ];
  
  // Time-related nouns
  const timeNouns = [
    'time', 'hour', 'checkout', 'check-in', 'checkin', 'cleaning',
    'час', 'година', 'виїзд', 'заїзд', 'прибирання', 'від\'їзд',
    'заїзд', 'прибирання', 'уборка', 'прибирання', 'прибирання',
    'прибирання', 'прибирання', 'прибирання', 'прибирання',
    'прибирання', 'прибирання', 'прибирання', 'прибирання',
    'прибирання', 'прибирання', 'прибирання', 'прибирання',
    'прибирання', 'прибирання', 'прибирання', 'прибирання'
  ];

  // Guest-related words
  const guestWords = [
    'guest', 'гость', 'гостя', 'гостю', 'гості', 'гостями',
    'гостями', 'гостями', 'гостями', 'гостями', 'гостями',
    'гостями', 'гостями', 'гостями', 'гостями', 'гостями',
    'гостями', 'гостями', 'гостями', 'гостями', 'гостями'
  ];

  // Apartment-related words
  const apartmentWords = [
    'apartment', 'flat', 'квартира', 'квартири', 'квартиру',
    'квартире', 'квартирой', 'квартирами', 'квартирах',
    'апартаменты', 'апартамент', 'апартаментов', 'апартаментам',
    'апартаментами', 'апартаментах'
  ];

  // Time-related adjectives
  const timeAdjectives = [
    'new', 'different', 'other', 'another', 'next', 'later',
    'ранній', 'пізній', 'новий', 'інший', 'наступний',
    'пізніше', 'раніше', 'раніше', 'раніше', 'раніше'
  ];

  // Check if text contains any combination of time keywords and nouns
  for (const keyword of timeKeywords) {
    for (const noun of timeNouns) {
      if (lower.includes(`${keyword} ${noun}`) || lower.includes(`${noun} ${keyword}`)) {
        return true;
      }
    }
  }

  // Check for specific time formats (e.g., "at 15:00", "to 16:00")
  const timePatterns = [
    /\b(?:at|to|by|until|till|до|на|о)\s+\d{1,2}:\d{2}\b/,
    /\b\d{1,2}:\d{2}\b/,
    /\b(?:am|pm)\b/,
    /\b\d{1,2}\b/, // Just numbers like "15" or "12"
    /\b(?:на|о|в)\s+\d{1,2}\b/, // Ukrainian time patterns
    /\b(?:до|після|після|після)\s+\d{1,2}\b/,
    /\b(?:до|після|після|після)\s+\d{1,2}:\d{2}\b/,
    /\b(?:в|на|о)\s+(?:ранку|вечері|день|дні|днів)\b/,
    /\b(?:в|на|о)\s+(?:ранку|вечері|день|дні|днів)\s+\d{1,2}\b/,
    /\b(?:в|на|о)\s+(?:ранку|вечері|день|дні|днів)\s+\d{1,2}:\d{2}\b/,
    /\b(?:в|на|о)\s+(?:ранку|вечері|день|дні|днів)\s+(?:до|після)\s+\d{1,2}\b/,
    /\b(?:в|на|о)\s+(?:ранку|вечері|день|дні|днів)\s+(?:до|після)\s+\d{1,2}:\d{2}\b/
  ];

  for (const pattern of timePatterns) {
    if (pattern.test(lower)) {
      return true;
    }
  }

  // Check for specific time-related phrases
  const timePhrases = [
    'change the time',
    'update the time',
    'set the time',
    'new time',
    'different time',
    'змінити час',
    'новий час',
    'інший час',
    'перенести',
    'відкласти',
    'передвинути',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти',
    'відкласти'
  ];

  // Check for combinations with guest names
  for (const keyword of timeKeywords) {
    for (const guest of guestWords) {
      if (lower.includes(`${keyword} ${guest}`) || lower.includes(`${guest} ${keyword}`)) {
        return true;
      }
    }
  }

  // Check for combinations with apartment numbers
  for (const keyword of timeKeywords) {
    for (const apartment of apartmentWords) {
      if (lower.includes(`${keyword} ${apartment}`) || lower.includes(`${apartment} ${keyword}`)) {
        return true;
      }
    }
  }

  // Check for combinations with time adjectives
  for (const keyword of timeKeywords) {
    for (const adjective of timeAdjectives) {
      if (lower.includes(`${keyword} ${adjective}`) || lower.includes(`${adjective} ${keyword}`)) {
        return true;
      }
    }
  }

  // Check for specific time-related phrases
  for (const phrase of timePhrases) {
    if (lower.includes(phrase)) {
      return true;
    }
  }

  // Check for apartment-related patterns
  const apartmentPatterns = [
    /\b(?:квартир[аи]|апартамент[и]?)\s+\d+/,
    /\b(?:квартир[аи]|апартамент[и]?)\s+на\s+\d+/,
    /\b(?:квартир[аи]|апартамент[и]?)\s+в\s+\d+/,
    /\b(?:квартир[аи]|апартамент[и]?)\s+на\s+(?:ранку|вечері|день|дні|днів)\b/,
    /\b(?:квартир[аи]|апартамент[и]?)\s+в\s+(?:ранку|вечері|день|дні|днів)\b/,
    /\b(?:квартир[аи]|апартамент[и]?)\s+на\s+(?:ранку|вечері|день|дні|днів)\s+\d{1,2}\b/,
    /\b(?:квартир[аи]|апартамент[и]?)\s+в\s+(?:ранку|вечері|день|дні|днів)\s+\d{1,2}\b/,
    /\b(?:квартир[аи]|апартамент[и]?)\s+на\s+(?:ранку|вечері|день|дні|днів)\s+\d{1,2}:\d{2}\b/,
    /\b(?:квартир[аи]|апартамент[и]?)\s+в\s+(?:ранку|вечері|день|дні|днів)\s+\d{1,2}:\d{2}\b/
  ];

  for (const pattern of apartmentPatterns) {
    if (pattern.test(lower)) {
      return true;
    }
  }

  // Check for relative time expressions
  const relativeTimePatterns = [
    /\b(?:раніше|пізніше|раніше|пізніше)\b/,
    /\b(?:раніше|пізніше|раніше|пізніше)\s+\d{1,2}\b/,
    /\b(?:раніше|пізніше|раніше|пізніше)\s+\d{1,2}:\d{2}\b/,
    /\b(?:раніше|пізніше|раніше|пізніше)\s+(?:ранку|вечері|день|дні|днів)\b/,
    /\b(?:раніше|пізніше|раніше|пізніше)\s+(?:ранку|вечері|день|дні|днів)\s+\d{1,2}\b/,
    /\b(?:раніше|пізніше|раніше|пізніше)\s+(?:ранку|вечері|день|дні|днів)\s+\d{1,2}:\d{2}\b/
  ];

  for (const pattern of relativeTimePatterns) {
    if (pattern.test(lower)) {
      return true;
    }
  }

  return false;
}

/**
 * Process user text with OpenAI, returning structured analysis or null.
 */
async function processTextMessage(text, userId) {
  try {
    logger.log(`processTextMessage -> user ${userId}, text: "${text}"`);

    // If the text does NOT match your filter, just skip
    if (!shouldUseOpenAI(text)) {
      return null;
    }

    // Fetch up to the next 10 days of bookings from Firestore
    // to avoid retrieving an enormous collection.
    const today = getKievDate(0);
    const maxDate = getKievDate(10); // next 10 days

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

    logger.log(`Found ${currentTasks.length} upcoming tasks for OpenAI analysis.`);

    // Build conversation
    const systemMsg = `You are a booking schedule assistant for an apartment rental service.
You need to analyze the user's message and the current tasks to determine what changes are requested.

Important rules about times:
1. For check-outs:
   - Flexible guest check-out time
   - Cleaning must be finished by 14:00
   - Cleaning cannot start before check-out
2. For check-ins:
   - Flexible guest check-in time
   - No cleaning time for check-ins

When identifying bookings:
1. Match by guest name (even partial matches like last name only)
2. Match by apartment ID or address
3. Consider the context of recent messages
4. For ambiguous cases, prefer the most recently mentioned booking
5. For multiple matches, prefer the nearest date

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
  "reasoning": string
}

Example user messages and how to handle them:
1. "зміни час гусак на 13" -> Match guest name "Гусак"
2. "постав прибирання на 12" -> Use most recently mentioned booking
3. "зміни заїзд baseina на 15" -> Match by address "Baseina"
4. "встанови виїзд 598 на 11" -> Match by ID "598"`;

    // Chat Completions (GPT-3.5-turbo)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: text }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const content = completion.choices[0].message.content;
    logger.log('OpenAI raw response:', content);

    // Validate JSON
    try {
      const parsed = JSON.parse(content);
      return parsed; // ideally check for required fields
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
 * Update time in Firestore with a transaction to avoid race conditions. 
 */
async function updateCleaningTime(userId, analysis) {
  try {
    if (!analysis?.targetBooking?.id) {
      return { 
        success: false,
        message: "Не вдалося визначити завдання. Будь ласка, уточни більше деталей."
      };
    }

    logger.log(`Attempting to update booking ${analysis.targetBooking.id} for user ${userId}`);

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

      // Possibly handle each change type:
      if (analysis.changeType === 'checkin' && booking.type === 'checkin') {
        // Just update the checkinTime
        transaction.update(bookingRef, {
          checkinTime: analysis.suggestedTime,
          updatedAt: new Date(),
          lastUpdatedBy: userId
        });

        // Save time change record
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

        // Return message from transaction
        const [yyyy, mm, dd] = booking.date.split('-');
        const displayDate = `${dd}.${mm}.${yyyy}`;
        return {
          success: true,
          message: `Час заїзду оновлено для квартири ${booking.address} (ID: ${booking.apartmentId}) на ${displayDate}.\nНовий час: ${analysis.suggestedTime}`
        };
      }
      else if (analysis.changeType === 'checkout' && booking.type === 'checkout') {
        // Validate new checkout time
        if (analysis.suggestedTime >= '14:00') {
          return {
            success: false,
            message: `Неможливо встановити виїзд о ${analysis.suggestedTime}, оскільки гість має виїхати до 14:00.`
          };
        }
        if (booking.cleaningTime && analysis.suggestedTime > booking.cleaningTime) {
          return {
            success: false,
            message: `Новий час виїзду ${analysis.suggestedTime} пізніше часу прибирання ${booking.cleaningTime}. Спочатку змініть час прибирання.`
          };
        }
        // If hasSameDayCheckin, check if it conflicts
        if (booking.hasSameDayCheckin) {
          const checkinRef = db.collection('bookings').doc(`${booking.date}_${booking.apartmentId}_checkin`);
          const checkinDoc = await transaction.get(checkinRef);
          if (checkinDoc.exists) {
            const checkinData = checkinDoc.data();
            if (analysis.suggestedTime >= checkinData.checkinTime) {
              return {
                success: false,
                message: `Гість не може виїхати о ${analysis.suggestedTime}, бо в цей же день заїзд о ${checkinData.checkinTime}.`
              };
            }
          }
        }

        // Update checkoutTime
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
        // Validate cleaning
        if (analysis.suggestedTime < booking.checkoutTime) {
          return {
            success: false,
            message: `Неможливо встановити прибирання на ${analysis.suggestedTime}, гість виїжджає о ${booking.checkoutTime}.`
          };
        }
        if (analysis.suggestedTime >= '14:00') {
          return {
            success: false,
            message: `Прибирання має бути завершене до 14:00, ${analysis.suggestedTime} - запізно.`
          };
        }

        // Update cleaningTime
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
        // If it's not recognized or mismatched type
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

// Add this function to handle menu commands
async function handleMenuCommand(chatId) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: "Оберіть опцію з меню:",
    reply_markup: mainMenuKeyboard
  });
}

// Add this function to handle help command
async function handleHelpCommand(chatId) {
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

// Add this function to handle about command
async function handleAboutCommand(chatId) {
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

// Add this function before the webhook handler
async function handleGetMyTasks(chatId) {
  try {
    // Get user ID from chat ID
    const userDoc = await db.collection('users')
      .where('chatId', '==', chatId)
      .limit(1)
      .get();

    if (userDoc.empty) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "Ти не зареєстрований у системі. Будь ласка, скористайся командою /start."
      });
      return;
    }

    const userData = userDoc.docs[0].data();
    const userId = userData.userId;
    const isAdmin = userData.type === 'admin';
    logger.log(`User ${userId} is ${isAdmin ? 'admin' : 'cleaner'}`);

    let assignedApartments = [];
    if (!isAdmin) {
      const assignmentDocs = await db.collection('cleaningAssignments')
        .where('userId', '==', userId.toString())
        .get();

      if (!assignmentDocs.empty) {
        assignedApartments = assignmentDocs.docs[0].data().apartmentId || [];
      }
      if (assignedApartments.length === 0) {
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

    logger.log(`Task request completed for user ${userId}`);
  } catch (error) {
    logger.error('Error in handleGetMyTasks:', error);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "Помилка при отриманні завдань. Спробуйте пізніше."
    });
  }
}

// Update the webhook handler to include new commands
exports.telegramWebhook = onRequest(async (req, res) => {
  try {
    const update = req.body;
    logger.log("Telegram Update received:", update);

    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;
      const userId = update.message.from.id;

      // Handle commands first
      if (text === '/start') {
        const firstName = update.message.from.first_name;
        const lastName = update.message.from.last_name || '';
        const username = update.message.from.username || '';
        
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
        logger.log(`User ${firstName} (${userId}) registered`);
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
          logger.log(`Processing text from user ${userId}: "${text}"`);

          // Check for Russian language first
          const openAICheck = shouldUseOpenAI(text);
          if (openAICheck && openAICheck.isRussian) {
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
            logger.log('No AI analysis or unrecognized request');
            break;
          }

          try {
            // Check if user have apartments ids
            const userDocRef = db.collection('users').doc(String(userId));
            const userDoc = await userDocRef.get();
            
            if (!userDoc.exists) {
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
                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                  chat_id: chatId,
                  text: "Будь ласка, вкажіть час у форматі ГГ:00 (наприклад, 15:00)."
                });
                break;
              }

              logger.log(`Time format validated: ${analysis.suggestedTime}`);
              const result = await updateCleaningTime(userId, analysis);

              logger.log('Time change result:', result);
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
