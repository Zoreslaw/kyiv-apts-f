console.log("Hello, world!");

// Export HTTP triggers
export { telegramWebhook } from './triggers/http';

// Export scheduled functions
export { scheduledSync } from './triggers/scheduled';

// Export services (if needed for direct access)
export { TelegramService } from './services/telegramService';
export { AIService } from './services/aiService';
export { TaskService } from './services/taskService';
export { FunctionExecutionService } from './services/functionExecutionService';
export { syncReservationsAndTasks } from './services/syncService';