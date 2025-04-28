import { ActionHandler } from '../actionHandler';
import { TelegramContext, KeyboardManager } from '../keyboardManager';
import { TaskService } from '../../taskService';
import axios from 'axios';
import * as admin from 'firebase-admin';
import { defineString } from "firebase-functions/params";
import {
    createInlineKeyboard,
    createTaskDisplayKeyboard,
    TaskDisplayKeyboardOptions
} from '../../../constants/keyboards';
import {logger} from "firebase-functions";
import {TaskTypes} from "../../../utils/constants";
import {setSession} from "../../sessionStore";

export class MyTasksHandler implements ActionHandler {
    constructor(
        private taskService: TaskService,
        private keyboardManager: KeyboardManager
    ) {}

    async handleAction(ctx: TelegramContext, actionData?: string): Promise<void> {
        if (!actionData) return;

        if (actionData === 'noop') {
            return;
        }

        if (actionData === 'show_tasks') {
            await this.showTaskSelectorWithSummary(ctx, 1);
            return;
        }

        if (actionData.startsWith('show_tasks_page_')) {
            const page = parseInt(actionData.replace('show_tasks_page_', ''), 10);
            if (!isNaN(page)) {
                await this.showTaskSelectorWithSummary(ctx, page);
            }
            return;
        }

        if (actionData === 'show_tasks_today') {
            const today = new Date();
            await this.showTasksForDate(ctx, today);
            return;
        }

        if (actionData === 'show_tasks_tomorrow') {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            await this.showTasksForDate(ctx, tomorrow);
            return;
        }

        if (actionData.startsWith('task_detail_')) {
            const taskId = actionData.replace('task_detail_', '');
            await this.showTaskDetails(ctx, taskId);
            return;
        }

        if (actionData.startsWith('mark_done_')) {
            const reservationId = actionData.replace('mark_done_', '');
            await this.handleMarkDone(ctx, reservationId);
            return;
        }

        if (actionData.startsWith('report_dirty_')) {
            const reservationId = actionData.replace('mark_dirty_', '');
            await this.handleMarkDirty(ctx, reservationId);
            return;
        }

        if (actionData.startsWith('report_issue_')) {
            const reservationId = actionData.replace('report_issue_', '');
            await this.handleReportProblem(ctx, reservationId);
            return;
        }
    }

    /**
     * Show user tasks
     */
    private async showTasks(ctx: TelegramContext): Promise<void> {
        try {
            logger.info(`[TaskHandler] Showing tasks for user ${ctx.userId}`);

            const result = await this.taskService.getTasksForUser(ctx.userId);

            if (!result.success || !result.tasks) {
                await ctx.reply(result.message || "Немає завдань на найближчі дні.", {
                    parse_mode: "Markdown"
                });
                return;
            }

            const grouped = this.taskService.groupTasksByDate(result.tasks);
            const allDates = Object.keys(grouped).sort();

            if (allDates.length === 0) {
                await ctx.reply("Немає завдань на найближчі дні.", {
                    parse_mode: "Markdown"
                });
                return;
            }

            // Clean up previous messages
            await this.keyboardManager.cleanupMessages(ctx);

            // Send tasks for each date
            for (const date of allDates) {
                const { checkouts, checkins } = grouped[date];

                if (!checkouts.length && !checkins.length) {
                    continue;
                }

                const [y, m, d] = date.split("-");
                const dateString = `${d}.${m}.${y}`;

                const msg = this.taskService.formatTasksMessage(dateString, checkouts, checkins);

                // Create keyboard options for this date's tasks
                const allTasks = [...checkouts, ...checkins];
                const keyboardOptions: TaskDisplayKeyboardOptions = {
                    tasks: allTasks,
                    type: allTasks[0]?.type === TaskTypes.CHECKOUT ? TaskTypes.CHECKOUT : TaskTypes.CHECKIN,
                    page: 1,
                    totalPages: 1,
                    forEditing: true
                };

                // Create keyboard buttons
                const keyboard = createTaskDisplayKeyboard(keyboardOptions);

                // Send message with inline keyboard
                const message = await ctx.reply(msg, {
                    parse_mode: "Markdown",
                    reply_markup: createInlineKeyboard({
                        id: 'tasks_list',
                        type: 'inline',
                        buttons: keyboard
                    })
                });

                // Store message ID for cleanup
                this.keyboardManager.storeMessageId(ctx.userId, message.message_id);
            }

        } catch (error) {
            logger.error(`[TaskHandler] Error showing tasks:`, error);
            await ctx.reply("Помилка при отриманні завдань. Спробуйте пізніше.", {
                parse_mode: "Markdown"
            });
        }
    }

