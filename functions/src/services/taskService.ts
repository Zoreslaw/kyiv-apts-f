// Service for managing tasks (check-in, check-out, cleaning)
const taskRepository = require("../repositories/taskRepository");

// Example function
async function getTasksForUser(userId) {
  // Add logic to check user role, etc.
  return taskRepository.findTasksByUserId(userId);
}

// Example function
async function updateTaskStatus(taskId, status, userId) {
  // Add validation and permission checks
  return taskRepository.updateTask(taskId, { status, updatedAt: new Date(), updatedBy: userId });
}

module.exports = {
  getTasksForUser,
  updateTaskStatus,
  // ... other task related business logic
}; 