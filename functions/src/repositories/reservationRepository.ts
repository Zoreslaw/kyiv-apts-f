import { Timestamp, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { IReservationData, Reservation } from "../models/Reservation";
import { logger } from "firebase-functions";

const RESERVATIONS_COLLECTION = "reservations";

async function findById(reservationId: string): Promise<Reservation | null> {
  try {
    const docRef = db.collection(RESERVATIONS_COLLECTION).doc(reservationId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return null;
    }
    const data = snapshot.data() as IReservationData;
    return new Reservation({
      ...data,
      id: snapshot.id
    });
  } catch (error) {
    logger.error("[ReservationRepository] Error in findById:", error);
    throw error;
  }
}

async function findByDateRange(startDate: Date | Timestamp, endDate: Date | Timestamp): Promise<Reservation[]> {
  try {
    const snapshot = await db.collection(RESERVATIONS_COLLECTION)
      .where("checkinDate", ">=", startDate)
      .where("checkinDate", "<=", endDate)
      .get();
    if (snapshot.empty) {
      return [];
    }
    return snapshot.docs.map((doc: QueryDocumentSnapshot): Reservation => {
      const data = doc.data() as IReservationData;
      return new Reservation({
        ...data,
        id: doc.id
      });
    });
  } catch (error) {
    logger.error("[ReservationRepository] Error in findByDateRange:", error);
    throw error;
  }
}

async function createReservation(data: IReservationData): Promise<Reservation> {
  try {
    if (!data.id) {
      throw new Error("Document ID is required for creating a reservation");
    }

    const docRef = db.collection(RESERVATIONS_COLLECTION).doc(data.id);
    const docData = {
      ...data,
      createdAt: data.createdAt || Timestamp.now(),
      updatedAt: data.updatedAt || Timestamp.now()
    };

    await docRef.set(docData);
    
    return new Reservation(docData);
  } catch (error) {
    logger.error("[ReservationRepository] Error in createReservation:", error);
    throw error;
  }
}

export {
  findById,
  findByDateRange,
  createReservation
}; 