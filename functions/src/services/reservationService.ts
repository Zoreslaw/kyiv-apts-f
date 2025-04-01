import * as reservationRepository from "../repositories/reservationRepository";

interface Reservation {
  id: string;
}

async function getReservationById(reservationId: string): Promise<Reservation | null> {
  return reservationRepository.findById(reservationId);
}

export {
  getReservationById,
}; 