import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { CleaningAssignment } from "../models/CleaningAssignment";
import { logger } from "firebase-functions/v2";
const CLEANING_ASSIGNMENTS_COLLECTION = "cleaningAssignments";

export async function findByUserId(userId: string | number): Promise<CleaningAssignment | null> {
  const userIdStr = String(userId);
  logger.info(`[CleaningAssignmentRepository] User ID type: ${typeof userId}, converted to string: ${userIdStr}`);

  const snapshot = await db
    .collection(CLEANING_ASSIGNMENTS_COLLECTION)
    .where("userId", "==", userIdStr)
    .limit(1)
    .get();

  logger.info(`[CleaningAssignmentRepository] Found ${snapshot.docs.length} cleaning assignments for user ${userIdStr}`);

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  const data = doc.data();
  
  // Log the raw data from Firestore with explicit type checking
  logger.info(`[CleaningAssignmentRepository] Raw Firestore data:`, {
    ...data,
    apartmentIds: data.apartmentIds ? (Array.isArray(data.apartmentIds) ? data.apartmentIds : []) : []
  });
  
  // Ensure apartmentIds exists and is an array
  const apartmentIds = Array.isArray(data.apartmentIds) ? data.apartmentIds : [];
  
  logger.info(`[CleaningAssignmentRepository] Processed cleaning assignment:`, {
    id: doc.id,
    userId: data.userId,
    apartmentIds: apartmentIds,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  });

  return new CleaningAssignment({
    id: doc.id,
    userId: data.userId,
    apartmentIds: apartmentIds,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  });
}

export async function createAssignment(data: Omit<CleaningAssignment, "id">): Promise<CleaningAssignment> {
  const docRef = await db.collection(CLEANING_ASSIGNMENTS_COLLECTION).add(data);
  return {
    id: docRef.id,
    ...data,
  };
}

export async function updateAssignment(
  id: string,
  data: Partial<Omit<CleaningAssignment, "id">>
): Promise<void> {
  await db.collection(CLEANING_ASSIGNMENTS_COLLECTION).doc(id).update(data);
} 