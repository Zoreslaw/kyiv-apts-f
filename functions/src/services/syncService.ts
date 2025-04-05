import axios from "axios";
import { Timestamp } from "firebase-admin/firestore";
import { findById, createReservation } from "../repositories/reservationRepository";
import { findById as findTaskById, updateTask, createTask } from "../repositories/taskRepository";
import { findAllApartments } from "../repositories/apartmentRepository";
import { TaskTypes, TaskStatuses, DEFAULT_CHECKIN_TIME, DEFAULT_CHECKOUT_TIME } from "../utils/constants";
import { Apartment, IApartmentData } from "../models/Apartment";
import { ITaskData, Task } from "../models/Task";
import { IReservationData, Reservation } from "../models/Reservation";
import { logger } from "firebase-functions";
import { CMS_API_BASE, CMS_ENDPOINTS } from "../config/cmsApi";

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
    throw error;
  }
}

export async function syncReservationsAndTasks(): Promise<void> {
  logger.info("[syncReservationsAndTasks] Starting sync process");

  try {
    // Fetch checkouts and checkins
    logger.info("[syncReservationsAndTasks] Fetching checkouts from CMS...");
    const checkoutsResponse = await fetchFromCMS(CMS_ENDPOINTS.checkouts);
    logger.info(`[syncReservationsAndTasks] Found checkouts for ${Object.keys(checkoutsResponse).length} dates`);

    logger.info("[syncReservationsAndTasks] Fetching checkins from CMS...");
    const checkinsResponse = await fetchFromCMS(CMS_ENDPOINTS.checkins);
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
          const reservationData = mapCmsToReservation(cmsCheckout, date, TaskTypes.CHECK_OUT);
          const apartment = apartmentMap.get(String(reservationData.apartmentId));

          // Upsert Reservation
          let reservation: Reservation;
          const existingReservation = await findById(reservationData.id!);
            
          if (existingReservation) {
            reservation = existingReservation;
            logger.info(`[syncReservationsAndTasks] Using existing reservation: ${reservation.id}`);
          } else {
            const now = Timestamp.now();
            reservation = await createReservation({
              ...reservationData,
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
          const reservationData = mapCmsToReservation(cmsCheckin, date, TaskTypes.CHECK_IN);
          const apartment = apartmentMap.get(String(reservationData.apartmentId));

          // Upsert Reservation
          let reservation: Reservation;
          const existingReservation = await findById(reservationData.id!);
            
          if (existingReservation) {
            reservation = existingReservation;
            logger.info(`[syncReservationsAndTasks] Using existing reservation: ${reservation.id}`);
          } else {
            const now = Timestamp.now();
            reservation = await createReservation({
              ...reservationData,
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
    // Generate a deterministic ID
    const reservationId = `${cmsData.apartment_id}_${date}_${type}`;

    // Adjust field names based on your actual CMS API response
    const reservation: Partial<IReservationData> = {
        id: reservationId, // Always use our deterministic ID
        apartmentId: String(cmsData.apartment_id),
        guestName: cmsData.guest_name || "Unknown",
        guestContact: cmsData.guest_contact || null,
        // We only get checkin/checkout day from these endpoints, not full stay range
        bookingSource: cmsData.source || null,
        sumToCollect: Number(cmsData.sumToCollect) || 0,
        keysCount: Number(cmsData.keys_count) || 1,
    };

    // Set the appropriate date field
    if (type === TaskTypes.CHECK_IN) {
      reservation.checkinDate = date;
    } else if (type === TaskTypes.CHECK_OUT) {
      reservation.checkoutDate = date;
    }

    return reservation;
}

// Helper to create or update a Task based on CMS data
async function createOrUpdateTaskFromCmsData(
  reservation: Reservation,
  cmsData: any,
  taskType: TaskTypes,
  date: string,
  apartment?: Apartment
): Promise<Task> {
  const taskId = `${reservation.id}_${taskType}`;
  const taskData: ITaskData = {
    id: taskId,
    reservationId: reservation.id,
    apartmentId: reservation.apartmentId,
    address: apartment?.address || cmsData.apartment_address || "Address Missing",
    type: taskType,
    status: TaskStatuses.PENDING,
    dueDate: Timestamp.fromDate(new Date(date)),
    guestName: reservation.guestName,
    guestPhone: reservation.guestContact,
    guestEmail: null,
    notes: `Guest: ${reservation.guestName}. Collect: ${reservation.sumToCollect}. Keys: ${reservation.keysCount}.`,
    apartmentName: apartment?.name || '',
    sumToCollect: reservation.sumToCollect,
    keysCount: reservation.keysCount,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };

  let task: Task;
  const existingTask = await findTaskById(taskId);
  
  if (existingTask) {
    task = await updateTask(taskId, {
      ...taskData,
      updatedAt: Timestamp.now()
    });
    logger.info(`[createOrUpdateTaskFromCmsData] Updated task: ${task.id}`);
  } else {
    task = await createTask(taskData);
    logger.info(`[createOrUpdateTaskFromCmsData] Created new task: ${task.id}`);
  }

  return task;
} 