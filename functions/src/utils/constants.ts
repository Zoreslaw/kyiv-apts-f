export enum UserRoles {
  ADMIN = "admin",
  MANAGER = "manager",
  CLEANER = "cleaner",
}

export enum TaskTypes {
  CHECK_IN = "checkin",
  CHECK_OUT = "checkout",
  CLEANING = "cleaning",
  MAINTENANCE = "maintenance",
}

export enum TaskStatuses {
  PENDING = "pending",
  ASSIGNED = "assigned",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  ISSUE_REPORTED = "issue_reported",
  BLOCKED = "blocked",
  CANCELLED = "cancelled",
}

// Default times for tasks
export const DEFAULT_CHECKIN_TIME = "14:00";
export const DEFAULT_CHECKOUT_TIME = "12:00"; 