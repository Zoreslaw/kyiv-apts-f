// Handles scheduled function triggers
const functions = require("firebase-functions");
const { syncReservationsAndTasks } = require("../services/syncService"); // Example dependency

exports.scheduledSync = functions.pubsub
  .schedule("every 60 minutes") // Adjust schedule as needed
  .onRun(async (context: any) => {
    try {
      console.log("Running scheduled sync...");
      await syncReservationsAndTasks();
      console.log("Scheduled sync completed.");
    } catch (error) {
      console.error("Error in scheduledSync trigger:", error);
      // Error reporting (e.g., to Error Reporting service)
    }
  }); 