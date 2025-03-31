/**
 * Firebase Cloud Functions for Telegram Bot
 * Uses old approach for listing tasks, and OpenAI Function Calling
 * for updating check-in/check-out times, plus sumToCollect & keysCount.
 */

const { logger } = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");

// Firebase Admin
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const axios = require("axios");
const OpenAI = require("openai");

// Init Firebase
initializeApp();
const db = getFirestore();

// Env variables
const openaiApiKey = defineString("OPENAI_API_KEY");
const botToken = defineString("TELEGRAM_BOT_TOKEN");

const openai = new OpenAI({
  apiKey: openaiApiKey.value(),
});

const TELEGRAM_API = `https://api.telegram.org/bot${botToken.value()}`;

/**
 * Main menu keyboard
 */
const mainMenuKeyboard = {
  keyboard: [
    [
      { text: "📋 Мої завдання" },
      { text: "⚙️ Меню" },
    ],
    [
      { text: "❓ Допомога" },
      { text: "ℹ️ Про бота" },
    ],
  ],
  resize_keyboard: true,
};

// Add conversation context management
const conversationContexts = new Map();

function getConversationContext(chatId) {
  if (!conversationContexts.has(chatId)) {
    conversationContexts.set(chatId, []);
  }
  return conversationContexts.get(chatId);
}

function updateConversationContext(chatId, message) {
  const context = getConversationContext(chatId);
  context.push(message);
  // Keep only last 3 messages
  if (context.length > 3) {
    context.shift();
  }
}

function clearConversationContext(chatId) {
  conversationContexts.delete(chatId);
}

/**
 * Get date in 'YYYY-MM-DD' (Kiev timezone)
 */