    /**
     * Show summary of total tasks and date selection buttons
     */
    public async showTaskSelectorWithSummary(ctx: TelegramContext, page: number = 1): Promise<void> {
        try {
            logger.info(`[MyTasksHandler] Showing task page ${page} for user ${ctx.userId}`);

            const toDateSafe = (value: any): Date => {
                if (value && typeof value.toDate === 'function') return value.toDate();
                return new Date(value);
            };

            const toTimeString = (value: any): string => {
                const date = toDateSafe(value);
                return date.toLocaleTimeString("uk-UA", {
                    timeZone: "Europe/Kyiv",
                    hour: '2-digit',
                    minute: '2-digit'
                });
            };

            await this.keyboardManager.cleanupMessages(ctx);

            const result = await this.taskService.getTasksForUser(ctx.userId);
            const tasks = result?.tasks || [];

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const tasksFromToday = tasks.filter(task => toDateSafe(task.dueDate).getTime() >= today.getTime());
            const total = tasksFromToday.length;

            const pageSize = 5;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const currentPage = Math.max(1, Math.min(page, totalPages));

            const tasksToShow = tasksFromToday
                .sort((a, b) => toDateSafe(a.dueDate).getTime() - toDateSafe(b.dueDate).getTime())
                .slice((currentPage - 1) * pageSize, currentPage * pageSize);

            if (tasksToShow.length === 0) {
                await ctx.reply("📋 Завдань не знайдено.", { parse_mode: "Markdown" });
                return;
            }

            const tasksByDate = new Map<string, typeof tasks>();
            for (const task of tasksToShow) {
                const dateObj = toDateSafe(task.dueDate);
                if (!dateObj) continue;

                const key = `${dateObj.getFullYear()}-${(dateObj.getMonth() + 1).toString().padStart(2, '0')}-${dateObj.getDate().toString().padStart(2, '0')}`;
                if (!tasksByDate.has(key)) {
                    tasksByDate.set(key, []);
                }
                tasksByDate.get(key)!.push(task);
            }

            const sortedDates = Array.from(tasksByDate.keys()).sort();

            let text = `🗂️ Загальна кількість запланованих задач: *${total}*\n`;
            text += `📖 Сторінка *${currentPage}/${totalPages}*\n\n`;

            for (const dateKey of sortedDates) {
                const dateParts = dateKey.split("-");
                const formattedDate = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;

                const taskDate = new Date(`${dateKey}T00:00:00`);
                const diffDays = Math.floor((taskDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                const label =
                    diffDays === 0
                        ? `Сьогодні (${formattedDate})`
                        : diffDays === 1
                            ? `Завтра (${formattedDate})`
                            : formattedDate;

                text += `📅 ${label}\n`;

                for (const task of tasksByDate.get(dateKey)!) {
                    const dueDate = toDateSafe(task.dueDate);
                    const dueDateStr = `${dueDate.getDate().toString().padStart(2, '0')}.${(dueDate.getMonth() + 1).toString().padStart(2, '0')}.${dueDate.getFullYear()}`;

                    let typeLabel = '';

                    if (task.type === 'checkin') {
                        typeLabel = '🟢 Заїзд';
                    } else {
                        typeLabel = '🔴 Виїзд';
                    }

                    if (task.status === 'completed') {
                        typeLabel += ' (завершено, очікує перевірки)';
                    } else if (task.status === 'pending') {
                        typeLabel += ' (очікує виконання)';
                    } else if (task.status === 'verified') {
                        typeLabel += ' (перевірено)';
                    } else {
                        typeLabel += ' (стан невідомий)';
                    }

                    text += `\n${typeLabel}:\n`;
                    text += `🏠 ${task.apartmentId}: ${task.address}\n`;
                    text += `🗓️ Дата: ${dueDateStr}\n`;
                }

                text += `\n`;
            }

            const taskButtons = tasksToShow.map((task) => [{
                text: `${task.type === 'checkin' ? '🟢 Заїзд' : '🔴  Виїзд'}: ${task.apartmentId} - ${task.address}`,
                callback_data: `task_detail_${task.reservationId}`
            }]);

            const navButtons = [
                ...(currentPage > 1 ? [{ text: '◀️', callback_data: `show_tasks_page_${currentPage - 1}` }] : []),
                { text: `${currentPage}/${totalPages}`, callback_data: 'noop' },
                ...(currentPage < totalPages ? [{ text: '▶️', callback_data: `show_tasks_page_${currentPage + 1}` }] : [])
            ];

            const keyboard = {
                inline_keyboard: [...taskButtons, navButtons]
            };

            logger.info(`[Tasks] Trying to edit message ${ctx.messageIdToEdit} for chat ${ctx.chatId}`);
            if (ctx.messageIdToEdit) {
                try {
                    const BOT_TOKEN = defineString("TELEGRAM_BOT_TOKEN").value();
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                        chat_id: ctx.chatId,
                        message_id: ctx.messageIdToEdit
                    });
                    logger.info(`[Tasks] Deleted message ${ctx.messageIdToEdit}`);
                } catch (err) {
                    logger.warn(`[Tasks] Could not delete message ${ctx.messageIdToEdit}:`, err);
                }
            }

            const msg = await ctx.reply(text, {
                parse_mode: "Markdown",
                reply_markup: keyboard
            });
            this.keyboardManager.storeMessageId(ctx.userId, msg.message_id, 'task');

        } catch (error) {
            logger.error('[TaskHandler] Error in showTaskSelectorWithSummary:', error);
            await ctx.reply('Помилка при показі завдань.');
        }
    }

