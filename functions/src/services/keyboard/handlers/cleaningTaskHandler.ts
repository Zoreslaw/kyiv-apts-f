import { ActionHandler } from '../actionHandler';
import { TelegramContext } from '../keyboardManager';
import { TaskService } from '../../taskService';
import { KeyboardManager } from '../keyboardManager';
import { TaskStatus } from '../../../utils/constants';
import { Task } from '../../../models/Task';
import { logger } from 'firebase-functions';
import { createCleaningTaskDisplayKeyboard, formatCleaningTaskDetailText } from '../../../constants/keyboards';
import { Timestamp } from 'firebase-admin/firestore';

export class CleaningTaskHandler implements ActionHandler {
  private currentTask: Task | null = null;
  private currentPage: number = 1;
  private tasksPerPage: number = 5;

  constructor(
    private taskService: TaskService,
    private keyboardManager: KeyboardManager
  ) {}

  async handleAction(ctx: TelegramContext, actionData?: string): Promise<void> {
    if (!actionData) {
      await this.showMyCleaningTasks(ctx);
      return;
    }

    const [action, ...params] = actionData.split('_');
    
    switch (action) {
      case 'my':
        await this.showMyCleaningTasks(ctx);
        break;
      case 'active':
        await this.showActiveCleaningTasks(ctx);
        break;
      case 'completed':
        await this.showCompletedCleaningTasks(ctx);
        break;
      case 'page':
        const page = parseInt(params[0]);
        await this.showCleaningTaskPage(ctx, page);
        break;
      case 'edit':
        const taskId = params[0];
        await this.editCleaningTask(ctx, taskId);
        break;
      case 'complete':
        await this.completeCleaningTask(ctx);
        break;
      case 'start':
        await this.startCleaningTask(ctx);
        break;
      case 'cancel':
        await this.cancelCleaningTask(ctx);
        break;
      case 'back':
        await this.backToCleaningTasksList(ctx);
        break;
      case 'report':
        if (params[0] === 'problem') {
          await this.reportCleaningProblem(ctx);
        } else if (params[0] === 'dirty') {
          await this.reportCleaningDirty(ctx);
        }
        break;
      default:
        logger.warn(`[CleaningTaskHandler] Unknown action: ${action}`);
    }
  }

  private async showMyCleaningTasks(ctx: TelegramContext): Promise<void> {
    await this.showCleaningTasksList(ctx, 1, [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]);
  }

  private async showActiveCleaningTasks(ctx: TelegramContext): Promise<void> {
    await this.showCleaningTasksList(ctx, 1, [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]);
  }

  private async showCompletedCleaningTasks(ctx: TelegramContext): Promise<void> {
    await this.showCleaningTasksList(ctx, 1, [TaskStatus.COMPLETED]);
  }

  private async showCleaningTaskPage(ctx: TelegramContext, page: number): Promise<void> {
    await this.showCleaningTasksList(ctx, page);
  }

