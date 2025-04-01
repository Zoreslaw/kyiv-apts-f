import { Timestamp } from 'firebase-admin/firestore';
import { UserRoles } from '../utils/constants';

export interface IUserData {
    id: string;
    telegramId: string;
    chatId?: number | null;
    firstName: string;
    lastName?: string | null;
    username?: string | null;
    role: UserRoles;
    status: string;
    assignedApartmentIds?: string[];
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}

export class User implements IUserData {
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

    constructor(data: IUserData) {
        this.id = data.id;
        this.telegramId = data.telegramId;
        this.chatId = data.chatId || null;
        this.firstName = data.firstName;
        this.lastName = data.lastName || null;
        this.username = data.username || null;
        this.role = data.role;
        this.status = data.status;
        this.assignedApartmentIds = data.assignedApartmentIds || [];
        this.createdAt = data.createdAt;
        this.updatedAt = data.updatedAt;
    }

    isAdmin(): boolean {
        return this.role === UserRoles.ADMIN;
    }

    isManager(): boolean {
        return this.role === UserRoles.MANAGER;
    }
    
    isCleaner(): boolean {
        return this.role === UserRoles.CLEANER;
    }
}