    /**
     * Show tasks for a specific date
     */
    public async showTasksForDate(ctx: TelegramContext, date: Date): Promise<void> {
        try {
            logger.info(`[showTasksForDate] user=${ctx.userId} target=${date.toISOString()}`);
            await this.keyboardManager.cleanupTaskMessagesOnly(ctx);

            const result = await this.taskService.getTasksForUser(ctx.userId);
            if (!result.success || !result.tasks) {
                logger.warn(`[showTasksForDate] getTasksForUser returned err: ${result.message}`);
                await ctx.reply(result.message || "Немає завдань на обрану дату.", { parse_mode: "Markdown" });
                return;
            }

            const grouped = this.taskService.groupTasksByDate(result.tasks);
            const key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;

            if (!grouped[key]) {
                await ctx.reply("Немає завдань на обрану дату.", { parse_mode: "Markdown" });
                return;
            }

            const tasks = grouped[key].checkins;
            if (!tasks.length) {
                await ctx.reply("Немає задач на обрану дату.", { parse_mode: "Markdown" });
                return;
            }

            let text = `📅 Завдання на *${date.toLocaleDateString("uk-UA")}*:\n\n`;

            tasks.forEach((task, index) => {
                const from = task.cleaningTimeStart || '??:??';
                const to = task.cleaningTimeEnd || '??:??';
                text += `🏠 ${task.apartmentId}: ${task.address}\n`;
                text += `⏰ Час прибирання: ${from} – ${to}\n\n`;
            });

            const msg = await ctx.reply(text, { parse_mode: 'Markdown' });
            this.keyboardManager.storeMessageId(ctx.userId, msg.message_id, 'task');
        } catch (err) {
            logger.error('[showTasksForDate] exception:', err);
            await ctx.reply("Помилка при отриманні завдань. Спробуйте пізніше.");
        }
    }

