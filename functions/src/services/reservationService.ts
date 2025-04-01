// Service for handling reservation data (potentially syncing from CMS)
const reservationRepository = require("../repositories/reservationRepository");

// Example function
async function getReservationById(reservationId) {
  return reservationRepository.findById(reservationId);
}

module.exports = {
  getReservationById,
  // ... other reservation related logic (maybe less needed if syncService handles CMS interaction)
}; 