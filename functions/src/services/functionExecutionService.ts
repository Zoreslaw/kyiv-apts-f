import { logger } from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { updateTask, updateTaskTime } from "../repositories/taskRepository";
import { findByTelegramId as findUserById } from "../repositories/userRepository";
import { findByUserId as findAssignmentByUserId, createAssignment, updateAssignment } from "../repositories/cleaningAssignmentRepository";
import { TaskService } from "./taskService";

export class FunctionExecutionService {
  private taskService: TaskService;

  constructor(taskService: TaskService) {
    this.taskService = taskService;
  }

  async executeFunction(name: string, args: any): Promise<any> {
    try {
      switch (name) {
        case "update_task_time":
          return await this.handleUpdateTaskTime(args);
        case "update_task_info":
          return await this.handleUpdateTaskInfo(args);
        case "manage_apartment_assignments":
          return await this.handleManageApartmentAssignments(args);
        case "show_user_apartments":
          return await this.handleShowUserApartments(args);
        default:
          logger.warn(`Unknown function call: ${name}`);
          return {
            success: false,
            message: "Невідома команда, спробуйте ще раз.",
          };
      }
    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      return {
        success: false,
        message: "Сталася помилка при виконанні команди. Спробуйте пізніше.",
      };
    }
  }

  private async handleUpdateTaskTime(args: {
    taskId: string;
    newTime: string;
    changeType: "checkin" | "checkout";
    userId: string;
  }): Promise<any> {
    const { taskId, newTime, changeType, userId } = args;

    // Validate time format (HH:00)
    if (!/^([0-9]|0[0-9]|1[0-9]|2[0-3]):00$/.test(newTime)) {
      return {
        success: false,
        message: `Недійсний формат часу: ${newTime}. Використовуйте формат "ГГ:00".`,
      };
    }

    // Update the task
    return await updateTaskTime(taskId, newTime, changeType, userId);
  }

  private async handleUpdateTaskInfo(args: {
    taskId: string;
    newSumToCollect?: number | null;
    newKeysCount?: number | null;
    userId: string;
  }): Promise<any> {
    const { taskId, newSumToCollect, newKeysCount, userId } = args;

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
        message: "Не вказано ні суму, ні кількість ключів для оновлення.",
      };
    }

    await updateTask(taskId, updateObj);

    let message = "Оновлено: ";
    if (newSumToCollect !== null && newSumToCollect !== undefined) {
      message += `сума до оплати - ${newSumToCollect} грн`;
      if (newKeysCount !== null && newKeysCount !== undefined) {
        message += ", ";
      }
    }

    if (newKeysCount !== null && newKeysCount !== undefined) {
      message += `кількість ключів - ${newKeysCount}`;
    }

    return {
      success: true,
      message,
    };
  }

  private async handleManageApartmentAssignments(args: {
    targetUserId: string;
    action: "add" | "remove";
    apartmentIds: string[];
    isAdmin: boolean;
  }): Promise<any> {
    const { targetUserId, action, apartmentIds, isAdmin } = args;

    if (!isAdmin) {
      return {
        success: false,
        message: "Тільки адміністратори можуть керувати призначеннями квартир.",
      };
    }

    // Find user by ID or name
    let user = await findUserById(targetUserId);
    if (!user) {
      return {
        success: false,
        message: `Не знайшов користувача за запитом '${targetUserId}'.`,
      };
    }

    // Get current assignments
    let assignment = await findAssignmentByUserId(user.id);
    let currentApartments: string[] = [];

    if (assignment) {
      currentApartments = assignment.apartmentIds || [];
    }

    // Update assignments
    let updatedApartments: string[];
    if (action === "add") {
      updatedApartments = [...new Set([...currentApartments, ...apartmentIds])];
    } else {
      updatedApartments = currentApartments.filter(
        (id) => !apartmentIds.includes(id)
      );
    }

    if (assignment) {
      await updateAssignment(assignment.id, {
        apartmentIds: updatedApartments,
        updatedAt: Timestamp.now(),
      });
    } else {
      await createAssignment({
        userId: user.id,
        apartmentIds: updatedApartments,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    }

    const actionText = action === "add" ? "додано" : "видалено";
    const displayName = user.username || user.firstName || user.id;
    return {
      success: true,
      message: `Успішно ${actionText} квартири ${apartmentIds.join(", ")} ${
        action === "add" ? "до" : "у"
      } користувача ${displayName}.`,
    };
  }

  private async handleShowUserApartments(args: {
    targetUserId: string;
    isAdmin: boolean;
  }): Promise<any> {
    const { targetUserId, isAdmin } = args;

    if (!isAdmin) {
      return {
        success: false,
        message: "Тільки адміністратор може дивитись чужі квартири.",
      };
    }

    // Find user by ID or name
    const user = await findUserById(targetUserId);
    if (!user) {
      return {
        success: false,
        message: `Не знайшов користувача за запитом '${targetUserId}'.`,
      };
    }

    const assignment = await findAssignmentByUserId(user.id);
    if (!assignment || !assignment.apartmentIds?.length) {
      return {
        success: true,
        message: `У користувача ${user.username || user.firstName || user.id} немає призначених квартир.`,
      };
    }

    return {
      success: true,
      message: `У користувача ${user.username || user.firstName || user.id} призначені квартири: ${assignment.apartmentIds.join(", ")}`,
    };
  }
} 