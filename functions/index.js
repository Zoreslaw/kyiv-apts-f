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

// Conversation context logic 
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
 * getKievDate
 * @ARICK: The best way to work with dates is Moment.js
 * Let's use it in the future.
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
 * syncBookingsWithDatabase
 * @ARICK: This functions is too big. Let's refactor it. 
 * Try to strive to functions with single responsibility. Usually it's better to split.
 * Functions should be small and easy to understand.
 */
async function syncBookingsWithDatabase() {
  try {
    logger.info("Starting booking sync with database...");
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

// scheduledSyncBookings 
exports.scheduledSyncBookings = onSchedule(
  { schedule: "every 60 minutes" },
  async () => {
    await syncBookingsWithDatabase();
  }
);

/**
 * handleGetMyTasks
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

    // @ARICK: We should create an interface to easier use telegram api.
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

    const grouped = {};
    bookingSnap.forEach((doc) => {
      const data = doc.data();
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
        msg += `Прибирання має бути завершено до 14:00\n\n`;
        for (const c of checkouts) {
          msg += `🔴 *ID:* ${c.apartmentId}\n`;
          msg += `🏠 *Aдреса:* ${c.address}\n`;
          msg += `👤 *Гість:* ${c.guestName}\n`;
          msg += c.checkoutTime
            ? `⏰ *Виїзд:* ${c.checkoutTime}\n`
            : `⏰ *Виїзд:* не призначено\n`;

          msg += `💰 *Сума:* ${c.sumToCollect}\n`;
          msg += `🔑 *Ключів:* ${c.keysCount}\n`;

          msg += `📞 *Контакти:* ${c.guestContact}\n\n`;
        }
      }

      // Checkins
      if (checkins.length > 0) {
        msg += `✨ *ЗАЇЗДИ:* ✨\n\n`;
        msg += `⚠️ *ВАЖЛИВО:* ⚠️\n`;
        msg += `Квартира має бути готова до заїзду\n\n`;
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
 * Updates the check-in or check-out time for a booking
 */
async function updateBookingTimeInFirestore({ bookingId, newTime, changeType, userId }) {
  try {
    logger.info(`Updating ${changeType} time to ${newTime} for booking ${bookingId} by user ${userId}`);
    
    // 1. Check if booking exists
    const bookingRef = db.collection("bookings").doc(bookingId);
    const doc = await bookingRef.get();
    
    if (!doc.exists) {
      return {
        success: false,
        message: `Бронювання з ID ${bookingId} не знайдено.`,
      };
    }
    
    // 2. Validate time format (HH:00)
    if (!/^([0-9]|0[0-9]|1[0-9]|2[0-3]):00$/.test(newTime)) {
      return {
        success: false,
        message: `Недійсний формат часу: ${newTime}. Використовуйте формат "ГГ:00".`,
      };
    }
    
    // 3. Validate time constraints (checkout < 14:00, checkin > 14:00)
    const hour = parseInt(newTime.split(":")[0], 10);
    if (changeType === "checkout" && hour >= 14) {
      return {
        success: false,
        message: `Час виїзду має бути раніше 14:00. Ви вказали: ${newTime}`,
      };
    }
    
    if (changeType === "checkin" && hour < 14) {
      return {
        success: false,
        message: `Час заїзду має бути не раніше 14:00. Ви вказали: ${newTime}`,
      };
    }
    
    // 4. Update the booking
    const updateField = changeType === "checkin" ? "checkinTime" : "checkoutTime";
    await bookingRef.update({
      [updateField]: newTime,
      updatedAt: new Date(),
      updatedBy: userId,
    });
    
    // 5. Return success
    return {
      success: true,
      message: changeType === "checkin"
        ? `Час заїзду оновлено на ${newTime}.`
        : `Час виїзду оновлено на ${newTime}.`,
    };
  } catch (err) {
    logger.error(`Error updating ${changeType} time:`, err);
    return {
      success: false,
      message: `Помилка при оновленні часу ${changeType === "checkin" ? "заїзду" : "виїзду"}. Спробуйте пізніше.`,
    };
  }
}

/**
 * Updates the sumToCollect and/or keysCount for a booking
 */
async function updateBookingInfoInFirestore({ bookingId, newSumToCollect, newKeysCount, userId }) {
  try {
    logger.info(`Updating booking info for ${bookingId} by user ${userId}. Sum: ${newSumToCollect}, Keys: ${newKeysCount}`);
    
    // 1. Check if booking exists
    const bookingRef = db.collection("bookings").doc(bookingId);
    const doc = await bookingRef.get();
    
    if (!doc.exists) {
      return {
        success: false,
        message: `Бронювання з ID ${bookingId} не знайдено.`,
      };
    }
    
    // 2. Prepare update object
    const updateObj = {
      updatedAt: new Date(),
      updatedBy: userId,
    };
    
    // 3. Add fields to update if provided
    if (newSumToCollect !== null && newSumToCollect !== undefined) {
      // Make sure it's a number
      updateObj.sumToCollect = Number(newSumToCollect);
    }
    
    if (newKeysCount !== null && newKeysCount !== undefined) {
      // Make sure it's a number
      updateObj.keysCount = Number(newKeysCount);
    }
    
    // 4. Check if there's anything to update
    if (Object.keys(updateObj).length <= 2) { // Just updatedAt and updatedBy
      return {
        success: false,
        message: "Не вказано ні суму, ні кількість ключів для оновлення.",
      };
    }
    
    // 5. Update the booking
    await bookingRef.update(updateObj);
    
    // 6. Prepare success message
    let message = "Оновлено: ";
    if (newSumToCollect !== null && newSumToCollect !== undefined) {
      message += `сума до оплати - ${newSumToCollect} грн`;
      if (newKeysCount !== null && newKeysCount !== undefined) {
        message += ", ";
      }
    }
    
    if (newKeysCount !== null && newKeysCount !== undefined) {
      message += `кількість ключів - ${newKeysCount}`;
    }
    
    return {
      success: true,
      message,
    };
  } catch (err) {
    logger.error("Error updating booking info:", err);
    return {
      success: false,
      message: "Помилка при оновленні інформації про бронювання. Спробуйте пізніше.",
    };
  }
}

//  Function to lookup user by name or username
async function lookupUserByNameOrUsername(query) {
  try {
    const normalized = query.replace(/^@/, "").trim();
    
    // 1) Try exact username match
    let snap = await db
      .collection("users")
      .where("username", "==", normalized)
      .limit(1)
      .get();
    if (!snap.empty) {
      return snap.docs[0].data();
    }

    // 2) Try exact firstName
    snap = await db
      .collection("users")
      .where("firstName", "==", normalized)
      .limit(1)
      .get();
    if (!snap.empty) {
      return snap.docs[0].data();
    }

    // 3) Try exact lastName
    snap = await db
      .collection("users")
      .where("lastName", "==", normalized)
      .limit(1)
      .get();
    if (!snap.empty) {
      return snap.docs[0].data();
    }

    // no luck
    return null;
  } catch (err) {
    logger.error("Error in lookupUserByNameOrUsername:", err);
    return null;
  }
}

//  Adjust manageApartmentAssignments to handle text userId
async function updateApartmentAssignments({ targetUserId, action, apartmentIds, isAdmin }) {
  try {
    if (!isAdmin) {
      return {
        success: false,
        message: "Тільки адміністратори можуть керувати призначеннями квартир.",
      };
    }

    // If not numeric, try lookup
    if (!/^\d+$/.test(targetUserId)) {
      const foundUser = await lookupUserByNameOrUsername(targetUserId);
      logger.info(`Found user: ${JSON.stringify(foundUser)}`);
      if (!foundUser) {
        return {
          success: false,
          message: `Не знайшов користувача за запитом '${targetUserId}'.`,
        };
      }
      targetUserId = String(foundUser.userId);
    }

    const targetSnap = await db
      .collection("users")
      .where("userId", "==", parseInt(targetUserId))
      .limit(1)
      .get();

    if (targetSnap.empty) {
      return {
        success: false,
        message: "Користувача не знайдено в базі.",
      };
    }

    const targetUserData = targetSnap.docs[0].data();
    logger.info(`Target user data: ${JSON.stringify(targetUserData)}`);

    const assignmentSnap = await db
      .collection("cleaningAssignments")
      .where("userId", "==", targetUserId)
      .limit(1)
      .get();

    let assignmentRef;
    let currentApartments = [];

    if (assignmentSnap.empty) {
      assignmentRef = db.collection("cleaningAssignments").doc();
      await assignmentRef.set({
        userId: targetUserId,
        apartmentId: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      assignmentRef = assignmentSnap.docs[0].ref;
      currentApartments = assignmentSnap.docs[0].data().apartmentId || [];
    }

    let updatedApartments;
    if (action === "add") {
      updatedApartments = [...new Set([...currentApartments, ...apartmentIds])];
    } else {
      updatedApartments = currentApartments.filter(
        (id) => !apartmentIds.includes(id)
      );
    }

    await assignmentRef.update({
      apartmentId: updatedApartments,
      updatedAt: new Date(),
    });

    const actionText = action === "add" ? "додано" : "видалено";
    const displayName = targetUserData.username || targetUserData.firstName || targetUserId;
    return {
      success: true,
      message: `Успішно ${actionText} квартири ${apartmentIds.join(", ")} ${
        action === "add" ? "до" : "у"
      } користувача ${displayName}.`,
    };
  } catch (err) {
    logger.error("Error updating apartment assignments:", err);
    return {
      success: false,
      message: "Помилка при оновленні призначень квартир.",
    };
  }
}

/**
 *  Show all apartments for a user (admin only)
 */
async function showAllApartmentsForUser({ targetUserId, isAdmin }) {
  if (!isAdmin) {
    return {
      success: false,
      message: "Тільки адміністратор може дивитись чужі квартири.",
    };
  }
  try {
    // If not numeric, try lookup
    if (!/^\d+$/.test(targetUserId)) {
      const foundUser = await lookupUserByNameOrUsername(targetUserId);
      logger.info(`Found user: ${JSON.stringify(foundUser)}`);
      if (!foundUser) {
        return {
          success: false,
          message: `Не знайшов користувача за запитом '${targetUserId}'.`,
        };
      }
      targetUserId = String(foundUser.userId);
    }

    const snap = await db
      .collection("cleaningAssignments")
      .where("userId", "==", targetUserId)
      .limit(1)
      .get();
    if (snap.empty) {
      return {
        success: true,
        message: `У користувача ${targetUserId} немає призначених квартир.`,
      };
    }
    const docData = snap.docs[0].data();
    const aptIds = docData.apartmentId || [];
    if (aptIds.length === 0) {
      return {
        success: true,
        message: `У користувача ${targetUserId} немає призначених квартир.`,
      };
    }
    return {
      success: true,
      message: `У користувача ${targetUserId} призначені квартири: ${aptIds.join(
        ", "
      )}`,
    };
  } catch (err) {
    logger.error("Error in showAllApartmentsForUser:", err);
    return {
      success: false,
      message: "Помилка при отриманні квартир.",
    };
  }
}

// functionSchemas - add new "show_user_apartments" function
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
            description:
              "Unique Firestore doc ID, e.g. '2025-03-15_598_checkout'",
          },
          newTime: {
            type: "string",
            description:
              "New time in 'HH:00' format (checkout <14:00, checkin >14:00).",
          },
          changeType: {
            type: "string",
            enum: ["checkin", "checkout"],
            description: "Which time to update? 'checkin' or 'checkout' only.",
          },
          userId: {
            type: "string",
            description: "Telegram user ID for logging",
          },
        },
        required: ["bookingId", "newTime", "changeType", "userId"],
        additionalProperties: false,
      },
    },
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
            description: "Unique Firestore doc ID of the booking",
          },
          newSumToCollect: {
            type: ["number", "null"],
            description: "Optional new sum to collect (if updating).",
          },
          newKeysCount: {
            type: ["number", "null"],
            description: "Optional new number of keys (if updating).",
          },
          userId: {
            type: "string",
            description: "Telegram user ID for logging",
          },
        },
        required: ["bookingId", "userId"],
        additionalProperties: false,
      },
    },
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
            description:
              "Telegram user ID OR partial name/username of user to modify",
          },
          action: {
            type: "string",
            enum: ["add", "remove"],
            description: "Whether to add or remove apartments",
          },
          apartmentIds: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Array of apartment IDs to add or remove",
          },
          isAdmin: {
            type: "boolean",
            description: "Whether the requesting user is an admin",
          },
        },
        required: ["targetUserId", "action", "apartmentIds", "isAdmin"],
        additionalProperties: false,
      },
    },
  },
  //  show_user_apartments
  {
    type: "function",
    function: {
      name: "show_user_apartments",
      description: "Shows all apartments assigned to a user (admin only).",
      parameters: {
        type: "object",
        properties: {
          targetUserId: {
            type: "string",
            description: "Telegram user ID or name of user to view",
          },
          isAdmin: {
            type: "boolean",
            description: "Whether the requesting user is an admin",
          },
        },
        required: ["targetUserId", "isAdmin"],
        additionalProperties: false,
      },
    },
  },
];

