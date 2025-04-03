import moment from 'moment-timezone';
import { Timestamp } from 'firebase-admin/firestore';

export const KIEV_TZ = "Europe/Kiev";

export function getKievDate(offsetDays: number = 0): string {
  return moment().tz(KIEV_TZ).add(offsetDays, "days").format("YYYY-MM-DD");
}

export function getTimestamp(): Date {
  // For Firestore Timestamp fields, use FieldValue.serverTimestamp() in writes,
  // but for general use, a JS Date is fine.
  return new Date();
}

// Define a type for things that could be a Timestamp or Date
type DateInput = Timestamp | Date | null | undefined;

export function formatTimestamp(timestamp: DateInput, format: string = "DD.MM.YYYY HH:mm"): string {
    if (!timestamp) return "N/A";

    // Check if it's a Firestore Timestamp and convert
    const date = (timestamp instanceof Timestamp) ? timestamp.toDate() : timestamp;

    // Check if it's a valid Date object after potential conversion
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return "Invalid Date";
    }

    return moment(date).tz(KIEV_TZ).format(format);
}

module.exports = {
  getKievDate,
  getTimestamp,
  formatTimestamp,
  KIEV_TZ,
}; 