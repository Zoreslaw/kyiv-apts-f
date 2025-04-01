import { getFirestore } from "firebase-admin/firestore";
import { CleaningAssignment } from "../models/CleaningAssignment";

const db = getFirestore();

export async function findByUserId(userId: string): Promise<CleaningAssignment | null> {
  const snapshot = await db
    .collection("cleaningAssignments")
    .where("userId", "==", userId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  return {
    id: doc.id,
    ...doc.data(),
  } as CleaningAssignment;
}

export async function createAssignment(data: Omit<CleaningAssignment, "id">): Promise<CleaningAssignment> {
  const docRef = await db.collection("cleaningAssignments").add(data);
  return {
    id: docRef.id,
    ...data,
  };
}

export async function updateAssignment(
  id: string,
  data: Partial<Omit<CleaningAssignment, "id">>
): Promise<void> {
  await db.collection("cleaningAssignments").doc(id).update(data);
} 