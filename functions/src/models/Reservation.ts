import { Timestamp } from 'firebase-admin/firestore';

export interface IReservationData {
    id: string;
    apartmentId: string;
    guestName: string;
    guestContact?: string | null;
    guestPhone?: string | null;
    guestEmail?: string | null;
    notes?: string | null;
    checkinDate: string | Date | Timestamp; 
    checkoutDate: string | Date | Timestamp;
    bookingSource?: string | null;
    sumToCollect?: number;
    keysCount?: number;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}

export class Reservation implements IReservationData { 
    id: string;
    apartmentId: string;
    guestName: string;
    guestContact: string | null;
    guestPhone: string | null;
    guestEmail: string | null;
    notes: string | null;
    checkinDate: string | Date | Timestamp;
    checkoutDate: string | Date | Timestamp;
    bookingSource: string | null;
    sumToCollect: number;
    keysCount: number;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;

    constructor(data: IReservationData) {
        this.id = data.id;
        this.apartmentId = data.apartmentId;
        this.guestName = data.guestName;
        this.guestContact = data.guestContact || null;
        this.guestPhone = data.guestPhone || null;
        this.guestEmail = data.guestEmail || null;
        this.notes = data.notes || null;
        this.checkinDate = data.checkinDate;
        this.checkoutDate = data.checkoutDate;
        this.bookingSource = data.bookingSource || null;
        this.sumToCollect = data.sumToCollect ?? 0;
        this.keysCount = data.keysCount ?? 1;
        this.createdAt = data.createdAt || Timestamp.now(); 
        this.updatedAt = data.updatedAt || Timestamp.now();
    }
}