// systemPrompt - updated
const systemPrompt = `
You are a Telegram assistant for managing apartment bookings.

User references:
1. If user says "@username" or "username" or a partial name, you can search the Firestore "users" collection to find the user with "username" or "firstName" or "lastName" matching it.
2. If no user is found, ask for clarification.

User Permissions:
1. Admin users can:
   - See and modify all bookings
   - Add/remove apartment assignments for users
   - See assigned apartments for other users
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

4) "show_user_apartments": Lists all apartments assigned to a user (admin only)
   - Must be an admin to use this function
   - Just mention user by name or @username
   - The bot will automatically find their Telegram ID

Examples:
1. "Змініть виїзд 598 на 11:00" -> Use apartment ID "598"
2. "Встанови заїзд на 15:00 для Гусак" -> Use guest name "Гусак"
3. "Постав суму 300 для booking 2025-03-15_598_checkout" -> Use full booking ID
4. "Постав 2 ключі для Baseina" -> Use address "Baseina"
5. "Додай квартири 598, 321 для @username" -> Add apartments for user
6. "Видали квартиру 432 у @username" -> Remove apartment from user
7. "Показати квартири для @username" -> Show apartments for user
8. "Показати квартири для 1234567890" -> Show apartments for user with ID 1234567890

Always respond in Ukrainian.
If the user's request is unclear or missing information, ask for clarification.
If the user doesn't have permission to modify a booking or manage assignments, inform them.
`;

