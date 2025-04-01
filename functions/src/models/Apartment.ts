import { Timestamp } from 'firebase-admin/firestore';

export interface IApartmentData {
    id: string;
    address: string;
    internalName?: string | null;
    notes?: string | null;
    standardKeysCount?: number;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}

export class Apartment implements IApartmentData {
    id: string;
    address: string;
    internalName: string | null;
    notes: string | null;
    standardKeysCount: number;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;

    constructor(data: IApartmentData) {
        this.id = data.id;
        this.address = data.address;
        this.internalName = data.internalName || null;
        this.notes = data.notes || null;
        this.standardKeysCount = data.standardKeysCount ?? 1;
        this.createdAt = data.createdAt;
        this.updatedAt = data.updatedAt;
    }

    getFullAddress(): string {
        return `${this.address}${this.internalName ? ` (${this.internalName})` : ''}`;
    }
}

module.exports = Apartment; 