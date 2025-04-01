// Service for managing user data and permissions
const userRepository = require("../repositories/userRepository");
const { UserRoles } = require("../utils/constants");

async function findOrCreateUser(telegramUser) {
  const { id, first_name, last_name, username } = telegramUser;
  let user = await userRepository.findByTelegramId(id);
  if (!user) {
    console.log(`Creating new user: ${first_name} (ID=${id})`);
    const newUser = {
      telegramId: String(id),
      chatId: null, // Will be set on first interaction needing response
      firstName: first_name || "",
      lastName: last_name || "",
      username: username || "",
      role: UserRoles.CLEANER, // Default role
      status: "active",
      assignedApartmentIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    user = await userRepository.createUser(newUser);
  }
  return user;
}

async function updateUserChatId(telegramId, chatId) {
  const user = await userRepository.findByTelegramId(telegramId);
  if (user && user.chatId !== chatId) {
    return userRepository.updateUser(user.id, { chatId, updatedAt: new Date() });
  }
  return user;
}

async function getUserWithPermissions(telegramId) {
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) return null;
  // Add more complex permission logic if needed
  return {
    ...user,
    isAdmin: user.role === UserRoles.ADMIN,
    isManager: user.role === UserRoles.MANAGER,
    isCleaner: user.role === UserRoles.CLEANER,
  };
}

// Add functions for assigning apartments, changing roles etc. (maybe move to assignmentService)

module.exports = {
  findOrCreateUser,
  updateUserChatId,
  getUserWithPermissions,
}; 