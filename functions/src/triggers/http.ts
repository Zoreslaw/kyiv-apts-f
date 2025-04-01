// Handles HTTP triggers (e.g., Telegram webhook)
const functions = require("firebase-functions");
const { handleTelegramWebhook } = require("../services/telegramService"); // Example dependency

exports.telegramWebhook = functions.https.onRequest(async (req, res) => {
  try {
    // Basic parsing and validation could go here
    await handleTelegramWebhook(req.body);
    res.status(200).send({ success: true });
  } catch (error) {
    console.error("Error in telegramWebhook trigger:", error);
    // Avoid sending detailed errors back to Telegram
    res.status(200).send({ success: true }); // Acknowledge Telegram to prevent retries
  }
}); 