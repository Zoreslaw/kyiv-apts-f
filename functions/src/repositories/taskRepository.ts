import { Firestore, DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { ITaskData, Task } from "../models/Task";
import { db } from "../config/firebase";
import { logger } from "firebase-functions";
import { getKievDate } from "../utils/dateTime";
import { findByUserId } from "./cleaningAssignmentRepository";
import { TaskTypes } from "../utils/constants";
import { Timestamp } from "firebase-admin/firestore";
import { findByTelegramId } from "./userRepository";
import { UserRoles } from "../utils/constants";

const TASKS_COLLECTION = "tasks";

async function findTasksByUserId(userId: string | number, isAdmin: boolean = false): Promise<Task[]> {
  try {
    const userIdStr = String(userId);
    const today = getKievDate(0);
    const maxDate = getKievDate(7);

    // Get user's assigned apartments if not admin
    let assignedApartments: string[] = [];
    
    if (!isAdmin) {
      const assignment = await findByUserId(userIdStr);
      if (assignment) {
        assignedApartments = assignment.apartmentIds || [];
      }
    }

    logger.info(`[TaskRepository] Assigned apartments: ${assignedApartments}`);

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
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        } as ITaskData));
      }
    });

    return tasks;
  } catch (error) {
    logger.error(`[TaskRepository] Error in findTasksByUserId:`, error);
    throw error;
  }
}

export async function updateTaskTime(
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
      updatedAt: Timestamp.now(),
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

    // Check if user has permission to modify this task
    const taskData = doc.data();
    const userAssignment = await findByUserId(userId);
    const assignedApartments = userAssignment?.apartmentIds || [];

    // Get user's role
    const user = await findByTelegramId(userId);
    if (!user) {
      return {
        success: false,
        message: "Користувача не знайдено.",
      };
    }

    // Check if user is admin or has the apartment assigned
    const isAdmin = user.role === UserRoles.ADMIN;
    const hasApartmentAssigned = assignedApartments.includes(String(taskData?.apartmentId));

    if (!isAdmin && !hasApartmentAssigned) {
      return {
        success: false,
        message: "Вибачте, але у вас немає права модифікувати це завдання. Ця функція доступна лише для адміністраторів або призначених користувачів.",
      };
    }

    const updateObj: any = {
      updatedAt: Timestamp.now(),
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

async function findTasksByReservationAndType(reservationId: string, taskType: TaskTypes): Promise<Task[]> {
    const snapshot = await db
        .collection(TASKS_COLLECTION)
        .where('reservationId', '==', reservationId)
        .where('taskType', '==', taskType)
        .get();

    return snapshot.docs.map(doc => new Task({
        id: doc.id,
        ...doc.data()
    } as ITaskData));
}

async function deleteTask(taskId: string): Promise<void> {
    await db.collection(TASKS_COLLECTION).doc(taskId).delete();
}

async function createTask(taskData: Omit<ITaskData, 'id'>): Promise<Task> {
    try {
        // Check for existing tasks with same reservation and type
        const existingTasks = await findTasksByReservationAndType(
            taskData.reservationId,
            taskData.taskType
        );

        // If duplicates exist, keep the first one and delete others
        if (existingTasks.length > 0) {
            logger.info(`Found ${existingTasks.length} existing tasks for reservation ${taskData.reservationId} and type ${taskData.taskType}`);
            
            // Keep the first task and delete others
            const tasksToDelete = existingTasks.slice(1);
            for (const task of tasksToDelete) {
                logger.info(`Deleting duplicate task: ${task.id}`);
                await deleteTask(task.id);
            }

            // Update the remaining task with new data
            const remainingTask = existingTasks[0];
            logger.info(`Updating remaining task: ${remainingTask.id}`);
            const updatedTask = await updateTask(remainingTask.id, {
                ...taskData,
                id: remainingTask.id
            });
            
            if (!updatedTask) {
                throw new Error(`Failed to update task ${remainingTask.id}`);
            }
            
            return updatedTask;
        }

        // If no duplicates, create new task
        const docRef = await db.collection(TASKS_COLLECTION).add(taskData);
        const snapshot = await docRef.get();
        const data = snapshot.data() as DocumentData;
        
        return new Task({
            id: snapshot.id,
            ...taskData,
        });
    } catch (error) {
        logger.error('Error in createTask:', error);
        throw error;
    }
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

async function findTasksByApartmentId(apartmentId: string): Promise<Task[]> {
    const snapshot = await db
        .collection(TASKS_COLLECTION)
        .where('apartmentId', '==', apartmentId)
        .get();

    return snapshot.docs.map(doc => new Task({
        id: doc.id,
        ...doc.data()
    } as ITaskData));
}

export {
  findTasksByUserId,
  updateTask,
  createTask,
  findById,
  updateTaskInfo,
  findTasksByReservationAndType,
  deleteTask,
  findTasksByApartmentId
}; 