import { Firestore, DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { ITaskData, Task } from "../models/Task";
import { db } from "../config/firebase";

const TASKS_COLLECTION = "tasks";

async function findTasksByUserId(userId: string): Promise<Task[]> {
  const snapshot = await db.collection(TASKS_COLLECTION)
                         .where("assignedStaffId", "==", userId)
                         .get();

  if (snapshot.empty) {
    return [];
  }
  return snapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>): Task => {
      const data = doc.data() as ITaskData;
      return new Task(data);
  });
}

async function updateTask(taskId: string, updateData: Partial<ITaskData>): Promise<Task | null> {
  const docRef = db.collection(TASKS_COLLECTION).doc(taskId);
  await docRef.update(updateData);

  const updatedDoc = await docRef.get();
  if (!updatedDoc.exists) {
      return null;
  }

  const data = updatedDoc.data() as ITaskData;
  return new Task(data);
}

async function createTask(taskData: Omit<ITaskData, 'id'>): Promise<Task> {
    const docRef = await db.collection(TASKS_COLLECTION).add(taskData);
    const snapshot = await docRef.get();
    const data = snapshot.data() as DocumentData;
    
    return new Task({
        id: snapshot.id,
        ...taskData,
    });
}

async function findById(taskId: string): Promise<Task | null> {
    const docRef = db.collection(TASKS_COLLECTION).doc(taskId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
        return null;
    }
    const data = snapshot.data() as ITaskData;
    
    return new Task(data);
}

export {
  findTasksByUserId,
  updateTask,
  createTask,
  findById,
}; 