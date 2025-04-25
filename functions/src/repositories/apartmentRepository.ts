// import { getFirestore, Firestore, DocumentReference, DocumentData, QuerySnapshot, Timestamp } from "firebase-admin/firestore";
// import { Apartment, IApartmentData } from "../models/Apartment";
// import { db } from "../config/firebase";
// import { logger } from 'firebase-functions';

// const APARTMENTS_COLLECTION = "apartments";

// function dataToApartment(data: DocumentData, id: string): Apartment {
//     return new Apartment({ ...(data as IApartmentData), id });
// }

// export async function findApartmentById(apartmentId: string): Promise<Apartment | null> {
//     const docRef: DocumentReference = db.collection(APARTMENTS_COLLECTION).doc(apartmentId);
//     const snapshot = await docRef.get();
//     if (!snapshot.exists) {
//         return null;
//     }
//     return dataToApartment(snapshot.data()!, snapshot.id);
// }

// export async function findAllApartments(): Promise<Apartment[]> {
//     try {
//         const snapshot: QuerySnapshot = await db.collection(APARTMENTS_COLLECTION).get();
//         if (snapshot.empty) {
//             return [];
//         }
//         return snapshot.docs.map(doc => dataToApartment(doc.data(), doc.id));
//     } catch (error) {
//         logger.error('Error in findAllApartments:', error);
//         return [];
//     }
// }

// export async function findById(id: string): Promise<Apartment | null> {
//     try {
//         const doc = await db.collection(APARTMENTS_COLLECTION).doc(id).get();
//         if (!doc.exists) {
//             return null;
//         }
//         return dataToApartment(doc.data()!, doc.id);
//     } catch (error) {
//         logger.error(`Error in findById(${id}):`, error);
//         return null;
//     }
// }

// export async function createApartment(data: IApartmentData): Promise<Apartment> {
//     try {
//         await db.collection(APARTMENTS_COLLECTION).doc(data.id).set(data);
//         return new Apartment(data);
//     } catch (error) {
//         logger.error('Error in createApartment:', error);
//         throw error;
//     }
// }

// export async function updateApartment(id: string, data: Partial<IApartmentData>): Promise<Apartment | null> {
//     try {
//         const docRef = db.collection(APARTMENTS_COLLECTION).doc(id);
//         const doc = await docRef.get();
//         if (!doc.exists) {
//             return null;
//         }
//         await docRef.update(data);
//         const updatedDoc = await docRef.get();
//         return dataToApartment(updatedDoc.data()!, id);
//     } catch (error) {
//         logger.error(`Error in updateApartment(${id}):`, error);
//         throw error;
//     }
// }

// export async function deleteApartment(id: string): Promise<boolean> {
//     try {
//         const docRef = db.collection(APARTMENTS_COLLECTION).doc(id);
//         const doc = await docRef.get();
//         if (!doc.exists) {
//             return false;
//         }
//         await docRef.delete();
//         return true;
//     } catch (error) {
//         logger.error(`Error in deleteApartment(${id}):`, error);
//         throw error;
//     }
// }

// export async function searchByAddress(searchTerm: string): Promise<Apartment[]> {
//     try {
//         const snapshot = await db.collection(APARTMENTS_COLLECTION)
//             .where('address', '>=', searchTerm)
//             .where('address', '<=', searchTerm + '\uf8ff')
//             .get();
//         if (snapshot.empty) {
//             return [];
//         }
//         return snapshot.docs.map(doc => dataToApartment(doc.data(), doc.id));
//     } catch (error) {
//         logger.error(`Error in searchByAddress(${searchTerm}):`, error);
//         return [];
//     }
// }

// module.exports = {
//     findApartmentById,
//     findAllApartments,
//     findById,
//     createApartment,
//     updateApartment,
//     deleteApartment,
//     searchByAddress,
// }; 