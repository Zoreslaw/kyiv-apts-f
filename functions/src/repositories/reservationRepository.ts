import { getFirestore, Timestamp, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Reservation, IReservationData } from "../models/Reservation";

const db = getFirestore();
const RESERVATIONS_COLLECTION = "reservations";

async function findById(reservationId: string): Promise<Reservation | null> {
  const docRef = db.collection(RESERVATIONS_COLLECTION).doc(reservationId);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    return null;
  }
  const data = snapshot.data() as IReservationData;
  return new Reservation(data);
}

async function findByDateRange(startDate: Date | Timestamp, endDate: Date | Timestamp): Promise<Reservation[]> {
    const snapshot = await db.collection(RESERVATIONS_COLLECTION)
      .where("checkinDate", ">=", startDate)
      .where("checkinDate", "<=", endDate)
      .get();
    if (snapshot.empty) {
        return [];
    }
    return snapshot.docs.map((doc: QueryDocumentSnapshot): Reservation => {
        const data = doc.data() as IReservationData;
        return new Reservation(data);
    });
}

async function createReservation(data: IReservationData): Promise<Reservation> {
    const docRef = db.collection(RESERVATIONS_COLLECTION).doc();
    await docRef.set(data);
    return new Reservation(data);
}

export {
  findById,
  findByDateRange,
  createReservation
}; 