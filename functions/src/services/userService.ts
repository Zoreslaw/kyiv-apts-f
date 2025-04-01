// Service for managing user data and permissions
import { Timestamp } from "firebase-admin/firestore";
import { findByTelegramId, createUser, updateUser } from "../repositories/userRepository";
import { User, IUserData } from "../models/User";
import { UserRoles } from "../utils/constants";

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

async function isUserRegistered(telegramId: number | string): Promise<boolean> {
  const user = await findByTelegramId(telegramId);
  return user !== null;
}

async function findOrCreateUser(telegramUser: TelegramUser): Promise<User> {
  const { id, first_name, last_name, username } = telegramUser;
  let user = await findByTelegramId(id);
  if (!user) {
    console.log(`Creating new user: ${first_name} (ID=${id})`);
    const newUser: Omit<IUserData, 'id'> = {
      telegramId: String(id),
      chatId: null,
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

async function updateUserChatId(telegramId: number | string, chatId: number): Promise<User | null> {
  const user = await findByTelegramId(telegramId);
  if (user && user.chatId !== chatId) {
    return updateUser(user.id, { chatId, updatedAt: Timestamp.now() });
  }
  return user;
}

interface UserWithPermissions {
  id: string;
  telegramId: string;
  chatId: number | null;
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

async function getUserWithPermissions(telegramId: number | string): Promise<UserWithPermissions | null> {
  const user = await findByTelegramId(telegramId);
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