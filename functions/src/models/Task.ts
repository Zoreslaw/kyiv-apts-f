import { Timestamp } from 'firebase-admin/firestore';
import { TaskStatuses, TaskTypes } from '../utils/constants';

export interface ITaskData {
    id: string;
    reservationId: string;
    apartmentId: string;
    address: string;
    taskType: TaskTypes;
    status: TaskStatuses;
    assignedStaffId?: string | null;
    dueDate: string | Date | Timestamp;
    notes?: string | null;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
    updatedBy?: string | null;
    checkinTime?: string | null;
    checkoutTime?: string | null;
    sumToCollect?: number | null;
    keysCount?: number | null;
}

export class Task implements ITaskData {
    id: string;
    reservationId: string;
    apartmentId: string;
    address: string;
    taskType: TaskTypes;
    status: TaskStatuses;
    assignedStaffId: string | null;
    dueDate: string | Date | Timestamp;
    notes: string | null;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
    updatedBy: string | null;
    checkinTime: string | null;
    checkoutTime: string | null;
    sumToCollect: number | null;
    keysCount: number | null;

    constructor(data: ITaskData) {
        this.id = data.id;
        this.reservationId = data.reservationId;
        this.apartmentId = data.apartmentId;
        this.address = data.address;
        this.taskType = data.taskType;
        this.status = data.status;
        this.assignedStaffId = data.assignedStaffId || null;
        this.dueDate = data.dueDate;
        this.notes = data.notes || null;
        this.createdAt = data.createdAt;
        this.updatedAt = data.updatedAt;
        this.updatedBy = data.updatedBy || null;
        this.checkinTime = data.checkinTime || null;
        this.checkoutTime = data.checkoutTime || null;
        this.sumToCollect = data.sumToCollect ?? null;
        this.keysCount = data.keysCount ?? null;
    }
} 