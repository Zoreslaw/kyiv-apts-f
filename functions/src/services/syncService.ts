import axios from "axios";
import * as functions from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { findById, createReservation } from "../repositories/reservationRepository";
import { findById as findTaskById, updateTask, createTask } from "../repositories/taskRepository";
import { findAllApartments, findApartmentById } from "../repositories/apartmentRepository";
import { getKievDate } from "../utils/dateTime";
import { TaskTypes, TaskStatuses, DEFAULT_CHECKIN_TIME, DEFAULT_CHECKOUT_TIME } from "../utils/constants";
import { Apartment, IApartmentData } from "../models/Apartment";
import { ITaskData, Task } from "../models/Task";
import { IReservationData, Reservation } from "../models/Reservation";
import { logger } from "firebase-functions";

const TASKS_COLLECTION = "tasks";

// Placeholder for CMS API base URL - move to config/env
const CMS_API_BASE = "https://kievapts.com/api/1.1/json";

interface CmsData {
  reservation_id?: string;
  apartment_id: string;
  guest_name?: string;
  guest_contact?: string;
  source?: string;
  sumToCollect?: number;
  keys_count?: number;
  apartment_address?: string;
  [key: string]: any;
}

interface CMSResponse {
  response: Record<string, CmsData[]>;
}