function getKievDate(offsetDays = 0) {
  const nowInKiev = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" })
  );
  nowInKiev.setDate(nowInKiev.getDate() + offsetDays);
  const year = nowInKiev.getFullYear();
  const month = String(nowInKiev.getMonth() + 1).padStart(2, "0");
  const day = String(nowInKiev.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Sync check-ins and check-outs from external API into Firestore
 * Also includes sumToCollect & keysCount
 */
async function syncBookingsWithDatabase() {
  try {
    logger.info("Starting booking sync with database...");

    // Example external calls
    const [checkoutsResponse, checkinsResponse] = await Promise.all([
      axios.get("https://kievapts.com/api/1.1/json/checkouts"),
      axios.get("https://kievapts.com/api/1.1/json/checkins"),
    ]);

    const checkoutsByDate = checkoutsResponse.data.response || {};
    const checkinsByDate = checkinsResponse.data.response || {};

    const allDates = [
      ...new Set([
        ...Object.keys(checkoutsByDate),
        ...Object.keys(checkinsByDate),
      ]),
    ];

    for (const date of allDates) {
      const checkouts = checkoutsByDate[date] || [];
      const checkins = checkinsByDate[date] || [];

      for (const c of checkouts) {
        const docId = `${date}_${c.apartment_id}_checkout`;
        const ref = db.collection("bookings").doc(docId);
        const snapshot = await ref.get();

        const hasSameDayCheckin = checkins.some(
          (x) => x.apartment_id === c.apartment_id
        );
        const sumToCollect = c.sumToCollect || 0;
        const keysCount = c.keys_count || 1;

        if (!snapshot.exists) {
          await ref.set({
            type: "checkout",
            date,
            apartmentId: c.apartment_id,
            address: c.apartment_address,
            guestName: c.guest_name,
            guestContact: c.guest_contact,
            checkoutTime: "12:00",
            hasSameDayCheckin,
            sumToCollect,
            keysCount,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } else {
          await ref.update({
            hasSameDayCheckin,
            sumToCollect,
            keysCount,
            updatedAt: new Date(),
          });
        }
      }

      for (const c of checkins) {
        const docId = `${date}_${c.apartment_id}_checkin`;
        const ref = db.collection("bookings").doc(docId);
        const snapshot = await ref.get();

        const sumToCollect = c.sumToCollect || 0;
        const keysCount = c.keys_count || 1;

        if (!snapshot.exists) {
          await ref.set({
            type: "checkin",
            date,
            apartmentId: c.apartment_id,
            address: c.apartment_address,
            guestName: c.guest_name,
            guestContact: c.guest_contact,
            checkinTime: "14:00",
            sumToCollect,
            keysCount,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } else {
          await ref.update({
            sumToCollect,
            keysCount,
            updatedAt: new Date(),
          });
        }
      }
    }

    logger.info("Booking sync done.");
    return true;
  } catch (err) {
    logger.error("Error syncing bookings:", err);
    return false;
  }
}

// Schedule sync every hour
exports.scheduledSyncBookings = onSchedule(
  { schedule: "every 60 minutes" },
  async () => {
    await syncBookingsWithDatabase();
  }
);

/**
 * Old approach to list tasks (no AI).
 */
async function handleGetMyTasks(chatId) {
  try {
    logger.info(`Loading tasks for user with chatId=${chatId}`);

    // 1) Find user doc by chatId
    const userSnap = await db
      .collection("users")
      .where("chatId", "==", chatId)
      .limit(1)
      .get();
    if (userSnap.empty) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "Ти не зареєстрований у системі. Будь ласка, скористайся командою /start.",
      });
      return;
    }

    const userData = userSnap.docs[0].data();
    const userId = userData.userId;
    const isAdmin = userData.type === "admin";

    // 2) If not admin, load assigned apartments
    let assignedApartments = [];
    if (!isAdmin) {
      const assignSnap = await db
        .collection("cleaningAssignments")
        .where("userId", "==", String(userId))
        .get();
      if (!assignSnap.empty) {
        assignedApartments = assignSnap.docs[0].data().apartmentId || [];
      }
      if (assignedApartments.length === 0) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: "На тебе не додано жодних квартир. :(",
        });
        return;
      }
    }

    // 3) Query upcoming 7 days
    const today = getKievDate(0);
    const maxDate = getKievDate(7);

    const bookingSnap = await db
      .collection("bookings")
      .where("date", ">=", today)
      .where("date", "<=", maxDate)
      .orderBy("date")
      .get();
    if (bookingSnap.empty) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "Немає даних про заїзди або виїзди на найближчі дні.",
      });
      return;
    }

    // 4) Group tasks by date
    const grouped = {};
    bookingSnap.forEach((doc) => {
      const data = doc.data();
      // Filter by assigned apartments if not admin
      if (!isAdmin && !assignedApartments.includes(String(data.apartmentId))) {
        return;
      }
      if (!grouped[data.date]) {
        grouped[data.date] = { checkouts: [], checkins: [] };
      }
      if (data.type === "checkout") grouped[data.date].checkouts.push(data);
      if (data.type === "checkin") grouped[data.date].checkins.push(data);
    });

    const allDates = Object.keys(grouped).sort();
    if (allDates.length === 0) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "Немає завдань на найближчі дні.",
      });
      return;
    }

    // 5) Build and send a message for each date
    for (const date of allDates) {
      const { checkouts, checkins } = grouped[date];
      if (!checkouts.length && !checkins.length) continue;

      const [y, m, d] = date.split("-");
      const dateString = `${d}.${m}.${y}`;
      let msg = `\n\n📅 *${dateString}* 📅\n\n====================\n\n`;

      // Checkouts
      if (checkouts.length > 0) {
        msg += `🔥 *ВИЇЗДИ:* 🔥\n\n`;
        msg += `⚠️ *ВАЖЛИВО:* ⚠️\n`;
        msg += `Прибирання має бути завершено до 14:00`;
        msg += `\n\n`;
        for (const c of checkouts) {
          msg += `🔴 *ID:* ${c.apartmentId}\n`;
          msg += `🏠 *Aдреса:* ${c.address}\n`;
          msg += `👤 *Гість:* ${c.guestName}\n`;
          msg += c.checkoutTime
            ? `⏰ *Виїзд:* ${c.checkoutTime}\n`
            : `⏰ *Виїзд:* не призначено\n`;

          // Two new fields
          msg += `💰 *Сума:* ${c.sumToCollect}\n`;
          msg += `🔑 *Ключів:* ${c.keysCount}\n`;

          msg += `📞 *Контакти:* ${c.guestContact}\n\n`;
        }
      }

      // Checkins
      if (checkins.length > 0) {
        msg += `✨ *ЗАЇЗДИ:* ✨\n\n`;
        msg += `⚠️ *ВАЖЛИВО:* ⚠️\n`;
        msg += `Квартира має бути готова до заїзду`;
        msg += `\n\n`;
        for (const ci of checkins) {
          msg += `🟢 *ID:* ${ci.apartmentId}\n`;
          msg += `🏠 *Aдреса:* ${ci.address}\n`;
          msg += `👤 *Гість:* ${ci.guestName}\n`;
          msg += ci.checkinTime
            ? `⏰ *Заїзд:* ${ci.checkinTime}\n`
            : `⏰ *Заїзд:* не призначено\n`;

          msg += `💰 *Сума:* ${ci.sumToCollect}\n`;
          msg += `🔑 *Ключів:* ${ci.keysCount}\n`;

          msg += `📞 *Контакти:* ${ci.guestContact}\n\n`;
        }
      }

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: msg,
        parse_mode: "Markdown",
      });
    }
  } catch (err) {
    logger.error("Error in handleGetMyTasks:", err);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "Помилка при отриманні завдань. Спробуйте пізніше.",
    });
  }
}

