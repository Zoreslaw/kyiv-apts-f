import { Timestamp } from "firebase-admin/firestore";
import { findTasksByUserId, updateTask } from "../repositories/taskRepository";
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

  async getTasksForUser(chatId: string): Promise<{ success: boolean; message?: string; tasks?: Task[] }> {
    try {
      logger.info(`[TaskService] Starting getTasksForUser for chatId=${chatId}`);

      logger.info(`[TaskService] Found user with id=${chatId}, type=${chatId}`);
      const tasks = await findTasksByUserId(chatId);
      logger.info(`[TaskService] Found ${tasks.length} tasks for user ${chatId}`);

      if (tasks.length === 0) {
        logger.info(`[TaskService] No tasks found for user ${chatId}`);
        return {
          success: false,
          message: "На тебе не додано жодних завдань. :("
        };
      }

      logger.info(`[TaskService] Successfully retrieved ${tasks.length} tasks for user ${chatId}`);
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
}

export {
  getTasksForUser,
  updateTaskStatus,
}; 