import { Timestamp } from "firebase-admin/firestore";
import { findTasksByUserId, updateTask } from "../repositories/taskRepository";
import { Task, ITaskData } from "../models/Task";
import { TaskStatuses } from "../utils/constants";

async function getTasksForUser(userId: string): Promise<Task[]> {
  return findTasksByUserId(userId);
}

async function updateTaskStatus(taskId: string, status: TaskStatuses, userId: string): Promise<Task | null> {
  return updateTask(taskId, { 
    status, 
    updatedAt: Timestamp.now(), 
    updatedBy: userId 
  });
}

export {
  getTasksForUser,
  updateTaskStatus,
}; 