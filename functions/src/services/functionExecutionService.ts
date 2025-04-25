import { logger } from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { updateTask } from "../repositories/taskRepository";
import { findByTelegramId as findUserById, findByUsernameOrName } from "../repositories/userRepository";
import { findByUserId as findAssignmentByUserId, createAssignment, updateAssignment } from "../repositories/cleaningAssignmentRepository";
import { TaskService } from "./taskService";
import { TaskTimeUpdate, TaskInfoUpdate, ApartmentAssignment, UserApartmentsQuery } from './aiService';

export class FunctionExecutionService {
  private taskService: TaskService;

  constructor() {
    this.taskService = new TaskService();
  }

  async executeFunction(functionName: string, args: any): Promise<{ success: boolean; message: string }> {
    try {
      logger.info('[Function] Executing function:', {
        functionName,
        args
      });

      switch (functionName) {
        case 'update_task_time': {
          const { taskId, newTime, changeType, userId } = args as TaskTimeUpdate;
          logger.info('[Function] Updating task time:', {
            taskId,
            newTime,
            changeType,
            userId
          });
          return await this.handleUpdateTaskTime(taskId, newTime, changeType, userId);
        }
        case 'update_task_info': {
          const { taskId, newSumToCollect, newKeysCount, userId } = args as TaskInfoUpdate;
          logger.info('[Function] Updating task info:', {
            taskId,
            newSumToCollect,
            newKeysCount,
            userId
          });
          return await this.handleUpdateTaskInfo(taskId, newSumToCollect, newKeysCount, userId);
        }
        case 'assign_apartments': {
          const { targetUserId, action, apartmentIds, isAdmin } = args as ApartmentAssignment;
          logger.info('[Function] Assigning apartments:', {
            targetUserId,
            action,
            apartmentIds,
            isAdmin
          });
          return await this.handleManageApartmentAssignments(targetUserId, action, apartmentIds, isAdmin);
        }
        case 'get_user_apartments': {
          const { targetUserId, isAdmin } = args as UserApartmentsQuery;
          logger.info('[Function] Getting user apartments:', {
            targetUserId,
            isAdmin
          });
          return await this.handleShowUserApartments(targetUserId, isAdmin);
        }
        default: {
          logger.warn('[Function] Unknown function call:', {
            functionName,
            args
          });
          return {
            success: false,
            message: `Невідома функція: ${functionName}`
          };
        }
      }
    } catch (error) {
      logger.error('[Function] Error executing function:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        functionName,
        args
      });
      return {
        success: false,
        message: 'Помилка при виконанні функції. Спробуйте пізніше.'
      };
    }
  }

  private async handleUpdateTaskTime(
    taskId: string,
    newTime: string,
    changeType: 'checkin' | 'checkout',
    userId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Validate time format (HH:00)
      if (!/^([0-9]|0[0-9]|1[0-9]|2[0-3]):00$/.test(newTime)) {
        return {
          success: false,
          message: `Недійсний формат часу: ${newTime}. Використовуйте формат "ГГ:00".`
        };
      }

      const updateObj = {
        [changeType === 'checkin' ? 'checkinTime' : 'checkoutTime']: newTime,
        updatedAt: Timestamp.now(),
        updatedBy: userId
      };

      await updateTask(taskId, updateObj);
      return {
        success: true,
        message: `Час ${changeType === 'checkin' ? 'заїзду' : 'виїзду'} оновлено на ${newTime}.`
      };
    } catch (error) {
      logger.error('[Function] Error updating task time:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        taskId,
        newTime,
        changeType,
        userId
      });
      return {
        success: false,
        message: 'Помилка при оновленні часу завдання.'
      };
    }
  }

  private async handleUpdateTaskInfo(
    taskId: string,
    newSumToCollect: number | null | undefined,
    newKeysCount: number | null | undefined,
    userId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const updateObj: any = {
        updatedAt: Timestamp.now(),
        updatedBy: userId
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
          message: 'Не вказано ні суму, ні кількість ключів для оновлення.'
        };
      }

      await updateTask(taskId, updateObj);

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
        message
      };
    } catch (error) {
      logger.error('[Function] Error updating task info:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        taskId,
        newSumToCollect,
        newKeysCount,
        userId
      });
      return {
        success: false,
        message: 'Помилка при оновленні інформації завдання.'
      };
    }
  }

  private async handleManageApartmentAssignments(
    targetUsername: string,
    action: 'add' | 'remove',
    apartmentIds: string[],
    isAdmin: boolean
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!isAdmin) {
        return {
          success: false,
          message: 'У вас немає прав для виконання цієї операції.'
        };
      }

      const user = await findByUsernameOrName(targetUsername);
      if (!user || !user.id) {
        return {
          success: false,
          message: 'Користувача не знайдено або ID користувача відсутній.'
        };
      }

      const assignment = await findAssignmentByUserId(user.id);
      if (!assignment) {
        await createAssignment({
          userId: user.id,
          apartmentIds,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
        return {
          success: true,
          message: `Квартири ${apartmentIds.join(', ')} успішно призначені користувачу.`
        };
      }

      const updatedApartmentIds = action === 'add'
        ? [...new Set([...assignment.apartmentIds, ...apartmentIds])]
        : assignment.apartmentIds.filter(id => !apartmentIds.includes(id));

      await updateAssignment(assignment.id, {
        apartmentIds: updatedApartmentIds,
        updatedAt: Timestamp.now()
      });
      return {
        success: true,
        message: `Список квартир користувача успішно оновлено.`
      };
    } catch (error) {
      logger.error('[Function] Error managing apartment assignments:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        targetUsername,
        action,
        apartmentIds
      });
      return {
        success: false,
        message: 'Помилка при оновленні призначених квартир.'
      };
    }
  }

  private async handleShowUserApartments(
    targetUsername: string,
    isAdmin: boolean
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!isAdmin) {
        return {
          success: false,
          message: 'У вас немає прав для перегляду квартир цього користувача.'
        };
      }

      const user = await findByUsernameOrName(targetUsername);
      if (!user || !user.id) {
        return {
          success: false,
          message: 'Користувача не знайдено або ID користувача відсутній.'
        };
      }

      const assignment = await findAssignmentByUserId(user.id);
      if (!assignment) {
        return {
          success: false,
          message: 'Користувач не має призначених квартир.'
        };
      }

      if (!isAdmin && user.id !== assignment.userId) {
        return {
          success: false,
          message: 'У вас немає прав для перегляду квартир цього користувача.'
        };
      }

      return {
        success: true,
        message: `Призначені квартири: ${assignment.apartmentIds.join(', ')}`
      };
    } catch (error) {
      logger.error('[Function] Error showing user apartments:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        targetUsername
      });
      return {
        success: false,
        message: 'Помилка при отриманні списку квартир.'
      };
    }
  }
} 