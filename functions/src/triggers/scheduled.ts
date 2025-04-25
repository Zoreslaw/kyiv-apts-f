// Handles scheduled function triggers
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { syncReservationsAndTasks } from "../services/syncService";

/**
 * Scheduled function to sync reservations and tasks from CMS
 * Runs every 60 minutes
 */
export const scheduledSync = onSchedule(
  { schedule: "every 60 minutes" },
  async (event) => {
    try {
      logger.info("Starting scheduled sync...");
      await syncReservationsAndTasks();
      logger.info("Scheduled sync completed successfully.");
    } catch (error) {
      logger.error("Error in scheduledSync trigger:", error);
      throw error; // Rethrow to mark the function as failed
    }
  }
); 