export async function fetchFromCMS(endpoint: string): Promise<Record<string, CmsData[]>> {
  try {
    logger.info(`[fetchFromCMS] Fetching data from ${endpoint}`);
    const response = await axios.get<CMSResponse>(`${CMS_API_BASE}/${endpoint}`);
    if (response.data?.response) {
      logger.info(`[fetchFromCMS] Successfully fetched data from ${endpoint}`);
      return response.data.response;
    }
    logger.warn(`[fetchFromCMS] CMS endpoint ${endpoint} returned unexpected data:`, response.data);
    return {};
  } catch (error) {
    logger.error(`[fetchFromCMS] Error fetching from CMS endpoint ${endpoint}:`, error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

// The main sync logic - to be called by the scheduled trigger
export async function syncReservationsAndTasks(): Promise<void> {
  logger.info("[syncReservationsAndTasks] Starting sync process");

  try {
    // --- 1. Fetch data from CMS --- //
    // Fetch for a relevant period (e.g., yesterday, today, next few days)
    const today = getKievDate(0);
    // Add relevant dates - adjust range as needed
    const datesToFetch = [getKievDate(-1), today, getKievDate(1), getKievDate(2)];
    logger.info(`[syncReservationsAndTasks] Fetching data for dates: ${datesToFetch.join(', ')}`);

    // Fetch checkouts and checkins
    logger.info("[syncReservationsAndTasks] Fetching checkouts from CMS...");
    const checkoutsResponse = await fetchFromCMS("checkouts");
    logger.info(`[syncReservationsAndTasks] Found checkouts for ${Object.keys(checkoutsResponse).length} dates`);

    logger.info("[syncReservationsAndTasks] Fetching checkins from CMS...");
    const checkinsResponse = await fetchFromCMS("checkins");
    logger.info(`[syncReservationsAndTasks] Found checkins for ${Object.keys(checkinsResponse).length} dates`);

    // --- 2. Process and Upsert Reservations & Tasks --- //
    const processedReservationIds = new Set<string>();
    const apartments = await findAllApartments();
    const apartmentMap = new Map<string, Apartment>(
      apartments.map((apt: Apartment) => [String(apt.id), apt])
    );
    logger.info(`[syncReservationsAndTasks] Loaded ${apartments.length} apartments`);

    const allDates = [...new Set([
      ...Object.keys(checkoutsResponse),
      ...Object.keys(checkinsResponse)
    ])];

    logger.info(`[syncReservationsAndTasks] Processing ${allDates.length} dates`);

    for (const date of allDates) {
      logger.info(`[syncReservationsAndTasks] Processing date: ${date}`);
      const checkouts = checkoutsResponse[date] || [];
      const checkins = checkinsResponse[date] || [];

      logger.info(`[syncReservationsAndTasks] Found ${checkouts.length} checkouts and ${checkins.length} checkins for ${date}`);

      // Process checkouts
      for (const cmsCheckout of checkouts) {
        try {
          const reservationData = mapCmsToReservation(cmsCheckout, date, "checkout");
          const apartment = apartmentMap.get(String(reservationData.apartmentId));

          // Upsert Reservation
          let reservation: Reservation;
          const existingReservation = reservationData.id 
            ? await findById(reservationData.id) 
            : null;
            
          if (existingReservation) {
            reservation = existingReservation;
            logger.info(`[syncReservationsAndTasks] Using existing reservation: ${reservation.id}`);
          } else {
            const now = Timestamp.now();
            const reservationId = `${cmsCheckout.apartment_id}_${date}_checkout`;
            reservation = await createReservation({
              ...reservationData,
              id: reservationId,
              createdAt: now,
              updatedAt: now
            } as IReservationData);
            logger.info(`[syncReservationsAndTasks] Created new reservation: ${reservation.id}`);
          }
          
          processedReservationIds.add(reservation.id);

          // Create or Update Checkout Task
          await createOrUpdateTaskFromCmsData(reservation, cmsCheckout, TaskTypes.CHECK_OUT, date, apartment);
        } catch (error) {
          logger.error(`[syncReservationsAndTasks] Error processing checkout for apartment ${cmsCheckout.apartment_id}:`, error);
        }
      }

      // Process checkins
      for (const cmsCheckin of checkins) {
        try {
          const reservationData = mapCmsToReservation(cmsCheckin, date, "checkin");
          const apartment = apartmentMap.get(String(reservationData.apartmentId));

          // Upsert Reservation
          let reservation: Reservation;
          const existingReservation = reservationData.id 
            ? await findById(reservationData.id) 
            : null;
            
          if (existingReservation) {
            reservation = existingReservation;
            logger.info(`[syncReservationsAndTasks] Using existing reservation: ${reservation.id}`);
          } else {
            const now = Timestamp.now();
            const reservationId = `${cmsCheckin.apartment_id}_${date}_checkin`;
            reservation = await createReservation({
              ...reservationData,
              id: reservationId,
              createdAt: now,
              updatedAt: now
            } as IReservationData);
            logger.info(`[syncReservationsAndTasks] Created new reservation: ${reservation.id}`);
          }
          
          processedReservationIds.add(reservation.id);

          // Create or Update Checkin Task
          await createOrUpdateTaskFromCmsData(reservation, cmsCheckin, TaskTypes.CHECK_IN, date, apartment);
        } catch (error) {
          logger.error(`[syncReservationsAndTasks] Error processing checkin for apartment ${cmsCheckin.apartment_id}:`, error);
        }
      }
    }

    logger.info(`[syncReservationsAndTasks] Sync completed. Processed ${processedReservationIds.size} reservations.`);
  } catch (error) {
    logger.error("[syncReservationsAndTasks] Critical error during sync:", error);
    throw error;
  }
}

// Helper to map CMS data to our Reservation model structure
function mapCmsToReservation(cmsData: CmsData, date: string, type: string): Partial<IReservationData> {
    // Adjust field names based on your actual CMS API response
    const reservation: Partial<IReservationData> = {
        id: cmsData.reservation_id, // Only set if we have a stable ID
        apartmentId: String(cmsData.apartment_id),
        guestName: cmsData.guest_name || "Unknown",
        guestContact: cmsData.guest_contact || null,
        // We only get checkin/checkout day from these endpoints, not full stay range
        bookingSource: cmsData.source || null,
        sumToCollect: Number(cmsData.sumToCollect) || 0,
        keysCount: Number(cmsData.keys_count) || 1,
    };

    // Set the appropriate date field
    if (type === "checkin") {
      reservation.checkinDate = date;
    } else if (type === "checkout") {
      reservation.checkoutDate = date;
    }

    return reservation;
}

// Helper to create or update a Task based on CMS data
async function createOrUpdateTaskFromCmsData(
  reservation: Reservation, 
  cmsData: CmsData, 
  taskType: TaskTypes, 
  date: string, 
  apartment?: Apartment
): Promise<void> {
    try {
        const taskData: Partial<ITaskData> = {
            reservationId: reservation.id,
            apartmentId: reservation.apartmentId,
            address: apartment?.address || cmsData.apartment_address || "Address Missing",
            taskType: taskType,
            dueDate: date,
            status: TaskStatuses.PENDING,
            notes: `Guest: ${reservation.guestName}. Collect: ${reservation.sumToCollect}. Keys: ${reservation.keysCount}.`,
            sumToCollect: reservation.sumToCollect,
            keysCount: reservation.keysCount,
            updatedAt: Timestamp.now(),
            // Set default times based on task type
            checkinTime: taskType === TaskTypes.CHECK_IN ? DEFAULT_CHECKIN_TIME : null,
            checkoutTime: taskType === TaskTypes.CHECK_OUT ? DEFAULT_CHECKOUT_TIME : null,
        };

        // The repository's createTask function will handle deduplication
        await createTask(taskData as Omit<ITaskData, 'id'>);
    } catch (error) {
        logger.error(`Error in createOrUpdateTaskFromCmsData:`, error);
        throw error;
    }
} 