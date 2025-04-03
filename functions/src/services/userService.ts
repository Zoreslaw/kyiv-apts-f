// Service for managing user data and permissions
import { Timestamp } from "firebase-admin/firestore";
import { findByTelegramId, createUser, updateUser } from "../repositories/userRepository";
import { User, IUserData } from "../models/User";
import { UserRoles } from "../utils/constants";
import { logger } from "firebase-functions/v2";

interface TelegramUser {
  id: string | number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

async function isUserRegistered(telegramId: string | number): Promise<boolean> {
  const telegramIdStr = String(telegramId);
  const user = await findByTelegramId(telegramIdStr);
  return user !== null;
}

async function findOrCreateUser(telegramUser: TelegramUser): Promise<User> {
  const { id, first_name, last_name, username } = telegramUser;
  const idStr = String(id);

  logger.log(JSON.stringify(telegramUser));

  let user = await findByTelegramId(idStr);
  if (!user) {
    logger.log(`Creating new user: ${first_name} (ID=${idStr})`);
    const newUser: Omit<IUserData, 'id'> = {
      telegramId: idStr,
      chatId: idStr,
      firstName: first_name || "",
      lastName: last_name || "",
      username: username || "",
      role: UserRoles.CLEANER, // Default role
      status: "active",
      assignedApartmentIds: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    user = await createUser(newUser);
  }
  return user;
}

async function updateUserChatId(telegramId: string | number, chatId: string | number): Promise<User | null> {
  const telegramIdStr = String(telegramId);
  const chatIdStr = String(chatId);
  const user = await findByTelegramId(telegramIdStr);
  if (user && user.chatId !== chatIdStr) {
    return updateUser(user.id, { chatId: chatIdStr, updatedAt: Timestamp.now() });
  }
  return user;
}

interface UserWithPermissions {
  id: string;
  telegramId: string;
  chatId: string | null;
  firstName: string;
  lastName: string | null;
  username: string | null;
  role: UserRoles;
  status: string;
  assignedApartmentIds: string[];
  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
  isAdmin: boolean;
  isManager: boolean;
  isCleaner: boolean;
}

async function getUserWithPermissions(telegramId: string | number): Promise<UserWithPermissions | null> {
  const telegramIdStr = String(telegramId);
  const user = await findByTelegramId(telegramIdStr);
  if (!user) return null;
  
  // Converting User class to UserWithPermissions
  return {
    id: user.id,
    telegramId: user.telegramId,
    chatId: user.chatId,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    role: user.role,
    status: user.status,
    assignedApartmentIds: user.assignedApartmentIds,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isAdmin: user.isAdmin(),
    isManager: user.isManager(),
    isCleaner: user.isCleaner(),
  };
}

// Add functions for assigning apartments, changing roles etc. (maybe move to assignmentService)

export {
  findOrCreateUser,
  updateUserChatId,
  getUserWithPermissions,
  type UserWithPermissions,
  isUserRegistered
}; 