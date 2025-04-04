import moment from 'moment-timezone';
import { Timestamp } from 'firebase-admin/firestore';

export const KIEV_TZ = "Europe/Kiev";

interface KievDateOptions {
  endOfDay?: boolean;
  returnTimestamp?: boolean;
  format?: string;
}

export function getKievDate(offsetDays: number = 0, options: KievDateOptions = {}): string | Date | Timestamp {
  const date = moment().tz(KIEV_TZ).add(offsetDays, "days");
  
  if (options.endOfDay) {
    date.endOf('day');
  } else {
    date.startOf('day');
  }

  if (options.returnTimestamp) {
    return Timestamp.fromDate(date.toDate());
  }

  if (options.format) {
    return date.format(options.format);
  }

  return date.format("YYYY-MM-DD");
}

export function getKievDateRange(offsetDays: number = 0, daysRange: number = 7): { start: Timestamp; end: Timestamp } {
  const start = moment().tz(KIEV_TZ).add(offsetDays, "days").startOf('day');
  const end = moment().tz(KIEV_TZ).add(offsetDays + daysRange - 1, "days").endOf('day');

  return {
    start: Timestamp.fromDate(start.toDate()),
    end: Timestamp.fromDate(end.toDate())
  };
}

export function toKievDate(date: Date | Timestamp | string): moment.Moment {
  if (date instanceof Timestamp) {
    return moment(date.toDate()).tz(KIEV_TZ);
  }
  if (date instanceof Date) {
    return moment(date).tz(KIEV_TZ);
  }
  return moment(date).tz(KIEV_TZ);
}

export function formatKievDate(
  date: Date | Timestamp | string | null | undefined,
  format: string = "DD.MM.YYYY"
): string {
  if (!date) return "N/A";
  
  try {
    return toKievDate(date as Date | Timestamp | string).format(format);
  } catch (error) {
    return "Invalid Date";
  }
}

export function isValidKievDate(date: any): boolean {
  if (!date) return false;
  try {
    return toKievDate(date).isValid();
  } catch {
    return false;
  }
}

export function getTimestamp(): Timestamp {
  return Timestamp.now();
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
  getKievDateRange,
  toKievDate,
  formatKievDate,
  isValidKievDate,
  getTimestamp,
  formatTimestamp,
  KIEV_TZ,
}; 