/**
 * Now define function-calling approach for updating times or sum/keys
 */

// 1) Update booking time (checkin/checkout)
async function updateBookingTimeInFirestore({ bookingId, newTime, changeType, userId }) {
  try {
    const ref = db.collection("bookings").doc(bookingId);

    return await db
      .runTransaction(async (tran) => {
        const snap = await tran.get(ref);
        if (!snap.exists) {
          return { success: false, message: "Booking not found in DB." };
        }

        const data = snap.data();
        if (changeType === "checkin" && data.type !== "checkin") {
          return {
            success: false,
            message: `Cannot update a checkin time on a ${data.type} booking.`,
          };
        }
        if (changeType === "checkout" && data.type !== "checkout") {
          return {
            success: false,
            message: `Cannot update a checkout time on a ${data.type} booking.`,
          };
        }

        // Update the relevant field
        if (changeType === "checkin") {
          tran.update(ref, { checkinTime: newTime, updatedAt: new Date(), lastUpdatedBy: userId });
        } else {
          tran.update(ref, { checkoutTime: newTime, updatedAt: new Date(), lastUpdatedBy: userId });
        }

        // Log it
        await db.collection("timeChanges").add({
          bookingId,
          oldTime: changeType === "checkin" ? data.checkinTime : data.checkoutTime,
          newTime,
          changeType,
          updatedBy: userId,
          updatedAt: new Date(),
        });

        return { success: true, message: "Time updated successfully." };
      })
      .catch((err) => {
        logger.error("Transaction error:", err);
        return { success: false, message: "Transaction error." };
      });
  } catch (err) {
    logger.error("Error updating booking time:", err);
    return { success: false, message: "Error updating booking time." };
  }
}

