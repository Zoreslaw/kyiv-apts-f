import axios from "axios";
import * as functions from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { findById, createReservation } from "../repositories/reservationRepository";
import { findById as findTaskById, updateTask, createTask } from "../repositories/taskRepository";
import { findAllApartments, findApartmentById } from "../repositories/apartmentRepository";
import { getKievDate } from "../utils/dateTime";
import { TaskTypes, TaskStatuses } from "../utils/constants";
import { Apartment, IApartmentData } from "../models/Apartment";
import { ITaskData, Task } from "../models/Task";
import { IReservationData, Reservation } from "../models/Reservation";

// Placeholder for CMS API base URL - move to config/env
const CMS_API_BASE = "https://kievapts.com/api/1.1/json";

interface CmsData {
  booking_id?: string;
  apartment_id: string;
  guest_name?: string;
  guest_contact?: string;
  source?: string;
  sumToCollect?: number;
  keys_count?: number;
  apartment_address?: string;
  [key: string]: any;
}

async function fetchFromCMS(endpoint: string): Promise<Record<string, CmsData[]>> {
  try {
    const response = await axios.get(`${CMS_API_BASE}/${endpoint}`);
    // Basic validation - adapt based on actual API response structure
    if (response.data && response.data.response) {
      return response.data.response;
    }
    console.warn(`CMS endpoint ${endpoint} returned unexpected data:`, response.data);
    return {}; // Return empty object on failure/unexpected format
  } catch (error) {
    console.error(`Error fetching from CMS endpoint ${endpoint}:`, error);
    return {}; // Return empty object on error
  }
}

// The main sync logic - to be called by the scheduled trigger
async function syncReservationsAndTasks(): Promise<void> {
  console.log("Starting reservation and task sync...");

  // --- 1. Fetch data from CMS --- //
  // Fetch for a relevant period (e.g., yesterday, today, next few days)
  const today = getKievDate(0);
  // Add relevant dates - adjust range as needed
  const datesToFetch = [getKievDate(-1), today, getKievDate(1), getKievDate(2)];

  // This part is inefficient if the API supports date ranges.
  // The old code structure implies the API endpoints are `/checkouts` and `/checkins` returning
  // data grouped *by date* within the response.
  console.log("Fetching checkouts from CMS...");
  const checkoutsResponse = await fetchFromCMS("checkouts");
  console.log("Fetching checkins from CMS...");
  const checkinsResponse = await fetchFromCMS("checkins");

  // --- 2. Process and Upsert Reservations & Tasks --- //
  const processedReservationIds = new Set<string>();
  const apartments = await findAllApartments();
  const apartmentMap = new Map<string, Apartment>(
    apartments.map((apt: Apartment) => [String(apt.id), apt])
  );

  const allDates = [...new Set([
      ...Object.keys(checkoutsResponse),
      ...Object.keys(checkinsResponse)
  ])];

  for (const date of allDates) {
      const checkouts = checkoutsResponse[date] || [];
      const checkins = checkinsResponse[date] || [];

      // --- Process Checkouts (implies Reservations and Checkout Tasks) ---
      for (const cmsCheckout of checkouts) {
          const reservationData = mapCmsToReservation(cmsCheckout, date, "checkout");
          const apartment = apartmentMap.get(String(reservationData.apartmentId));

          // Upsert Reservation - since there's no upsertReservation in the repository
          // we'll check if it exists and create if not
          let reservation: Reservation;
          const existingReservation = reservationData.id 
            ? await findById(reservationData.id) 
            : null;
            
          if (existingReservation) {
            // Update logic would go here if needed
            reservation = existingReservation;
          } else {
            // Add timestamps for new reservations
            const now = Timestamp.now();
            // Generate an ID for new reservations
            const reservationId = `${cmsCheckout.apartment_id}_${date}_checkout`;
            reservation = await createReservation({
              ...reservationData,
              id: reservationId, // Ensure ID is set
              createdAt: now,
              updatedAt: now
            } as IReservationData);
          }
          
          processedReservationIds.add(reservation.id);

          // Create or Update Checkout Task
          await createOrUpdateTaskFromCmsData(reservation, cmsCheckout, TaskTypes.CHECK_OUT, date, apartment);
      }

      // --- Process Checkins (implies Reservations and Checkin Tasks) ---
      for (const cmsCheckin of checkins) {
           const reservationData = mapCmsToReservation(cmsCheckin, date, "checkin");
           const apartment = apartmentMap.get(String(reservationData.apartmentId));

          // Upsert Reservation - same approach as above
          let reservation: Reservation;
          const existingReservation = reservationData.id 
            ? await findById(reservationData.id) 
            : null;
            
          if (existingReservation) {
            // Update logic would go here if needed
            reservation = existingReservation;
          } else {
            // Add timestamps for new reservations
            const now = Timestamp.now();
            // Generate an ID for new reservations
            const reservationId = `${cmsCheckin.apartment_id}_${date}_checkin`;
            reservation = await createReservation({
              ...reservationData,
              id: reservationId, // Ensure ID is set 
              createdAt: now,
              updatedAt: now
            } as IReservationData);
          }
          
          processedReservationIds.add(reservation.id);

          // Create or Update Checkin Task
          await createOrUpdateTaskFromCmsData(reservation, cmsCheckin, TaskTypes.CHECK_IN, date, apartment);
      }
  }

  // --- 3. Optional: Handle Cancellations/Clean-up --- //
  // Find tasks/reservations in Firestore for the synced date range that *were not* processed.
  // This indicates they might be cancelled in the CMS.
  console.log(`Sync processed ${processedReservationIds.size} reservations.`);

  console.log("Reservation and task sync finished.");
}

// Helper to map CMS data to our Reservation model structure
function mapCmsToReservation(cmsData: CmsData, date: string, type: string): Partial<IReservationData> {
    // Adjust field names based on your actual CMS API response
    const reservation: Partial<IReservationData> = {
        id: cmsData.booking_id, // Only set if we have a stable ID
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
    // Task ID strategy: e.g., `${reservation.id}_${taskType}`
    const taskId = `${reservation.id}_${taskType}`;
    const existingTask = await findTaskById(taskId);

    const taskData: Partial<ITaskData> = {
        id: taskId,
        reservationId: reservation.id,
        apartmentId: reservation.apartmentId,
        address: apartment?.address || cmsData.apartment_address || "Address Missing",
        taskType: taskType,
        dueDate: date,
        status: existingTask ? existingTask.status : TaskStatuses.PENDING,
        notes: `Guest: ${reservation.guestName}. Collect: ${reservation.sumToCollect}. Keys: ${reservation.keysCount}.`,
        sumToCollect: reservation.sumToCollect,
        keysCount: reservation.keysCount,
        updatedAt: Timestamp.now(),
    };

    if (existingTask) {
        console.log(`Updating existing task: ${taskId}`);
        // Only update certain fields from CMS, preserve operational data
        const { status, assignedStaffId, notes, ...restToUpdate } = taskData;
        await updateTask(taskId, restToUpdate);
    } else {
        console.log(`Creating new task: ${taskId}`);
        const now = Timestamp.now();
        await createTask({
          ...taskData,
          createdAt: now,
          updatedAt: now,
          id: taskId
        } as ITaskData);
    }
}

export {
  syncReservationsAndTasks,
}; 