/**
 * handleMenuCommand, handleHelpCommand, handleAboutCommand 
 */
async function handleMenuCommand(chatId) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: "Оберіть опцію з меню:",
    reply_markup: mainMenuKeyboard,
  });
}

async function handleHelpCommand(chatId) {
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
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  });
}

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
 * The main webhook
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

    // Basic commands
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
        logger.info(`Text from user ${userId}: "${text}"`);

        // Load user data: admin or not?
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

        // Current bookings
        const today = getKievDate(0);
        const maxDate = getKievDate(7);
        const bookingSnap = await db
          .collection("bookings")
          .where("date", ">=", today)
          .where("date", "<=", maxDate)
          .orderBy("date")
          .get();

        const currentBookings = [];
        bookingSnap.forEach((doc) => {
          const data = doc.data();
          if (isAdmin || assignedApartments.includes(String(data.apartmentId))) {
            currentBookings.push({
              id: doc.id,
              ...data,
            });
          }
        });

        // conversation context
        const context = getConversationContext(chatId);

        // AI call
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            ...context.map((msg) => {
              if (msg.role === "function") {
                return {
                  role: "function",
                  name: msg.name,
                  content: msg.content,
                };
              }
              return {
                role: msg.role,
                content: msg.content,
                ...(msg.function_call && { function_call: msg.function_call }),
              };
            }),
            {
              role: "user",
              content: text,
            },
            {
              role: "system",
              content: `Current user context:
- User ID: ${userId}
- Is admin: ${isAdmin}
- Assigned apartments: ${isAdmin ? "ALL" : assignedApartments.join(", ")}
- Available bookings: ${JSON.stringify(currentBookings, null, 2)}`,
            },
          ],
          functions: functionSchemas.map((schema) => schema.function),
          function_call: "auto",
        });

        const message = completion.choices[0].message;
        if (!message) {
          return res.status(200).send({ success: true });
        }

        if (message.function_call) {
          // Function call
          const { name, arguments: rawArgs } = message.function_call;
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch (err) {
            logger.error("Error parsing function args:", err);
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: "Сталася помилка при обробці команди.",
            });
            return res.status(200).send({ success: true });
          }

          let result;
          if (name === "update_booking_time") {
            result = await updateBookingTimeInFirestore(parsedArgs);
          } else if (name === "update_booking_info") {
            result = await updateBookingInfoInFirestore(parsedArgs);
          } else if (name === "manage_apartment_assignments") {
            parsedArgs.isAdmin = isAdmin;
            result = await updateApartmentAssignments(parsedArgs);
          } 
          //  handle show_user_apartments
          else if (name === "show_user_apartments") {
            parsedArgs.isAdmin = isAdmin;
            result = await showAllApartmentsForUser(parsedArgs);
          } 
          else {
            logger.warn(`Unknown function call: ${name}`);
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: "Невідома команда, спробуйте ще раз.",
            });
            return res.status(200).send({ success: true });
          }

          const followUp = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              ...context.map((msg) => {
                if (msg.role === "function") {
                  return {
                    role: "function",
                    name: msg.name,
                    content: msg.content,
                  };
                }
                return {
                  role: msg.role,
                  content: msg.content,
                  ...(msg.function_call && { function_call: msg.function_call }),
                };
              }),
              { role: "user", content: text },
              {
                role: "assistant",
                content: null,
                function_call: { name, arguments: rawArgs },
              },
              {
                role: "function",
                name,
                content: JSON.stringify(result),
              },
            ],
            functions: functionSchemas.map((schema) => schema.function),
            function_call: "auto",
          });

          const finalMsg = followUp.choices[0].message;
          if (finalMsg.function_call) {
            logger.info("Model tried another function call after update.");
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: "Оновлено, але є ще функція. Наразі не обробляється.",
            });
          } else {
            // Send final text or fallback to the result message
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: finalMsg.content || result.message,
            });
          }

          updateConversationContext(chatId, {
            role: "assistant",
            content: null,
            function_call: { name, arguments: rawArgs },
          });
          updateConversationContext(chatId, {
            role: "function",
            name,
            content: JSON.stringify(result),
          });
        } else {
          // plain text
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: message.content || "Добре, зрозумів.",
          });

          updateConversationContext(chatId, {
            role: "assistant",
            content: message.content || "",
          });
        }

        updateConversationContext(chatId, {
          role: "user",
          content: text,
        });

        // Clear context if user typed a command
        if (
          text === "/start" ||
          text === "/menu" ||
          text === "/help" ||
          text === "/about"
        ) {
          clearConversationContext(chatId);
        }

        return res.status(200).send({ success: true });
    }
  } catch (err) {
    logger.error("Error in telegramWebhook:", err);
    return res.status(500).send({ success: false });
  }
});