// 2) Update sumToCollect / keysCount
async function updateBookingInfoInFirestore({
  bookingId,
  newSumToCollect,
  newKeysCount,
  userId,
}) {
  try {
    const ref = db.collection("bookings").doc(bookingId);

    return await db
      .runTransaction(async (tran) => {
        const snap = await tran.get(ref);
        if (!snap.exists) {
          return { success: false, message: "Booking not found in DB." };
        }
        const data = snap.data();

        // Create update payload with only defined values
        const updatePayload = { 
          updatedAt: new Date(), 
          lastUpdatedBy: userId 
        };

        // Only include fields that are numbers and not null/undefined
        if (typeof newSumToCollect === "number" && !isNaN(newSumToCollect)) {
          updatePayload.sumToCollect = newSumToCollect;
        }
        
        if (typeof newKeysCount === "number" && !isNaN(newKeysCount)) {
          updatePayload.keysCount = newKeysCount;
        }

        // Update document
        await tran.update(ref, updatePayload);

        // Log the change
        await db.collection("timeChanges").add({
          bookingId,
          oldSum: data.sumToCollect,
          newSum: updatePayload.sumToCollect !== undefined ? updatePayload.sumToCollect : data.sumToCollect,
          oldKeys: data.keysCount,
          newKeys: updatePayload.keysCount !== undefined ? updatePayload.keysCount : data.keysCount,
          updatedBy: userId,
          updatedAt: new Date(),
        });

        const changes = [];
        if (updatePayload.sumToCollect !== undefined) {
          changes.push(`суму на ${updatePayload.sumToCollect}`);
        }
        if (updatePayload.keysCount !== undefined) {
          changes.push(`кількість ключів на ${updatePayload.keysCount}`);
        }

        return { 
          success: true, 
          message: `Успішно оновлено ${changes.join(" та ")}.` 
        };
      })
      .catch((err) => {
        logger.error("Transaction error:", err);
        return { success: false, message: "Помилка при оновленні даних." };
      });
  } catch (err) {
    logger.error("Error updating booking info:", err);
    return { success: false, message: "Помилка при оновленні даних." };
  }
}

/**
 * Handle apartment assignment updates (admin only)
 */
