import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

// Assignment models
export interface ICleaningAssignment {
  id: string;
  userId: string;
  apartmentIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ICleaningAssignmentData {
  userId: string;
  apartmentIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

const db = getFirestore();
const COLLECTION = 'cleaningAssignments';

/**
 * Find cleaning assignment by user ID
 */
export async function findByUserId(userId: string): Promise<ICleaningAssignment | null> {
  try {
    const snapshot = await db.collection(COLLECTION)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data()
    } as ICleaningAssignment;
  } catch (error) {
    logger.error('[cleaningAssignmentRepository] Error finding assignment by userId:', error);
    throw error;
  }
}

/**
 * Find all cleaning assignments
 */
export async function findAllAssignments(): Promise<ICleaningAssignment[]> {
  try {
    const snapshot = await db.collection(COLLECTION).get();
    
    if (snapshot.empty) {
      return [];
    }

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as ICleaningAssignment));
  } catch (error) {
    logger.error('[cleaningAssignmentRepository] Error finding all assignments:', error);
    throw error;
  }
}

/**
 * Create cleaning assignment
 */
export async function createAssignment(data: ICleaningAssignmentData): Promise<ICleaningAssignment> {
  try {
    const docRef = await db.collection(COLLECTION).add(data);
    const doc = await docRef.get();
    
    return {
      id: doc.id,
      ...doc.data()
    } as ICleaningAssignment;
  } catch (error) {
    logger.error('[cleaningAssignmentRepository] Error creating assignment:', error);
    throw error;
  }
}

/**
 * Update cleaning assignment
 */
export async function updateAssignment(id: string, data: Partial<ICleaningAssignmentData>): Promise<ICleaningAssignment | null> {
  try {
    const docRef = db.collection(COLLECTION).doc(id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return null;
    }
    
    await docRef.update(data);
    
    const updatedDoc = await docRef.get();
    return {
      id: updatedDoc.id,
      ...updatedDoc.data()
    } as ICleaningAssignment;
  } catch (error) {
    logger.error('[cleaningAssignmentRepository] Error updating assignment:', error);
    throw error;
  }
}

/**
 * Delete cleaning assignment
 */
export async function deleteAssignment(id: string): Promise<boolean> {
  try {
    const docRef = db.collection(COLLECTION).doc(id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return false;
    }
    
    await docRef.delete();
    return true;
  } catch (error) {
    logger.error('[cleaningAssignmentRepository] Error deleting assignment:', error);
    throw error;
  }
}

/**
 * Find assignments for an apartment
 */
export async function findByApartmentId(apartmentId: string): Promise<ICleaningAssignment[]> {
  try {
    // Firestore arrays contain query requires array-contains operator
    const snapshot = await db.collection(COLLECTION)
      .where('apartmentIds', 'array-contains', apartmentId)
      .get();
    
    if (snapshot.empty) {
      return [];
    }
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as ICleaningAssignment));
  } catch (error) {
    logger.error('[cleaningAssignmentRepository] Error finding assignments by apartmentId:', error);
    throw error;
  }
}

/**
 * Remove apartment from all assignments
 */
export async function removeApartmentFromAllAssignments(apartmentId: string): Promise<void> {
  try {
    const assignments = await findByApartmentId(apartmentId);
    
    // Process in parallel
    const promises = assignments.map(assignment => {
      const updatedApartmentIds = assignment.apartmentIds.filter(id => id !== apartmentId);
      return updateAssignment(assignment.id, {
        apartmentIds: updatedApartmentIds,
        updatedAt: Timestamp.now()
      });
    });
    
    await Promise.all(promises);
  } catch (error) {
    logger.error('[cleaningAssignmentRepository] Error removing apartment from assignments:', error);
    throw error;
  }
} 