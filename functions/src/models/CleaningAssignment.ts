import { Timestamp } from "firebase-admin/firestore";

export interface ICleaningAssignmentData {
  id?: string;
  userId: string;
  apartmentIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export class CleaningAssignment {
  id: string;
  userId: string;
  apartmentIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;

  constructor(data: ICleaningAssignmentData) {
    this.id = data.id || "";
    this.userId = data.userId;
    this.apartmentIds = data.apartmentIds;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }
} 