  private async showCleaningTasksList(
    ctx: TelegramContext,
    page: number = 1,
    statuses: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]
  ): Promise<void> {
    try {
      const result = await this.taskService.getTasksForUser(ctx.userId);
      
      if (!result.success || !result.tasks) {
        await ctx.reply(result.message || 'Помилка при отриманні завдань');
        return;
      }

      // Filter tasks by status and sort by date
      const filteredTasks = result.tasks
        .filter(task => statuses.includes(task.status))
        .sort((a, b) => {
          const dateA = a.dueDate instanceof Timestamp ? a.dueDate.toDate() : new Date(a.dueDate);
          const dateB = b.dueDate instanceof Timestamp ? b.dueDate.toDate() : new Date(b.dueDate);
          return dateA.getTime() - dateB.getTime();
        });

      const totalPages = Math.ceil(filteredTasks.length / this.tasksPerPage);
      const startIdx = (page - 1) * this.tasksPerPage;
      const endIdx = startIdx + this.tasksPerPage;
      const currentPageTasks = filteredTasks.slice(startIdx, endIdx);

      const keyboard = createCleaningTaskDisplayKeyboard({
        tasks: currentPageTasks,
        page,
        totalPages,
        status: statuses[0],
        forEditing: false
      });

      let message = '🧹 *Завдання з прибирання*\n\n';
      currentPageTasks.forEach((task, index) => {
        message += formatCleaningTaskDetailText(task);
        if (index < currentPageTasks.length - 1) {
          message += '\n-------------------\n';
        }
      });

      if (currentPageTasks.length === 0) {
        message += 'Немає активних завдань';
      }

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });

    } catch (error) {
      logger.error('[CleaningTaskHandler] Error showing tasks list:', error);
      await ctx.reply('Помилка при відображенні списку завдань');
    }
  }

  private async editCleaningTask(ctx: TelegramContext, taskId: string): Promise<void> {
    try {
      const task = await this.taskService.getTaskById(taskId);
      if (!task) {
        await ctx.reply('Завдання не знайдено');
        return;
      }

      this.currentTask = task;
      const message = formatCleaningTaskDetailText(task);
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Завершити', action: 'complete_task' },
            { text: '⏳ Почати', action: 'start_task' }
          ],
          [
            { text: '❌ Скасувати', action: 'cancel_task' },
            { text: '⚠️ Повідомити про проблему', action: 'report_problem' }
          ],
          [
            { text: '🧹 Повідомити про бруд', action: 'report_dirty' },
            { text: '⬅️ Назад', action: 'back_to_tasks' }
          ]
        ]
      };

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      logger.error('[CleaningTaskHandler] Error editing task:', error);
      await ctx.reply('Помилка при редагуванні завдання');
    }
  }

  private async completeCleaningTask(ctx: TelegramContext): Promise<void> {
    if (!this.currentTask) {
      await ctx.reply('Помилка: завдання не вибрано');
      return;
    }

    try {
      const updatedTask = await this.taskService.updateTaskStatus(
        this.currentTask.id,
        TaskStatus.COMPLETED,
        String(ctx.userId)
      );

      if (updatedTask) {
        await ctx.reply('✅ Завдання успішно завершено');
        await this.showMyCleaningTasks(ctx);
      } else {
        await ctx.reply('Помилка при завершенні завдання');
      }
    } catch (error) {
      logger.error('[CleaningTaskHandler] Error completing task:', error);
      await ctx.reply('Помилка при завершенні завдання');
    }
  }

  private async startCleaningTask(ctx: TelegramContext): Promise<void> {
    if (!this.currentTask) {
      await ctx.reply('Помилка: завдання не вибрано');
      return;
    }

    try {
      const updatedTask = await this.taskService.updateTaskStatus(
        this.currentTask.id,
        TaskStatus.IN_PROGRESS,
        String(ctx.userId)
      );

      if (updatedTask) {
        await ctx.reply('⏳ Завдання розпочато');
        await this.showMyCleaningTasks(ctx);
      } else {
        await ctx.reply('Помилка при початку завдання');
      }
    } catch (error) {
      logger.error('[CleaningTaskHandler] Error starting task:', error);
      await ctx.reply('Помилка при початку завдання');
    }
  }

  private async cancelCleaningTask(ctx: TelegramContext): Promise<void> {
    if (!this.currentTask) {
      await ctx.reply('Помилка: завдання не вибрано');
      return;
    }

    try {
      const updatedTask = await this.taskService.updateTaskStatus(
        this.currentTask.id,
        TaskStatus.CANCELLED,
        String(ctx.userId)
      );

      if (updatedTask) {
        await ctx.reply('❌ Завдання скасовано');
        await this.showMyCleaningTasks(ctx);
      } else {
        await ctx.reply('Помилка при скасуванні завдання');
      }
    } catch (error) {
      logger.error('[CleaningTaskHandler] Error canceling task:', error);
      await ctx.reply('Помилка при скасуванні завдання');
    }
  }

  private async backToCleaningTasksList(ctx: TelegramContext): Promise<void> {
    this.currentTask = null;
    await this.showMyCleaningTasks(ctx);
  }

  private async reportCleaningProblem(ctx: TelegramContext): Promise<void> {
    if (!this.currentTask) {
      await ctx.reply('Помилка: завдання не вибрано');
      return;
    }

    try {
      const updatedTask = await this.taskService.updateTaskStatus(
        this.currentTask.id,
        TaskStatus.PENDING,
        String(ctx.userId)
      );

      if (updatedTask) {
        await ctx.reply('⚠️ Проблему зареєстровано');
        await this.editCleaningTask(ctx, this.currentTask.id);
      } else {
        await ctx.reply('Помилка при реєстрації проблеми');
      }
    } catch (error) {
      logger.error('[CleaningTaskHandler] Error reporting problem:', error);
      await ctx.reply('Помилка при реєстрації проблеми');
    }
  }

  private async reportCleaningDirty(ctx: TelegramContext): Promise<void> {
    if (!this.currentTask) {
      await ctx.reply('Помилка: завдання не вибрано');
      return;
    }

    try {
      const updatedTask = await this.taskService.updateTaskStatus(
        this.currentTask.id,
        TaskStatus.PENDING,
        String(ctx.userId)
      );

      if (updatedTask) {
        await ctx.reply('🧹 Повідомлення про бруд зареєстровано');
        await this.editCleaningTask(ctx, this.currentTask.id);
      } else {
        await ctx.reply('Помилка при реєстрації повідомлення про бруд');
      }
    } catch (error) {
      logger.error('[CleaningTaskHandler] Error reporting dirty:', error);
      await ctx.reply('Помилка при реєстрації повідомлення про бруд');
    }
  }
}
