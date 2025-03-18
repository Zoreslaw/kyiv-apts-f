// The Cloud Functions for Firebase SDK to create Cloud Functions and triggers.
const { logger } = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");

// The Firebase Admin SDK to access Firestore.
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const axios = require("axios");

// Initialize Firebase
initializeApp();
const db = getFirestore();

// Telegram bot token (you'll get this from BotFather)
const BOT_TOKEN = process.env.BOT_TOKEN || "7762368824:AAETOA6o-WIRupRMH_1e9Gtqc77PK7dylg0";
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Webhook endpoint for Telegram
exports.telegramWebhook = onRequest(async (req, res) => {
  try {
    const update = req.body;
    logger.log("Update received:", update);

    // Check if this is a message with the /start command
    if (update.message && update.message.text === '/start') {
      const userId = update.message.from.id;
      const firstName = update.message.from.first_name;
      const lastName = update.message.from.last_name || '';
      const username = update.message.from.username || '';
      
      // Store user in Firestore
      const userRef = db.collection('users').doc(userId.toString());
      await userRef.set({
        userId,
        firstName,
        lastName,
        username,
        startedAt: new Date(),
        chatId: update.message.chat.id,
        type: 'cleaning',
        status: 'test'
      }, { merge: true });
      
      // Send welcome message
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: update.message.chat.id,
        text: `Welcome, ${firstName}! You've been registered.`
      });
      
      logger.log(`User ${firstName} (${userId}) registered`);
    }
    
    // Handle /get_my_tasks command
    if (update.message && update.message.text === '/get_my_tasks') {
      const userId = update.message.from.id;
      const chatId = update.message.chat.id;
      
      logger.log(`User ${userId} requested their tasks`);
      
      // First, check if user is an admin
      const userDoc = await db.collection('users').doc(userId.toString()).get();
      if (!userDoc.exists) {
        logger.warn(`User ${userId} not found in database`);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: "Ти не зареєстрований у системі. Будь ласка, скористайся командою /start."
        });
        res.status(200).send({ success: true });
        return;
      }
      
      const userData = userDoc.data();
      const isAdmin = userData.type === 'admin';
      logger.log(`User ${userId} is ${isAdmin ? 'an admin' : 'not an admin'}`);
      
      // For non-admin users, get their assigned apartments
      let assignedApartments = [];
      if (!isAdmin) {
        // Query for assignments where userId field matches this user
        const assignmentsQuery = await db.collection('cleaningAssignments')
          .where('userId', '==', userId.toString())
          .get();
        
        if (!assignmentsQuery.empty) {
          // Get the first matching document (assuming one user has one assignment doc)
          const assignmentDoc = assignmentsQuery.docs[0];
          assignedApartments = assignmentDoc.data().apartmentId || [];
          logger.log(`Found ${assignedApartments.length} assigned apartments for user ${userId}`);
        }
        
        if (assignedApartments.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "На тебе не додано жодних квартир. :("
          });
          res.status(200).send({ success: true });
          return;
        }
        
        logger.log(`Assigned apartment IDs: ${JSON.stringify(assignedApartments)}`);
      } else {
        // For admins, we'll fetch all data and not filter by apartment
        logger.log(`Admin user ${userId} requested all tasks`);
      }
      
      // Fetch both checkouts and checkins from API
      const checkoutsResponse = await axios.get("https://kievapts.com/api/1.1/json/checkouts");
      const checkinsResponse = await axios.get("https://kievapts.com/api/1.1/json/checkins");
      
      // Extract the date-organized data
      const checkoutsByDate = checkoutsResponse.data.response || {};
      const checkinsByDate = checkinsResponse.data.response || {};
      
      logger.log(`Checkout dates available: ${Object.keys(checkoutsByDate).join(', ')}`);
      logger.log(`Checkin dates available: ${Object.keys(checkinsByDate).join(', ')}`);
      
      // Combine all dates from both checkouts and checkins
      const allDates = [...new Set([
        ...Object.keys(checkoutsByDate),
        ...Object.keys(checkinsByDate)
      ])].sort();
      
      // If no dates are available
      if (allDates.length === 0) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: "Немає даних про заїзди або виїзди на найближчі дні."
        });
        res.status(200).send({ success: true });
        return;
      }
      
      // For each date, get relevant checkouts and checkins
      let hasAnyTasks = false;
      
      for (const date of allDates) {
        let dateCheckouts = checkoutsByDate[date] || [];
        let dateCheckins = checkinsByDate[date] || [];
        
        // For non-admin users, filter by assigned apartments
        if (!isAdmin) {
          dateCheckouts = dateCheckouts.filter(checkout => {
            const checkoutApartmentId = String(checkout.apartment_id);
            return assignedApartments.includes(checkoutApartmentId);
          });
          
          dateCheckins = dateCheckins.filter(checkin => {
            const checkinApartmentId = String(checkin.apartment_id);
            return assignedApartments.includes(checkinApartmentId);
          });
        }
        
        // Skip this date if no relevant tasks
        if (dateCheckouts.length === 0 && dateCheckins.length === 0) {
          continue;
        }
        
        hasAnyTasks = true;
        
        // Format date for display (assuming YYYY-MM-DD format)
        const [year, month, day] = date.split('-');
        const formattedDate = `${day}.${month}.${year}`;
        
        // Create a decorated date header message with extra spacing
        let dateMessage = `\n\n📅 *${formattedDate}* 📅\n\n====================\n\n`;
        
        // Add decorated checkouts section
        if (dateCheckouts.length > 0) {
          dateMessage += `🔥 *ВИЇЗДИ (Прибирання до 14:00):* 🔥\n\n`;
          for (const checkout of dateCheckouts) {
            dateMessage += `🔴 *ID:* ${checkout.apartment_id}\n`;
            dateMessage += `🏠 *Aдреса:* ${checkout.apartment_address}\n`;
            dateMessage += `👤 *Гість:* ${checkout.guest_name} - Виїзд о 12:00\n`;
            dateMessage += `📞 *Контакти:* ${checkout.guest_contact}\n\n`;
          }
        }
        
        // Add decorated checkins section
        if (dateCheckins.length > 0) {
          dateMessage += `✨ *ЗАЇЗДИ (Квартира має бути готова):* ✨\n\n`;
          for (const checkin of dateCheckins) {
            dateMessage += `🟢 *ID:* ${checkin.apartment_id}\n`;
            dateMessage += `🏠 *Aдреса:* ${checkin.apartment_address}\n`;
            dateMessage += `👤 *Гість:* ${checkin.guest_name} - Заїзд після 14:00\n`;
            dateMessage += `📞 *Контакти:* ${checkin.guest_contact}\n\n`;
          }
        }
        
        // Send the decorated message for this date
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: dateMessage,
          parse_mode: 'Markdown'
        });
      }
      
      if (!hasAnyTasks) {
        const message = isAdmin ? 
          "Немає жодних заїздів або виїздів на найближчі дні." :
          "Наразі немає квартир для прибирирання. Перевірте бота пізніше";
        
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: message
        });
      }
      
      logger.log(`Task request completed for user ${userId}`);
      res.status(200).send({ success: true });
      return;
    }
    
    res.status(200).send({ success: true });
  } catch (error) {
    logger.error('Error handling webhook:', error);
    res.status(500).send({ success: false });
  }
});