async function updateApartmentAssignments({ targetUserId, action, apartmentIds, isAdmin }) {
  try {
    // 1. Verify admin status
    if (!isAdmin) {
      return { 
        success: false, 
        message: "Тільки адміністратори можуть керувати призначеннями квартир." 
      };
    }

    // 2. Find target user
    const targetUserSnap = await db
      .collection("users")
      .where("userId", "==", targetUserId)
      .limit(1)
      .get();
    
    if (targetUserSnap.empty) {
      return { 
        success: false, 
        message: "Користувача не знайдено." 
      };
    }

    // 3. Get/create cleaning assignments doc
    const assignmentSnap = await db
      .collection("cleaningAssignments")
      .where("userId", "==", String(targetUserId))
      .limit(1)
      .get();

    let assignmentRef;
    let currentApartments = [];

    if (assignmentSnap.empty) {
      assignmentRef = db.collection("cleaningAssignments").doc();
      await assignmentRef.set({
        userId: String(targetUserId),
        apartmentId: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
    } else {
      assignmentRef = assignmentSnap.docs[0].ref;
      currentApartments = assignmentSnap.docs[0].data().apartmentId || [];
    }

    // 4. Update assignments
    let updatedApartments;
    if (action === "add") {
      updatedApartments = [...new Set([...currentApartments, ...apartmentIds])];
    } else { // remove
      updatedApartments = currentApartments.filter(id => !apartmentIds.includes(id));
    }

    await assignmentRef.update({
      apartmentId: updatedApartments,
      updatedAt: new Date()
    });

    const actionText = action === "add" ? "додано" : "видалено";
    return {
      success: true,
      message: `Успішно ${actionText} квартири ${apartmentIds.join(", ")} ${action === "add" ? "до" : "у"} користувача.`
    };

  } catch (err) {
    logger.error("Error updating apartment assignments:", err);
    return {
      success: false,
      message: "Помилка при оновленні призначень квартир."
    };
  }
}

/**
 * Define function schemas for OpenAI Function Calling
 */
const functionSchemas = [
  {
    type: "function",
    function: {
      name: "update_booking_time",
      description: "Updates checkin or checkout time for a given booking.",
      parameters: {
        type: "object",
        properties: {
          bookingId: {
            type: "string",
            description: "Unique Firestore doc ID, e.g. '2025-03-15_598_checkout'"
          },
          newTime: {
            type: "string",
            description: "New time in 'HH:00' format (checkout <14:00, checkin >14:00)."
          },
          changeType: {
            type: "string",
            enum: ["checkin", "checkout"],
            description: "Which time to update? 'checkin' or 'checkout' only."
          },
          userId: {
            type: "string",
            description: "Telegram user ID for logging"
          }
        },
        required: ["bookingId", "newTime", "changeType", "userId"],
        additionalProperties: false
      },
      //strict: true
    }
  },
  {
    type: "function",
    function: {
      name: "update_booking_info",
      description: "Updates sumToCollect and/or keysCount for a booking.",
      parameters: {
        type: "object",
        properties: {
          bookingId: {
            type: "string",
            description: "Unique Firestore doc ID of the booking"
          },
          newSumToCollect: {
            type: ["number", "null"],
            description: "Optional new sum to collect (if updating)."
          },
          newKeysCount: {
            type: ["number", "null"],
            description: "Optional new number of keys (if updating)."
          },
          userId: {
            type: "string",
            description: "Telegram user ID for logging"
          }
        },
        required: ["bookingId", "userId"],
        additionalProperties: false
      },
      //strict: true
    }
  },
  {
    type: "function",
    function: {
      name: "manage_apartment_assignments",
      description: "Manages apartment assignments for users (admin only).",
      parameters: {
        type: "object",
        properties: {
          targetUserId: {
            type: "string",
            description: "Telegram user ID of the user whose assignments to modify"
          },
          action: {
            type: "string",
            enum: ["add", "remove"],
            description: "Whether to add or remove apartments"
          },
          apartmentIds: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Array of apartment IDs to add or remove"
          },
          isAdmin: {
            type: "boolean",
            description: "Whether the requesting user is an admin"
          }
        },
        required: ["targetUserId", "action", "apartmentIds", "isAdmin"],
        additionalProperties: false
      }
    }
  }
];

/**
 * The system prompt for the model
 */
const systemPrompt = `
You are a Telegram assistant for managing apartment bookings.

User references:
1. If user says "@username" or "username" or a partial name, you can search the Firestore "users" collection to find the user with "username" or "firstName" or "lastName" matching it.
2. If no user is found, ask for clarification.

User Permissions:
1. Admin users can:
   - See and modify all bookings
   - Add/remove apartment assignments for users
   - Example: "Додай квартири 598, 321 для користувача @username"
   - Example: "Видали квартири 432, 553 у користувача @username"
2. Regular users can only see and modify their assigned apartments

Available Functions:
1) "update_booking_time": Updates checkin or checkout time
   - Checkout times must be before 14:00
   - Checkin times must be after 14:00
   - Format: HH:00 (e.g., "11:00", "15:00")

2) "update_booking_info": Updates sumToCollect and/or keysCount
   - sumToCollect: Amount to collect from guest (in UAH)
   - keysCount: Number of keys to collect/return

3) "manage_apartment_assignments": Manages apartment assignments (admin only)
   - Can add or remove apartment IDs for specific users
   - Must provide target user's Telegram ID
   - Must be an admin to use this function

4) 

Booking Identification:
Users can identify bookings by:
- Booking ID (e.g., "2025-03-15_598_checkout")
- Apartment ID (e.g., "598")
- Guest name (e.g., "Гусак")
- Address (e.g., "Baseina")

Examples:
1. "Змініть виїзд 598 на 11:00" -> Use apartment ID "598"
2. "Встанови заїзд на 15:00 для Гусак" -> Use guest name "Гусак"
3. "Постав суму 300 для booking 2025-03-15_598_checkout" -> Use full booking ID
4. "Постав 2 ключі для Baseina" -> Use address "Baseina"
5. "Додай квартири 598, 321 для @username" -> Add apartments for user
6. "Видали квартиру 432 у @username" -> Remove apartment from user

Always respond in Ukrainian.
If the user's request is unclear or missing information, ask for clarification.
If the user doesn't have permission to modify a booking or manage assignments, inform them.
`;

/**
 * Send user the main menu
 */
async function handleMenuCommand(chatId) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: "Оберіть опцію з меню:",
    reply_markup: mainMenuKeyboard,
  });
}

