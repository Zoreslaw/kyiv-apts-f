import { UserRoles } from '../utils/constants';

export interface IUserData {
    id?: string;
    telegramId: string;
    chatId: string;
    firstName: string;
    lastName?: string;
    username?: string;
    role: string;
    status: 'active' | 'inactive';
    assignedApartmentIds?: string[];
    createdAt: Date;
    updatedAt: Date;
}

export class User implements IUserData {
    id?: string;
    telegramId: string;
    chatId: string;
    firstName: string;
    lastName?: string;
    username?: string;
    role: string;
    status: 'active' | 'inactive';
    assignedApartmentIds?: string[];
    createdAt: Date;
    updatedAt: Date;

    constructor(data: IUserData) {
        this.id = data.id;
        this.telegramId = data.telegramId;
        this.chatId = data.chatId;
        this.firstName = data.firstName;
        this.lastName = data.lastName || '';
        this.username = data.username || '';
        this.role = data.role || UserRoles.CLEANER;
        this.status = data.status || 'active';
        this.assignedApartmentIds = data.assignedApartmentIds || [];
        this.createdAt = data.createdAt instanceof Date ? data.createdAt : new Date(data.createdAt);
        this.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date(data.updatedAt);
    }

    isAdmin(): boolean {
        return this.role === UserRoles.ADMIN;
    }

    isCleaner(): boolean {
        return this.role === UserRoles.CLEANER;
    }

    isActive(): boolean {
        return this.status === 'active';
    }

    getFullName(): string {
        return `${this.firstName}${this.lastName ? ' ' + this.lastName : ''}`;
    }

    getDisplayName(): string {
        if (this.username) {
            return `@${this.username}`;
        }
        return this.getFullName();
    }
}