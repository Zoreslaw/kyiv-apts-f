import { Timestamp } from "firebase-admin/firestore";
import { findTasksByUserId, updateTask, findTasksByApartmentId } from "../repositories/taskRepository";
import { Task, ITaskData } from "../models/Task";
import { TaskStatuses, TaskTypes } from "../utils/constants";
import { logger } from "firebase-functions";
import { findOrCreateUser } from "./userService";

async function getTasksForUser(userId: string): Promise<Task[]> {
  return findTasksByUserId(userId);
}

async function updateTaskStatus(taskId: string, status: TaskStatuses, userId: string): Promise<Task | null> {
  return updateTask(taskId, { 
    status, 
    updatedAt: Timestamp.now(), 
    updatedBy: userId 
  });
}

export class TaskService {
  groupTasksByDate(tasks: Task[]): Record<string, { checkouts: Task[]; checkins: Task[] }> {
    const grouped: Record<string, { checkouts: Task[]; checkins: Task[] }> = {};
    
    tasks.forEach((task) => {
      const date = String(task.dueDate);
      if (!grouped[date]) {
        grouped[date] = { checkouts: [], checkins: [] };
      }
      
      if (task.taskType === TaskTypes.CHECK_OUT) {
        grouped[date].checkouts.push(task);
      } else if (task.taskType === TaskTypes.CHECK_IN) {
        grouped[date].checkins.push(task);
      }
    });
    
    return grouped;
  }

  formatTasksMessage(dateString: string, checkouts: Task[], checkins: Task[]): string {
    let msg = `\n\n📅 *${dateString}* 📅\n\n====================\n\n`;

    if (checkouts.length > 0) {
      msg += "🔥 *ВИЇЗДИ:* 🔥\n\n";
      msg += "⚠️ *ВАЖЛИВО:* ⚠️\n";
      msg += "Прибирання має бути завершено до 14:00\n\n";
      for (const task of checkouts) {
        msg += `🔴 *ID:* ${task.apartmentId}\n`;
        msg += `🏠 *Адреса:* ${task.address}\n`;
        msg += `👤 *Гість:* ${task.notes?.split('.')[0] || 'Unknown'}\n`;
        msg += task.checkoutTime
          ? `⏰ *Виїзд:* ${task.checkoutTime}\n`
          : "⏰ *Виїзд:* не призначено\n";
        msg += `💰 *Сума:* ${task.sumToCollect || 0}\n`;
        msg += `🔑 *Ключів:* ${task.keysCount || 1}\n`;
        msg += `📞 *Контакти:* ${task.notes?.split('.')[1] || 'Unknown'}\n\n`;
      }
    }

    if (checkins.length > 0) {
      msg += "✨ *ЗАЇЗДИ:* ✨\n\n";
      msg += "⚠️ *ВАЖЛИВО:* ⚠️\n";
      msg += "Квартира має бути готова до заїзду\n\n";
      for (const task of checkins) {
        msg += `🟢 *ID:* ${task.apartmentId}\n`;
        msg += `🏠 *Адреса:* ${task.address}\n`;
        msg += `👤 *Гість:* ${task.notes?.split('.')[0] || 'Unknown'}\n`;
        msg += task.checkinTime
          ? `⏰ *Заїзд:* ${task.checkinTime}\n`
          : "⏰ *Заїзд:* не призначено\n";
        msg += `💰 *Сума:* ${task.sumToCollect || 0}\n`;
        msg += `🔑 *Ключів:* ${task.keysCount || 1}\n`;
        msg += `📞 *Контакти:* ${task.notes?.split('.')[1] || 'Unknown'}\n\n`;
      }
    }

    return msg;
  }

  async getTasksForUser(chatId: string | number): Promise<{ success: boolean; message?: string; tasks?: Task[] }> {
    try {
      const chatIdStr = String(chatId);
      logger.info(`[TaskService] Starting getTasksForUser for chatId=${chatIdStr}`);

      logger.info(`[TaskService] Found user with id=${chatIdStr}, type=${typeof chatId}`);
      const tasks = await findTasksByUserId(chatIdStr);
      logger.info(`[TaskService] Found ${tasks.length} tasks for user ${chatIdStr}`);

      if (tasks.length === 0) {
        logger.info(`[TaskService] No tasks found for user ${chatIdStr}`);
        return {
          success: false,
          message: "На тебе не додано жодних завдань. :("
        };
      }

      logger.info(`[TaskService] Successfully retrieved ${tasks.length} tasks for user ${chatIdStr}`);
      return {
        success: true,
        tasks
      };
    } catch (err) {
      logger.error("[TaskService] Error in getTasksForUser:", err);
      logger.error("[TaskService] Error details:", {
        chatId,
        error: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined
      });
      return {
        success: false,
        message: "Помилка при отриманні завдань. Спробуйте пізніше."
      };
    }
  }

  async getTasksByApartmentId(apartmentId: string): Promise<{ success: boolean; message?: string; tasks?: Task[] }> {
    try {
      const tasks = await findTasksByApartmentId(apartmentId);
      if (tasks.length === 0) {
        return {
          success: false,
          message: `Завдань для квартири ${apartmentId} не знайдено.`
        };
      }

      // Filter tasks to only include upcoming ones (within next 7 days)
      const today = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(today.getDate() + 7);
      
      const upcomingTasks = tasks.filter(task => {
        const taskDate = task.dueDate instanceof Date ? task.dueDate : 
                        task.dueDate instanceof Timestamp ? task.dueDate.toDate() : 
                        new Date(task.dueDate);
        return taskDate >= today && taskDate <= nextWeek;
      });

      if (upcomingTasks.length === 0) {
        return {
          success: false,
          message: `Немає майбутніх завдань для квартири ${apartmentId} на наступний тиждень.`
        };
      }

      return {
        success: true,
        tasks: upcomingTasks
      };
    } catch (err) {
      logger.error("[TaskService] Error in getTasksByApartmentId:", err);
      return {
        success: false,
        message: "Помилка при отриманні завдань. Спробуйте пізніше."
      };
    }
  }
}

export {
  getTasksForUser,
  updateTaskStatus,
}; 