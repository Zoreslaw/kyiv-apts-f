import {getFirestore, Timestamp} from "firebase-admin/firestore";
import { findTasksByUserId, updateTask, findByApartmentId } from "../repositories/taskRepository";
import { Task, ITaskData } from "../models/Task";
import { TaskStatus, TaskTypes } from "../utils/constants";
import { logger } from "firebase-functions";
import { findOrCreateUser } from "./userService";
import { getKievDateRange, toKievDate, formatKievDate } from "../utils/dateTime";

export class TaskService {
  async getTasksForUser(chatId: string | number): Promise<{ success: boolean; message?: string; tasks?: Task[] }> {
    try {
      const chatIdStr = String(chatId);
      logger.info(`[TaskService] Starting getTasksForUser for chatId=${chatIdStr}`);

      const user = await findOrCreateUser({ id: chatIdStr, first_name: "", username: "" });
      if (!user || !user.assignedApartmentIds || user.assignedApartmentIds.length === 0) {
        logger.warn(`[TaskService] User ${chatIdStr} has no assigned apartments.`);
        return {
          success: false,
          message: "На тебе не додано жодних квартир. Звернись до адміністратора.",
        };
      }

      logger.info(`[TaskService] User ${chatIdStr} has ${user.assignedApartmentIds.length} assigned apartments: ${user.assignedApartmentIds.join(", ")}`);

      let allTasks: Task[] = [];

      for (const aptId of user.assignedApartmentIds) {
        const foundTasks = await findByApartmentId(aptId);
        logger.info(`[TaskService] Found ${foundTasks.length} tasks for apartment ${aptId}`);
        allTasks.push(...foundTasks);
      }

      logger.info(`[TaskService] Total tasks collected for user ${chatIdStr}: ${allTasks.length}`);

      if (allTasks.length === 0) {
        return {
          success: false,
          message: "Немає запланованих завдань на найближчий час.",
        };
      }

      return {
        success: true,
        tasks: allTasks,
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

  async updateTaskStatus(taskId: string, status: TaskStatus, userId: string): Promise<Task | null> {
    return updateTask(taskId, { 
      status, 
      updatedAt: Timestamp.now(), 
      updatedBy: userId 
    });
  }

  async updateTaskTime(taskId: string, time: string, userId: string): Promise<Task | null> {
    const task = await this.getTaskById(taskId);
    if (!task) return null;

    return updateTask(taskId, {
      [task.type === TaskTypes.CHECKIN ? 'checkinTime' : 'checkoutTime']: time,
      updatedAt: Timestamp.now(),
      updatedBy: userId
    });
  }

  async updateTaskKeys(taskId: string, keysCount: number, userId: string): Promise<Task | null> {
    return updateTask(taskId, {
      keysCount,
      updatedAt: Timestamp.now(),
      updatedBy: userId
    });
  }

  async updateTaskMoney(taskId: string, sumToCollect: number, userId: string): Promise<Task | null> {
    return updateTask(taskId, {
      sumToCollect,
      updatedAt: Timestamp.now(),
      updatedBy: userId
    });
  }

  async getTaskById(taskId: string): Promise<Task | null> {
    const tasks = await findByApartmentId(taskId);
    return tasks.length > 0 ? tasks[0] : null;
  }

  groupTasksByDate(tasks: Task[]): Record<string, { checkouts: Task[]; checkins: Task[] }> {
    const grouped: Record<string, { checkouts: Task[]; checkins: Task[] }> = {};
    
    tasks.forEach((task) => {
      // Convert Timestamp to YYYY-MM-DD string format using our utility
      const date = formatKievDate(task.dueDate, "YYYY-MM-DD");

      if (!grouped[date]) {
        grouped[date] = { checkouts: [], checkins: [] };
      }
      
      if (task.type === TaskTypes.CHECKOUT) {
        grouped[date].checkouts.push(task);
      } else if (task.type === TaskTypes.CHECKIN) {
        grouped[date].checkins.push(task);
      }
    });
    
    return grouped;
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
} 