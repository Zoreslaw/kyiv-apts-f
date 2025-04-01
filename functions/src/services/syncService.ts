// Service for syncing data with external CMS and creating tasks
const axios = require("axios");
const functions = require("firebase-functions");
const reservationRepository = require("../repositories/reservationRepository");
const taskRepository = require("../repositories/taskRepository");
const apartmentRepository = require("../repositories/apartmentRepository");
const { getKievDate } = require("../utils/dateTime");
const { TaskTypes, TaskStatuses } = require("../utils/constants");

// Placeholder for CMS API base URL - move to config/env
const CMS_API_BASE = "https://kievapts.com/api/1.1/json";

async function fetchFromCMS(endpoint) {
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
async function syncReservationsAndTasks() {
  console.log("Starting reservation and task sync...");

  // --- 1. Fetch data from CMS --- //
  // Fetch for a relevant period (e.g., yesterday, today, next few days)
  // Note: Original code only fetched checkins/checkouts for specific dates.
  // A more robust sync might need a different CMS endpoint or logic
  // to get all relevant *reservations* within a date range.
  // Let's stick to the checkin/checkout model for now.

  const today = getKievDate(0);
  // Add relevant dates - adjust range as needed
  const datesToFetch = [getKievDate(-1), today, getKievDate(1), getKievDate(2)];

  const allCheckouts = {};
  const allCheckins = {};

  // This part is inefficient if the API supports date ranges.
  // If API *only* supports /checkouts and /checkins (implies specific date),
  // we have to call it per date.
  // **ASSUMPTION:** API provides data *for a specific date implicitly* or requires date param.
  // The old code structure implies the API endpoints are `/checkouts` and `/checkins` returning
  // data grouped *by date* within the response. Let's stick to that.
  console.log("Fetching checkouts from CMS...");
  const checkoutsResponse = await fetchFromCMS("checkouts"); // Assuming this returns data for multiple dates
  console.log("Fetching checkins from CMS...");
  const checkinsResponse = await fetchFromCMS("checkins"); // Assuming this returns data for multiple dates

  // --- 2. Process and Upsert Reservations & Tasks --- //
  const processedReservationIds = new Set();
  const apartments = await apartmentRepository.getAllApartments(); // Cache apartments
  const apartmentMap = new Map(apartments.map(apt => [String(apt.id), apt]));

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

          // Upsert Reservation
          const reservation = await reservationRepository.upsertReservation(reservationData);
          processedReservationIds.add(reservation.id);

          // Create or Update Checkout Task
          await createOrUpdateTaskFromCmsData(reservation, cmsCheckout, TaskTypes.CHECK_OUT, date, apartment);
      }

      // --- Process Checkins (implies Reservations and Checkin Tasks) ---
      for (const cmsCheckin of checkins) {
           const reservationData = mapCmsToReservation(cmsCheckin, date, "checkin");
           const apartment = apartmentMap.get(String(reservationData.apartmentId));

          // Upsert Reservation - might be the same reservation as checkout if same day
          const reservation = await reservationRepository.upsertReservation(reservationData);
          processedReservationIds.add(reservation.id);

          // Create or Update Checkin Task
          await createOrUpdateTaskFromCmsData(reservation, cmsCheckin, TaskTypes.CHECK_IN, date, apartment);
      }
  }

  // --- 3. Optional: Handle Cancellations/Clean-up --- //
  // Find tasks/reservations in Firestore for the synced date range that *were not* processed.
  // This indicates they might be cancelled in the CMS.
  // Mark them as cancelled or flag for review.
  // This logic needs careful implementation to avoid accidental cancellations.
  console.log(`Sync processed ${processedReservationIds.size} reservations.`);

  console.log("Reservation and task sync finished.");
}

// Helper to map CMS data to our Reservation model structure
function mapCmsToReservation(cmsData, date, type) {
    // Adjust field names based on your actual CMS API response
    const reservation = {
        cmsBookingId: cmsData.booking_id || `${date}_${cmsData.apartment_id}`, // NEED a stable booking ID from CMS
        apartmentId: String(cmsData.apartment_id),
        guestName: cmsData.guest_name || "Unknown",
        guestContact: cmsData.guest_contact || null,
        // We only get checkin/checkout day from these endpoints, not full stay range
        // This model might need adjustment if CMS provides full stay dates elsewhere
        checkinDate: type === "checkin" ? date : null, // Or fetch full reservation details?
        checkoutDate: type === "checkout" ? date : null,
        bookingSource: cmsData.source || null,
        sumToCollect: Number(cmsData.sumToCollect) || 0,
        keysCount: Number(cmsData.keys_count) || 1,
        // Timestamps managed by Firestore
    };
    // Clean out null checkin/checkout dates if not applicable
    if (!reservation.checkinDate) delete reservation.checkinDate;
    if (!reservation.checkoutDate) delete reservation.checkoutDate;
    return reservation;
}

// Helper to create or update a Task based on CMS data
async function createOrUpdateTaskFromCmsData(reservation, cmsData, taskType, date, apartment) {
    // Task ID strategy: e.g., `${reservation.id}_${taskType}`
    const taskId = `${reservation.id}_${taskType}`;
    const existingTask = await taskRepository.findById(taskId);

    const taskData = {
        reservationId: reservation.id,
        apartmentId: reservation.apartmentId,
        address: apartment?.address || cmsData.apartment_address || "Address Missing", // Get from apartmentMap or CMS
        taskType: taskType,
        dueDate: date, // The day the task needs to happen
        // Initial status - adjust as needed
        status: existingTask ? existingTask.status : TaskStatuses.PENDING,
        notes: `Guest: ${reservation.guestName}. Collect: ${reservation.sumToCollect}. Keys: ${reservation.keysCount}.`, // Example notes
        // assignedStaffId will be set later by assignment logic or manually
        // Keep existing timestamps if updating
        createdAt: existingTask ? existingTask.createdAt : new Date(),
        updatedAt: new Date(),
        // maybe add cmsLastUpdatedAt: cmsData.last_updated_timestamp // if available
    };

    if (existingTask) {
        console.log(`Updating existing task: ${taskId}`);
        // Only update certain fields from CMS, preserve operational data
        const { status, assignedStaffId, notes, ...restOfExisting } = existingTask; // Keep existing status, assignee, notes
        await taskRepository.updateTask(taskId, { ...restOfExisting, ...taskData }); // Overwrite with fresh CMS-derived data, keeping status etc.
    } else {
        console.log(`Creating new task: ${taskId}`);
        await taskRepository.createTask({ ...taskData });
        // If creating, maybe trigger assignment logic?
    }
}

module.exports = {
  syncReservationsAndTasks,
}; 