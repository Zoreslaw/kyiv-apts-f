import { OpenAI } from "openai";
import { defineString } from "firebase-functions/params";
import { logger } from 'firebase-functions';
import { db } from '../config/firebase';
import { TaskTypes, TaskStatuses } from '../utils/constants';
import { getKievDate } from '../utils/dateTime';

// Params
const openaiApiKey = defineString("OPENAI_API_KEY");

const openai = new OpenAI({
  apiKey: openaiApiKey.value(),
});

// TODO: Define function schemas, system prompt etc.
// Adapt the logic from the old index.js

interface UserRequestResponse {
  content: string;
}

async function interpretUserRequest(text: string, context: any[] = []): Promise<UserRequestResponse> {
  // Placeholder - adapt OpenAI call from old index.js
  logger.log("Interpreting user request (AI):", text);
  // const completion = await openai.chat.completions.create({ ... });
  // return completion.choices[0].message;
  return { content: "AI processing not fully implemented yet." };
}

// Types
export interface TaskTimeUpdate {
  taskId: string;
  newTime: string;
  changeType: 'checkin' | 'checkout';
  userId: string;
}

export interface TaskInfoUpdate {
  taskId: string;
  newSumToCollect?: number | null;
  newKeysCount?: number | null;
  userId: string;
}

export interface ApartmentAssignment {
  targetUserId: string;
  action: 'add' | 'remove';
  apartmentIds: string[];
  isAdmin: boolean;
}

export interface UserApartmentsQuery {
  targetUserId: string;
  isAdmin: boolean;
}

export interface FunctionResult {
  success: boolean;
  message: string;
}

export interface AIContext {
  userId: string;
  chatId: string;
  isAdmin: boolean;
  assignedApartments: string[];
  currentTasks: any[];
}

// Function schemas for OpenAI
export const functionSchemas = [
  {
    type: 'function' as const,
    function: {
      name: 'update_task_time',
      description: 'Updates checkin or checkout time for a given task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Unique Firestore doc ID, e.g. "2025-03-15_562_checkin"',
          },
          newTime: {
            type: 'string',
            description: 'New time in "HH:00" format.',
          },
          changeType: {
            type: 'string',
            enum: ['checkin', 'checkout'],
            description: 'Which time to update? "checkin" or "checkout" only.',
          },
          userId: {
            type: 'string',
            description: 'Telegram user ID for logging',
          },
        },
        required: ['taskId', 'newTime', 'changeType', 'userId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_task_info',
      description: 'Updates sumToCollect and/or keysCount for a task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Unique Firestore doc ID of the task',
          },
          newSumToCollect: {
            type: ['number', 'null'],
            description: 'Optional new sum to collect (if updating).',
          },
          newKeysCount: {
            type: ['number', 'null'],
            description: 'Optional new number of keys (if updating).',
          },
          userId: {
            type: 'string',
            description: 'Telegram user ID for logging',
          },
        },
        required: ['taskId', 'userId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'manage_apartment_assignments',
      description: 'Manages apartment assignments for users (admin only).',
      parameters: {
        type: 'object',
        properties: {
          targetUserId: {
            type: 'string',
            description: 'Telegram user ID OR partial name/username of user to modify',
          },
          action: {
            type: 'string',
            enum: ['add', 'remove'],
            description: 'Whether to add or remove apartments',
          },
          apartmentIds: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Array of apartment IDs to add or remove',
          },
          isAdmin: {
            type: 'boolean',
            description: 'Whether the requesting user is an admin',
          },
        },
        required: ['targetUserId', 'action', 'apartmentIds', 'isAdmin'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'show_user_apartments',
      description: 'Shows all apartments assigned to a user (admin only).',
      parameters: {
        type: 'object',
        properties: {
          targetUserId: {
            type: 'string',
            description: 'Telegram user ID or name of user to view',
          },
          isAdmin: {
            type: 'boolean',
            description: 'Whether the requesting user is an admin',
          },
        },
        required: ['targetUserId', 'isAdmin'],
        additionalProperties: false,
      },
    },
  },
];