/**
 * Send user help
 */
async function handleHelpCommand(chatId) {
  const text = `🤖 *Доступні команди:*

📋 *Мої завдання* - переглянути список завдань (старий метод, без AI)
⚙️ *Меню* - відкрити головне меню
❓ *Допомога* - показати це повідомлення
ℹ️ *Про бота* - інформація про бота

Приклади оновлень через AI:
- "Змініть виїзд 598 на 11:00"
- "Встанови заїзд на 15:00"
- "Постав суму 300 для booking 2025-03-15_598_checkout"
- "Постав 2 ключі для booking 2025-03-15_598_checkin"`;
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  });
}

/**
 * About
 */
async function handleAboutCommand(chatId) {
  const text = `🤖 *Бот для управління завданнями*

Цей бот показує завдання старим способом і оновлює час/суму/ключі через AI.

Поля у бронюваннях:
• Сума (sumToCollect)
• Ключі (keysCount)`;
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  });
}

/**
 * Telegram webhook
 */
exports.telegramWebhook = onRequest(async (req, res) => {
  try {
    const update = req.body;
    logger.info("Received Telegram update:", update);

    if (!update.message?.text) {
      return res.status(200).send({ success: true });
    }

    const chatId = update.message.chat.id;
    const text = update.message.text;
    const userId = update.message.from.id;

    // /start
    if (text === "/start") {
      const firstName = update.message.from.first_name || "";
      const lastName = update.message.from.last_name || "";
      const username = update.message.from.username || "";

      logger.info(`New user: ${firstName} (ID=${userId})`);

      // Save user
      await db
        .collection("users")
        .doc(String(userId))
        .set(
          {
            userId,
            firstName,
            lastName,
            username,
            chatId,
            startedAt: new Date(),
            type: "cleaning",
            status: "test",
          },
          { merge: true }
        );

      // Send sync message
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "🔄 Синхронізую дані з базою... Це може зайняти кілька секунд.",
      });

      // Optional initial sync
      await syncBookingsWithDatabase();

      // Send welcome message with menu
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `Вітаю, ${firstName}! Я бот для управління завданнями.\n\nВикористовуйте меню нижче для навігації:`,
        reply_markup: mainMenuKeyboard,
      });
      return res.status(200).send({ success: true });
    }

    // Handle basic commands
    switch (text) {
      case "/menu":
      case "⚙️ Меню":
        await handleMenuCommand(chatId);
        return res.status(200).send({ success: true });

      case "/help":
      case "❓ Допомога":
        await handleHelpCommand(chatId);
        return res.status(200).send({ success: true });

      case "/about":
      case "ℹ️ Про бота":
        await handleAboutCommand(chatId);
        return res.status(200).send({ success: true });

      case "/get_my_tasks":
      case "📋 Мої завдання":
        await handleGetMyTasks(chatId);
        return res.status(200).send({ success: true });

      default:
        // All other text => we let AI handle updates
        logger.info(`Text from user ${userId}: "${text}"`);

        // Get user permissions and assigned apartments
        const userSnap = await db
          .collection("users")
          .where("chatId", "==", chatId)
          .limit(1)
          .get();
        
        let isAdmin = false;
        let assignedApartments = [];
        
        if (!userSnap.empty) {
          const userData = userSnap.docs[0].data();
          isAdmin = userData.type === "admin";
          
          if (!isAdmin) {
            const assignSnap = await db
              .collection("cleaningAssignments")
              .where("userId", "==", String(userData.userId))
              .get();
            if (!assignSnap.empty) {
              assignedApartments = assignSnap.docs[0].data().apartmentId || [];
            }
          }
        }

        // Get current bookings for context
        const today = getKievDate(0);
        const maxDate = getKievDate(7);
        const bookingSnap = await db
          .collection("bookings")
          .where("date", ">=", today)
          .where("date", "<=", maxDate)
          .orderBy("date")
          .get();

        const currentBookings = [];
        bookingSnap.forEach(doc => {
          const data = doc.data();
          if (isAdmin || assignedApartments.includes(String(data.apartmentId))) {
            currentBookings.push({
              id: doc.id,
              ...data
            });
          }
        });

        // Get conversation context
        const context = getConversationContext(chatId);
        
        // 1) Pass to OpenAI with function calling
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { 
              role: "system", 
              content: systemPrompt
            },
            // Add conversation context with proper function message format
            ...context.map(msg => {
              if (msg.role === "function") {
                return {
                  role: "function",
                  name: msg.name,
                  content: msg.content
                };
              }
              return {
                role: msg.role,
                content: msg.content,
                ...(msg.function_call && { function_call: msg.function_call })
              };
            }),
            { 
              role: "user", 
              content: text 
            },
            {
              role: "system",
              content: `Current user context:
- User ID: ${userId}
- Is admin: ${isAdmin}
- Assigned apartments: ${isAdmin ? 'ALL' : assignedApartments.join(', ')}
- Available bookings: ${JSON.stringify(currentBookings, null, 2)}`
            }
          ],
          functions: functionSchemas.map(schema => schema.function),
          function_call: "auto"
        });

        const message = completion.choices[0].message;
        if (!message) {
          return res.status(200).send({ success: true });
        }

        // 2) If it calls a function
        if (message.function_call) {
          const { name, arguments: rawArgs } = message.function_call;
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch (err) {
            logger.error("Error parsing function args:", err);
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: "Сталася помилка при обробці команди."
            });
            return res.status(200).send({ success: true });
          }

          // Route calls
          let result;
          if (name === "update_booking_time") {
            result = await updateBookingTimeInFirestore(parsedArgs);
          } else if (name === "update_booking_info") {
            result = await updateBookingInfoInFirestore(parsedArgs);
          } else if (name === "manage_apartment_assignments") {
            // Add isAdmin to the parsed arguments
            parsedArgs.isAdmin = isAdmin;
            result = await updateApartmentAssignments(parsedArgs);
          } else {
            logger.warn(`Unknown function call: ${name}`);
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: "Невідома команда, спробуйте ще раз."
            });
            return res.status(200).send({ success: true });
          }

          // 3) Provide function output and get final response
          const followUp = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              ...context.map(msg => {
                if (msg.role === "function") {
                  return {
                    role: "function",
                    name: msg.name,
                    content: msg.content
                  };
                }
                return {
                  role: msg.role,
                  content: msg.content,
                  ...(msg.function_call && { function_call: msg.function_call })
                };
              }),
              { role: "user", content: text },
              { 
                role: "assistant", 
                content: null, 
                function_call: { name, arguments: rawArgs }
              },
              { 
                role: "function", 
                name,
                content: JSON.stringify(result)
              }
            ],
            functions: functionSchemas.map(schema => schema.function),
            function_call: "auto"
          });

          const finalMsg = followUp.choices[0].message;
          if (finalMsg.function_call) {
            logger.info("Model tried another function call after update.");
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: "Оновлено, але є ще функція. Наразі не обробляється."
            });
          } else {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: finalMsg.content || result.message
            });
          }

          // Update conversation context
          updateConversationContext(chatId, { 
            role: "assistant", 
            content: null, 
            function_call: { name, arguments: rawArgs }
          });
          updateConversationContext(chatId, { 
            role: "function", 
            name, 
            content: JSON.stringify(result)
          });
        } else {
          // 4) Plain text response
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: message.content || "Добре, зрозумів."
          });

          // Update conversation context
          updateConversationContext(chatId, { 
            role: "assistant", 
            content: message.content || "" 
          });
        }

        // Update user message in context
        updateConversationContext(chatId, { 
          role: "user", 
          content: text 
        });

        // Clear context when user starts a new conversation
        if (text === "/start" || text === "/menu" || text === "/help" || text === "/about") {
          clearConversationContext(chatId);
        }

        return res.status(200).send({ success: true });
    }
  } catch (err) {
    logger.error("Error in telegramWebhook:", err);
    return res.status(500).send({ success: false });
  }
});