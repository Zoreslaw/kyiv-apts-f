import { Firestore, DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { ITaskData, Task } from "../models/Task";
import { db } from "../config/firebase";
import { logger } from "firebase-functions";
import { getKievDate } from "../utils/dateTime";
import { findByUserId } from "./cleaningAssignmentRepository";

const TASKS_COLLECTION = "tasks";

async function findTasksByUserId(userId: string, isAdmin: boolean = false): Promise<Task[]> {
  try {
    const today = getKievDate(0);
    const maxDate = getKievDate(7);

    // Get user's assigned apartments if not admin
    let assignedApartments: string[] = [];
    // if (!isAdmin) {
    //   const userSnap = await db.collection('users').doc(userId).get();
    //   if (userSnap.exists) {
    //     const userData = userSnap.data();
    //     assignedApartments = userData?.apartmentIds || [];
    //   }
    // }
    
    if (!isAdmin) {
      await findByUserId(userId).then((assignment) => {
        if (assignment) {
          assignedApartments = assignment.apartmentIds;
        }
      });
    }

    const taskSnap = await db
      .collection(TASKS_COLLECTION)
      .where('dueDate', '>=', today)
      .where('dueDate', '<=', maxDate)
      .orderBy('dueDate')
      .get();

    const tasks: Task[] = [];
    taskSnap.forEach((doc) => {
      const data = doc.data();
      if (isAdmin || assignedApartments.includes(String(data.apartmentId))) {
        tasks.push(new Task({
          id: doc.id,
          ...data,
          createdAt: data.createdAt.toDate(),
          updatedAt: data.updatedAt.toDate(),
        } as ITaskData));
      }
    });

    return tasks;
  } catch (error) {
    logger.error('Error in findTasksByUserId:', error);
    throw error;
  }
}

async function updateTaskTime(
  taskId: string,
  newTime: string,
  changeType: 'checkin' | 'checkout',
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const taskRef = db.collection(TASKS_COLLECTION).doc(taskId);
    const doc = await taskRef.get();

    if (!doc.exists) {
      return {
        success: false,
        message: `Завдання з ID ${taskId} не знайдено.`,
      };
    }

    // Validate time format (HH:00)
    if (!/^([0-9]|0[0-9]|1[0-9]|2[0-3]):00$/.test(newTime)) {
      return {
        success: false,
        message: `Недійсний формат часу: ${newTime}. Використовуйте формат "ГГ:00".`,
      };
    }

    const updateField = changeType === 'checkin' ? 'checkinTime' : 'checkoutTime';
    await taskRef.update({
      [updateField]: newTime,
      updatedAt: new Date(),
      updatedBy: userId,
    });

    return {
      success: true,
      message: changeType === 'checkin'
        ? `Час заїзду оновлено на ${newTime}.`
        : `Час виїзду оновлено на ${newTime}.`,
    };
  } catch (error) {
    logger.error('Error in updateTaskTime:', error);
    return {
      success: false,
      message: `Помилка при оновленні часу ${changeType === 'checkin' ? 'заїзду' : 'виїзду'}. Спробуйте пізніше.`,
    };
  }
}

async function updateTaskInfo(
  taskId: string,
  newSumToCollect: number | null,
  newKeysCount: number | null,
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const taskRef = db.collection(TASKS_COLLECTION).doc(taskId);
    const doc = await taskRef.get();

    if (!doc.exists) {
      return {
        success: false,
        message: `Завдання з ID ${taskId} не знайдено.`,
      };
    }

    const updateObj: any = {
      updatedAt: new Date(),
      updatedBy: userId,
    };

    if (newSumToCollect !== null && newSumToCollect !== undefined) {
      updateObj.sumToCollect = Number(newSumToCollect);
    }

    if (newKeysCount !== null && newKeysCount !== undefined) {
      updateObj.keysCount = Number(newKeysCount);
    }

    if (Object.keys(updateObj).length <= 2) {
      return {
        success: false,
        message: 'Не вказано ні суму, ні кількість ключів для оновлення.',
      };
    }

    await taskRef.update(updateObj);

    let message = 'Оновлено: ';
    if (newSumToCollect !== null && newSumToCollect !== undefined) {
      message += `сума до оплати - ${newSumToCollect} грн`;
      if (newKeysCount !== null && newKeysCount !== undefined) {
        message += ', ';
      }
    }

    if (newKeysCount !== null && newKeysCount !== undefined) {
      message += `кількість ключів - ${newKeysCount}`;
    }

    return {
      success: true,
      message,
    };
  } catch (error) {
    logger.error('Error in updateTaskInfo:', error);
    return {
      success: false,
      message: 'Помилка при оновленні інформації про завдання. Спробуйте пізніше.',
    };
  }
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
  updateTaskTime,
  updateTaskInfo,
}; 