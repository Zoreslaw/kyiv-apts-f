import { Timestamp } from "firebase-admin/firestore";
import { findTasksByUserId, updateTask, findByApartmentId } from "../repositories/taskRepository";
import { Task, ITaskData } from "../models/Task";
import { TaskStatuses, TaskTypes } from "../utils/constants";
import { logger } from "firebase-functions";
import { findOrCreateUser } from "./userService";
import { getKievDateRange, toKievDate, formatKievDate } from "../utils/dateTime";

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
      // Convert Timestamp to YYYY-MM-DD string format using our utility
      const date = formatKievDate(task.dueDate, "YYYY-MM-DD");

      if (!grouped[date]) {
        grouped[date] = { checkouts: [], checkins: [] };
      }
      
      if (task.type === TaskTypes.CHECK_OUT) {
        grouped[date].checkouts.push(task);
      } else if (task.type === TaskTypes.CHECK_IN) {
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
        msg += `👤 *Гість:* ${task.guestName || 'Unknown'}\n`;
        msg += task.checkoutTime
          ? `⏰ *Виїзд:* ${task.checkoutTime}\n`
          : "⏰ *Виїзд:* не призначено\n";
        msg += `💰 *Сума:* ${task.sumToCollect || 0}\n`;
        msg += `🔑 *Ключів:* ${task.keysCount || 1}\n`;
        msg += `📞 *Контакти:* ${task.guestPhone || 'Unknown'}\n\n`;
      }
    }

    if (checkins.length > 0) {
      msg += "✨ *ЗАЇЗДИ:* ✨\n\n";
      msg += "⚠️ *ВАЖЛИВО:* ⚠️\n";
      msg += "Квартира має бути готова до заїзду\n\n";
      for (const task of checkins) {
        msg += `🟢 *ID:* ${task.apartmentId}\n`;
        msg += `🏠 *Адреса:* ${task.address}\n`;
        msg += `👤 *Гість:* ${task.guestName || 'Unknown'}\n`;
        msg += task.checkinTime
          ? `⏰ *Заїзд:* ${task.checkinTime}\n`
          : "⏰ *Заїзд:* не призначено\n";
        msg += `💰 *Сума:* ${task.sumToCollect || 0}\n`;
        msg += `🔑 *Ключів:* ${task.keysCount || 1}\n`;
        msg += `📞 *Контакти:* ${task.guestPhone || 'Unknown'}\n\n`;
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

      // Use getKievDateRange for date filtering
      const { start, end } = getKievDateRange(0, 7);
      
      const upcomingTasks = tasks.filter((task: Task) => {
        const taskDate = task.dueDate instanceof Timestamp ? 
          task.dueDate : 
          task.dueDate instanceof Date ? 
            Timestamp.fromDate(task.dueDate) : 
            Timestamp.fromDate(new Date(task.dueDate));
        return taskDate >= start && taskDate <= end;
      });

      logger.info(`[TaskService] Filtered to ${upcomingTasks.length} upcoming tasks`);

      if (upcomingTasks.length === 0) {
        logger.info(`[TaskService] No upcoming tasks found for user ${chatIdStr}`);
        return {
          success: false,
          message: "На тебе не додано жодних завдань на найближчі дні. :("
        };
      }

      logger.info(`[TaskService] Successfully retrieved ${upcomingTasks.length} tasks for user ${chatIdStr}`);
      return {
        success: true,
        tasks: upcomingTasks
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
      const tasks = await findByApartmentId(apartmentId);
      if (tasks.length === 0) {
        return {
          success: false,
          message: `Завдань для квартири ${apartmentId} не знайдено.`
        };
      }

      // Use getKievDateRange for date filtering
      const { start, end } = getKievDateRange(0, 7);
      
      const upcomingTasks = tasks.filter((task: Task) => {
        const taskDate = task.dueDate instanceof Timestamp ? 
          task.dueDate : 
          task.dueDate instanceof Date ? 
            Timestamp.fromDate(task.dueDate) : 
            Timestamp.fromDate(new Date(task.dueDate));
        return taskDate >= start && taskDate <= end;
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