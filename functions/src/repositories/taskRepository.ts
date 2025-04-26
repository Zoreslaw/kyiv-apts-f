import { Firestore, DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { ITaskData, Task } from "../models/Task";
import { db } from "../config/firebase";
import { logger } from "firebase-functions";
import { getKievDateRange, getTimestamp } from "../utils/dateTime";
import { TaskTypes } from "../utils/constants";
import { Timestamp } from "firebase-admin/firestore";
import { findByTelegramId } from "./userRepository";
import { UserRoles } from "../utils/constants";
import { toKievDate } from "../utils/dateTime";

const TASKS_COLLECTION = "tasks";

async function findTasksByUserId(userId: string): Promise<Task[]> {
  logger.info(`Finding tasks for user ${userId}`);
  
  const user = await findByTelegramId(userId);
  if (!user) {
    logger.warn(`User ${userId} not found`);
    return [];
  }

  const { start: startTimestamp, end: endTimestamp } = getKievDateRange(0, 7);
  logger.info(`Searching for tasks between ${startTimestamp.toDate()} and ${endTimestamp.toDate()}`);

  const assignedApartmentIds = user.assignedApartmentIds || [];
  logger.info(`User ${userId} has ${assignedApartmentIds.length} assigned apartments: ${assignedApartmentIds.join(', ')}`);

  let snap;
  if (user.role === UserRoles.ADMIN) {
    // For admins, get all tasks without filtering by apartment
    logger.info(`User ${userId} is admin, fetching all tasks`);
    snap = await db
      .collection(TASKS_COLLECTION)
      .where("dueDate", ">=", startTimestamp)
      .where("dueDate", "<=", endTimestamp)
      .get();
  } else {
    // For regular users, only get tasks for their assigned apartments
    snap = await db
      .collection(TASKS_COLLECTION)
      .where("apartmentId", "in", assignedApartmentIds)
      .where("dueDate", ">=", startTimestamp)
      .where("dueDate", "<=", endTimestamp)
      .get();
  }

  logger.info(`Found ${snap.size} total tasks`);

  const tasks = snap.docs.map(doc => {
    const data = doc.data();
    let dueDate: Timestamp;
    
    // Handle different dueDate formats
    if (data.dueDate instanceof Timestamp) {
      dueDate = data.dueDate;
    } else if (data.dueDate instanceof Date) {
      dueDate = Timestamp.fromDate(data.dueDate);
    } else if (typeof data.dueDate === 'string') {
      dueDate = Timestamp.fromDate(new Date(data.dueDate));
    } else {
      dueDate = getTimestamp(); // Fallback to current time if invalid
      logger.warn(`Invalid dueDate format for task ${doc.id}: ${data.dueDate}`);
    }

    return new Task({
      id: doc.id,
      ...data,
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt : getTimestamp(),
      updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : getTimestamp(),
      dueDate: dueDate,
      reservationId: data.reservationId || '',
      apartmentId: data.apartmentId || '',
      address: data.address || '',
      type: data.type || '',
      status: data.status || 'pending'
    } as ITaskData);
  });

  logger.info(`Returning ${tasks.length} tasks for user ${userId}`);
  return tasks;
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

    // Get user's role
    const user = await findByTelegramId(userId);
    if (!user) {
      return {
        success: false,
        message: "Користувача не знайдено.",
      };
    }

    // Check if user has permission to modify this task
    const taskData = doc.data();
    const assignedApartments = user.assignedApartmentIds || [];

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

async function updateTask(taskId: string, data: Partial<ITaskData>): Promise<Task> {
  try {
    const docRef = db.collection(TASKS_COLLECTION).doc(taskId);
    const docData = {
      ...data,
      updatedAt: Timestamp.now()
    };

    await docRef.update(docData);
    
    // Fetch the updated task
    const updatedTask = await findById(taskId);
    if (!updatedTask) {
      throw new Error(`Task with ID ${taskId} not found after update`);
    }
    
    return updatedTask;
  } catch (error) {
    logger.error("[TaskRepository] Error in updateTask:", error);
    throw error;
  }
}

async function findTasksByReservationAndType(reservationId: string, taskType: TaskTypes): Promise<Task[]> {
    const snapshot = await db
        .collection(TASKS_COLLECTION)
        .where('reservationId', '==', reservationId)
        .where('type', '==', taskType)
        .get();

    return snapshot.docs.map(doc => new Task({
        id: doc.id,
        ...doc.data()
    } as ITaskData));
}

async function deleteTask(taskId: string): Promise<void> {
    await db.collection(TASKS_COLLECTION).doc(taskId).delete();
}

async function findById(taskId: string): Promise<Task | null> {
  try {
    const docRef = db.collection(TASKS_COLLECTION).doc(taskId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return null;
    }
    const data = snapshot.data() as ITaskData;
    return new Task({
      ...data,
      id: snapshot.id
    });
  } catch (error) {
    logger.error("[TaskRepository] Error in findById:", error);
    throw error;
  }
}

async function findByReservationId(reservationId: string): Promise<Task[]> {
  try {
    const snapshot = await db.collection(TASKS_COLLECTION)
      .where("reservationId", "==", reservationId)
      .get();
    if (snapshot.empty) {
      return [];
    }
    return snapshot.docs.map((doc: QueryDocumentSnapshot): Task => {
      const data = doc.data() as ITaskData;
      return new Task({
        ...data,
        id: doc.id
      });
    });
  } catch (error) {
    logger.error("[TaskRepository] Error in findByReservationId:", error);
    throw error;
  }
}

async function findByApartmentId(apartmentId: string): Promise<Task[]> {
  try {
    const snapshot = await db.collection(TASKS_COLLECTION)
      .where("apartmentId", "==", apartmentId)
      .get();
    if (snapshot.empty) {
      return [];
    }
    return snapshot.docs.map((doc: QueryDocumentSnapshot): Task => {
      const data = doc.data() as ITaskData;
      return new Task({
        ...data,
        id: doc.id
      });
    });
  } catch (error) {
    logger.error("[TaskRepository] Error in findByApartmentId:", error);
    throw error;
  }
}

async function createTask(data: Omit<ITaskData, 'id'>): Promise<Task> {
  try {
    // Generate a deterministic ID based on reservationId and type
    const taskId = `${data.reservationId}_${data.type}`;
    const docRef = db.collection(TASKS_COLLECTION).doc(taskId);
    
    const now = getTimestamp();
    
    // Ensure dueDate is a Timestamp
    let dueDate: Timestamp;
    if (data.dueDate instanceof Timestamp) {
      dueDate = data.dueDate;
    } else if (data.dueDate instanceof Date) {
      dueDate = Timestamp.fromDate(data.dueDate);
    } else if (typeof data.dueDate === 'string') {
      dueDate = Timestamp.fromDate(new Date(data.dueDate));
    } else {
      dueDate = now;
      logger.warn(`Invalid dueDate format for new task ${taskId}: ${data.dueDate}, using current time`);
    }

    const taskData = {
      ...data,
      id: taskId,
      dueDate: dueDate,
      createdAt: now,
      updatedAt: now
    };

    await docRef.set(taskData);
    logger.info(`Created task ${taskId} for reservation ${data.reservationId} with dueDate ${dueDate.toDate()}`);
    
    return new Task(taskData);
  } catch (error) {
    logger.error(`Error creating task:`, error);
    throw error;
  }
}

async function getTasksById(taskId: string): Promise<{ success: boolean; message?: string; tasks?: Task[] }> {
  try {
    logger.info(`[TaskRepository] Getting task by ID: ${taskId}`);
    
    // First try to find by exact task ID
    const task = await findById(taskId);
    if (task) {
      logger.info(`[TaskRepository] Found task by exact ID: ${taskId}`);
      return {
        success: true,
        tasks: [task]
      };
    }

    // If not found by exact ID, try to find by apartment ID
    const tasks = await findByApartmentId(taskId);
    if (tasks.length > 0) {
      logger.info(`[TaskRepository] Found ${tasks.length} tasks for apartment ID: ${taskId}`);
      
      // Filter tasks by date range (next 7 days)
      const { start: startTimestamp, end: endTimestamp } = getKievDateRange(0, 7);
      const filteredTasks = tasks.filter(task => {
        const taskDate = task.dueDate instanceof Timestamp ? 
          task.dueDate : 
          task.dueDate instanceof Date ? 
            Timestamp.fromDate(task.dueDate) : 
            Timestamp.fromDate(new Date(task.dueDate));
        return taskDate >= startTimestamp && taskDate <= endTimestamp;
      });

      if (filteredTasks.length === 0) {
        return {
          success: false,
          message: `Немає майбутніх завдань для квартири ${taskId} на наступний тиждень.`
        };
      }

      logger.info(`[TaskRepository] Found ${filteredTasks.length} tasks in date range for apartment ID: ${taskId}`);
      return {
        success: true,
        tasks: filteredTasks
      };
    }

    // No tasks found
    logger.warn(`[TaskRepository] No tasks found for ID: ${taskId}`);
    return {
      success: false,
      message: `Завдань з ID ${taskId} не знайдено.`
    };
  } catch (error) {
    logger.error("[TaskRepository] Error in getTasksById:", error);
    return {
      success: false,
      message: "Помилка при отриманні завдань. Спробуйте пізніше."
    };
  }
}

/**
 * Find tasks for a specific date filtered by task type
 */
async function getTasksForDate(date: Date, taskType: TaskTypes): Promise<Task[]> {
  try {
    // Convert the date to start and end of day in Kiev timezone
    const kievDate = toKievDate(date);
    const startOfDay = kievDate.startOf('day').toDate();
    const endOfDay = kievDate.endOf('day').toDate();

    const startTimestamp = Timestamp.fromDate(startOfDay);
    const endTimestamp = Timestamp.fromDate(endOfDay);

    logger.info(`[TaskRepository] Getting ${taskType} tasks for date ${date.toDateString()} (Kiev time)`);
    logger.info(`[TaskRepository] Date range: ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);
    
    // Query Firestore for tasks matching the date range and task type
    const snapshot = await db
      .collection(TASKS_COLLECTION)
      .where("dueDate", ">=", startTimestamp)
      .where("dueDate", "<=", endTimestamp)
      .where("type", "==", taskType)
      .get();
    
    logger.info(`[TaskRepository] Found ${snapshot.size} ${taskType} tasks for ${date.toDateString()}`);
    
    // Convert to Task objects
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return new Task({
        id: doc.id,
        ...data,
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt : getTimestamp(),
        updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : getTimestamp(),
        dueDate: data.dueDate instanceof Timestamp ? data.dueDate : getTimestamp()
      } as ITaskData);
    });
  } catch (error) {
    logger.error(`[TaskRepository] Error getting ${taskType} tasks for date ${date.toDateString()}:`, error);
    return [];
  }
}

export {
  findTasksByUserId,
  updateTask,
  createTask,
  findById,
  updateTaskInfo,
  findTasksByReservationAndType,
  deleteTask,
  findByReservationId,
  findByApartmentId,
  getTasksById,
  getTasksForDate
}; 