// System prompt
export const systemPrompt = `
You are a Telegram assistant for managing apartment tasks.

User references:
1. If user says "@username" or "username" or a partial name, you can search the Firestore "users" collection to find the user with "username" or "firstName" or "lastName" matching it.
2. If no user is found, ask for clarification.

User Permissions:
1. Admin users can:
   - See and modify all tasks
   - Add/remove apartment assignments for users
   - See assigned apartments for other users
2. Regular users can only see and modify their assigned apartments

Available Functions:
1) "update_task_time": Updates checkin or checkout time
   - Format: HH:00 (e.g., "11:00", "15:00")
   - Any time can be set for checkin or checkout

2) "update_task_info": Updates sumToCollect and/or keysCount
   - sumToCollect: Amount to collect from guest (in UAH)
   - keysCount: Number of keys to collect/return

3) "manage_apartment_assignments": Manages apartment assignments (admin only)
   - Can add or remove apartment IDs for specific users
   - Must provide target user's Telegram ID
   - Must be an admin to use this function

4) "show_user_apartments": Lists all apartments assigned to a user (admin only)
   - Must be an admin to use this function
   - Just mention user by name or @username
   - The bot will automatically find their Telegram ID

Examples:
1. "Змініть виїзд 562 на 12:00" -> Use task ID "562"
2. "Встанови заїзд на 15:00 для Гусак" -> Use guest name "Гусак"
3. "Постав суму 300 для task 2025-03-15_562_checkin" -> Use full task ID
4. "Постав 2 ключі для Baseina" -> Use address "Baseina"
5. "Додай квартири 562, 321 для @username" -> Add apartments for user
6. "Видали квартиру 432 у @username" -> Remove apartment from user
7. "Показати квартири для @username" -> Show apartments for user
8. "Показати квартири для 1234567890" -> Show apartments for user with ID 1234567890

Always respond in Ukrainian.
If the user's request is unclear or missing information, ask for clarification.
If the user doesn't have permission to modify a task or manage assignments, inform them.
`;

export class AIService {
  private conversationContexts: Map<string, any[]>;

  constructor() {
    this.conversationContexts = new Map();
  }

  getConversationContext(chatId: string): any[] {
    if (!this.conversationContexts.has(chatId)) {
      this.conversationContexts.set(chatId, []);
    }
    return this.conversationContexts.get(chatId)!;
  }

  updateConversationContext(chatId: string, message: any): void {
    const context = this.getConversationContext(chatId);
    context.push(message);
    // Keep only last 3 messages
    if (context.length > 3) {
      context.shift();
    }
  }

  clearConversationContext(chatId: string): void {
    this.conversationContexts.delete(chatId);
  }

  async processMessage(
    text: string,
    context: AIContext
  ): Promise<{ type: 'text' | 'function_call', content?: string, function_call?: { name: string, arguments: string } }> {
    try {
      const { userId, chatId, isAdmin, assignedApartments, currentTasks } = context;
      const conversationContext = this.getConversationContext(chatId);

      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          ...conversationContext.map((msg) => {
            if (msg.role === 'function') {
              return {
                role: 'function',
                name: msg.name,
                content: msg.content,
              };
            }
            return {
              role: msg.role,
              content: msg.content,
              ...(msg.function_call && { function_call: msg.function_call }),
            };
          }),
          {
            role: 'user',
            content: text,
          },
          {
            role: 'system',
            content: `Current user context:
              - User ID: ${userId}
              - Is admin: ${isAdmin}
              - Assigned apartments: ${isAdmin ? 'ALL' : assignedApartments.join(', ')}
              - Available tasks: ${JSON.stringify(currentTasks, null, 2)}`,
          },
        ],
        functions: functionSchemas.map((schema) => schema.function),
        function_call: 'auto',
      });

      const message = completion.choices[0].message;
      if (!message) {
        return { type: 'text', content: 'Помилка при обробці запиту.' };
      }

      this.updateConversationContext(chatId, {
        role: 'user',
        content: text,
      });

      if (message.function_call) {
        this.updateConversationContext(chatId, {
          role: 'assistant',
          content: null,
          function_call: message.function_call,
        });

        return {
          type: 'function_call',
          function_call: message.function_call,
        };
      }

      this.updateConversationContext(chatId, {
        role: 'assistant',
        content: message.content || '',
      });

      return {
        type: 'text',
        content: message.content || 'Добре, зрозумів.',
      };
    } catch (error) {
      logger.error('Error in processMessage:', error);
      return { type: 'text', content: 'Помилка при обробці запиту. Спробуйте пізніше.' };
    }
  }

  async processFunctionResult(
    chatId: string,
    functionName: string,
    functionArgs: any,
    functionResult: FunctionResult
  ): Promise<{ type: 'text', content: string }> {
    try {
      const context = this.getConversationContext(chatId);

      const followUp = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          ...context.map((msg) => {
            if (msg.role === 'function') {
              return {
                role: 'function',
                name: msg.name,
                content: msg.content,
              };
            }
            return {
              role: msg.role,
              content: msg.content,
              ...(msg.function_call && { function_call: msg.function_call }),
            };
          }),
          {
            role: 'function',
            name: functionName,
            content: JSON.stringify(functionResult),
          },
        ],
        functions: functionSchemas.map((schema) => schema.function),
        function_call: 'auto',
      });

      const message = followUp.choices[0].message;
      if (!message) {
        return { type: 'text', content: functionResult.message };
      }

      if (message.function_call) {
        logger.info('Model tried another function call after update.');
        return {
          type: 'text',
          content: 'Оновлено, але є ще функція. Наразі не обробляється.',
        };
      }

      return {
        type: 'text',
        content: message.content || functionResult.message,
      };
    } catch (error) {
      logger.error('Error in processFunctionResult:', error);
      return { type: 'text', content: functionResult.message };
    }
  }
}

export {
  interpretUserRequest,
  // ... other AI related functions
}; 