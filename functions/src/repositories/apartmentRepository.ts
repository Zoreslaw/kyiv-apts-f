import { getFirestore, Firestore, DocumentReference, DocumentData, QuerySnapshot } from "firebase-admin/firestore";
import { Apartment, IApartmentData } from "../models/Apartment";

const db: Firestore = getFirestore();
const APARTMENTS_COLLECTION = "apartments";

function dataToApartment(data: DocumentData, id: string): Apartment {
    return new Apartment({ ...(data as IApartmentData), id });
}

export async function findApartmentById(apartmentId: string): Promise<Apartment | null> {
    const docRef: DocumentReference = db.collection(APARTMENTS_COLLECTION).doc(apartmentId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
        return null;
    }
    return dataToApartment(snapshot.data()!, snapshot.id);
}

export async function findAllApartments(): Promise<Apartment[]> {
    const snapshot: QuerySnapshot = await db.collection(APARTMENTS_COLLECTION).get();
    if (snapshot.empty) {
        return [];
    }
    return snapshot.docs.map(doc => dataToApartment(doc.data(), doc.id));
}

module.exports = {
  findApartmentById,
  findAllApartments,
}; 