    public async showTaskDetails(ctx: TelegramContext, reservationId: string): Promise<void> {
        logger.info(`[showTaskDetails] reservationId=${reservationId}`);

        try {
            await this.keyboardManager.cleanupMessages(ctx);
            const result = await this.taskService.getTasksForUser(ctx.userId);
            const tasks = result?.tasks || [];
            logger.debug(`[showTaskDetails] All reservationIds: ${tasks.map(t => t.reservationId).join(', ')}`);

            const task = tasks.find(t => t.reservationId === reservationId);

            if (!task) {
                logger.warn(`[showTaskDetails] Task with reservationId=${reservationId} not found among ${tasks.length} tasks.`);
                await ctx.reply('Завдання не знайдено.');
                return;
            }

            const toDateSafe = (value: any): Date => {
                if (value && typeof value.toDate === 'function') return value.toDate();
                return new Date(value);
            };

            const toTimeString = (value: any): string => {
                const date = toDateSafe(value);
                return date.toLocaleTimeString("uk-UA", { hour: '2-digit', minute: '2-digit' });
            };

            const dateObj = toDateSafe(task.dueDate);
            const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()}`;

            const importantText = task.type === 'checkin'
                ? '⚠️ *ВАЖЛИВО:* Квартира має бути готова до заїзду'
                : '⚠️ *ВАЖЛИВО:* Квартира має бути прибрана після виїзду';

            const dateLabel = task.type === 'checkin' ? 'Дата заїзду' : 'Дата виїзду';

            const statusTextMap: Record<string, string> = {
                pending: '🟡 Очікує виконання',
                completed: '✅ Завершено (очікує перевірки)',
                verified: '🔵 Перевірено',
                cancelled: '❌ Скасовано'
            };

            const statusText = statusTextMap[task.status] || 'ℹ️ Невідомий статус';

            const notesText = task.notes ? `📝 *Примітки:* ${task.notes}` : '';

            const message = `${importantText}\n\n` +
                `🏠 *Адреса:* ${task.address}\n` +
                `🆔 *ID:* ${task.apartmentId}\n` +
                `📅 *${dateLabel}:* ${dateStr}\n` +
                `👤 *Гість:* ${task.guestName}\n` +
                `📞 *Телефон:* ${task.guestPhone || 'не вказано'}\n` +
                `🔑 *Ключів:* ${task.keysCount ?? 'не вказано'}\n` +
                `💰 *Сума:* ${task.sumToCollect ?? 0}\n` +
                `📌 *Статус:* ${statusText}\n\n` +
                notesText;

            const keyboard = {
                inline_keyboard: [
                    [{ text: '🛠 Повідомити про проблему', callback_data: `report_issue_${reservationId}` }],
                    [{ text: '🧽 Квартира дуже брудна', callback_data: `report_dirty_${reservationId}` }],
                    [{ text: '✅ Прибирання завершено', callback_data: `mark_done_${reservationId}` }]
                ]
            };

            const sentMessage = await ctx.reply(message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
            this.keyboardManager.storeMessageId(ctx.userId, sentMessage.message_id);

        } catch (error) {
            logger.error('[showTaskDetails] Error:', error);
            await ctx.reply('Не вдалося завантажити деталі завдання.');
        }
    }

    /**
     * Handles the step when the user indicates the cleaning is completed: prompts to send photos.
     */
    public async handleMarkDone(ctx: TelegramContext, reservationId: string): Promise<void> {
        logger.info(`[handleMarkDone] User ${ctx.userId} clicked mark done for reservationId=${reservationId}`);

        try {
            // Save session state to wait for photo and comment
            ctx.session = {
                waitingForPhoto: true,
                reservationIdForPhoto: reservationId,
                collectedPhotos: [],
                comment: ''
            };

            setSession(String(ctx.userId), ctx.session);

            await this.keyboardManager.cleanupMessages(ctx);
            const msg = await ctx.reply(
                `📸 *Будь ласка, надішліть фото прибраної квартири та, за бажанням, залиште коментар.*\n\n` +
                `Коли завершите, натисніть "✅ Готово".`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Готово', callback_data: 'finish_upload_photos' }],
                            [{ text: '🏠 Головне меню', callback_data: 'back_to_main' }]
                        ]
                    }
                }
            );
            this.keyboardManager.storeMessageId(ctx.userId, msg.message_id);

        } catch (error) {
            logger.error('[handleMarkDone] Error:', error);
            await ctx.reply('Виникла помилка при обробці запиту. Спробуйте ще раз.');
        }
    }

    /**
     * Handles the first step when the user reports that the apartment is very dirty: prompts to send photos.
     */
    public async handleMarkDirty(ctx: TelegramContext, reservationId: string): Promise<void> {
        logger.info(`[handleMarkDirty] User ${ctx.userId} clicked report dirty for reservationId=${reservationId}`);

        try {
            // Save session state to wait for dirty photo and comment
            ctx.session = {
                waitingForPhoto: true,
                reservationIdForPhoto: reservationId,
                collectedPhotos: [],
                comment: '',
                isDirtyReport: true
            };

            setSession(String(ctx.userId), ctx.session);

            await this.keyboardManager.cleanupMessages(ctx);
            const msg = await ctx.reply(
                `🧽 *Будь ласка, надішліть фото стану квартири та короткий опис проблеми.*\n\n` +
                `Коли завершите, натисніть "✅ Готово".`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Готово', callback_data: 'finish_upload_photos' }],
                            [{ text: '🏠 Головне меню', callback_data: 'back_to_main' }]
                        ]
                    }
                }
            );
            this.keyboardManager.storeMessageId(ctx.userId, msg.message_id);

        } catch (error) {
            logger.error('[handleMarkDirty] Error:', error);
            await ctx.reply('Виникла помилка при обробці запиту. Спробуйте ще раз.');
        }
    }

    public async handleReportProblem(ctx: TelegramContext, reservationId: string): Promise<void> {
        logger.info(`[handleReportProblem] User ${ctx.userId} clicked report issue for reservationId=${reservationId}`);

        try {
            ctx.session = {
                waitingForPhoto: false,
                reservationIdForPhoto: reservationId,
                comment: '',
                isProblemReport: true
            };

            setSession(String(ctx.userId), ctx.session);

            await this.keyboardManager.cleanupMessages(ctx);
            const msg = await ctx.reply(
                `✏️ *Будь ласка, опишіть проблему або нестачу у квартирі текстом.*`,
                { parse_mode: 'Markdown' }
            );
            this.keyboardManager.storeMessageId(ctx.userId, msg.message_id);

        } catch (error) {
            logger.error('[handleReportProblem] Error:', error);
            await ctx.reply('Виникла помилка при обробці запиту. Спробуйте ще раз.');
        }
    }

    public async updateTaskNotes(reservationId: string, comment: string): Promise<void> {
        const firestore = admin.firestore();
        const tasksRef = firestore.collection('tasks');

        const snapshot = await tasksRef.where('reservationId', '==', reservationId).get();

        if (snapshot.empty) {
            logger.warn(`[updateTaskNotes] No tasks found for reservationId=${reservationId}`);
            return;
        }

        const batch = firestore.batch();

        snapshot.forEach(doc => {
            const existingNotes = doc.get('notes') || '';
            const updatedNotes = `${existingNotes}\nProblem reported: ${comment}`;
            batch.update(doc.ref, { notes: updatedNotes });
        });

        await batch.commit();
        logger.info(`[updateTaskNotes] Problem note added to task ${reservationId}`);
    }

}