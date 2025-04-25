import * as Canvas from 'canvas';
import moment from 'moment-timezone';
import { createCanvas, loadImage } from 'canvas';
import * as path from 'path';
import { logger } from 'firebase-functions';

/**
 * Format a date using moment.js
 * @param date Date to format
 * @param format Format string (default: DD.MM.YYYY)
 * @returns Formatted date string
 */
export function formatDate(date: Date, format: string = 'DD.MM.YYYY'): string {
  return moment(date).format(format);
}

/**
 * Calculate Kiev date with offset
 * @param offsetDays Number of days to offset (positive or negative)
 * @returns Date object
 */
export function getKievDateWithOffset(offsetDays: number = 0): Date {
  const date = moment().tz('Europe/Kiev').add(offsetDays, 'days').toDate();
  return date;
}

/**
 * Get start of day for a date in Kiev timezone
 * @param date Date to get start of day for
 * @returns Date object set to start of day
 */
export function getStartOfDay(date: Date): Date {
  return moment(date).startOf('day').toDate();
}

/**
 * Get days in month
 * @param date Date object to get days in month for
 * @returns Number of days in the month
 */
export function getDaysInMonth(date: Date): number {
  return moment(date).daysInMonth();
}

/**
 * Get day of week index (0 = Monday in our case, not Sunday as in JS Date)
 * @param date Date to get day of week for
 * @returns Day index (0-6) where 0 is Monday
 */
export function getDayOfWeek(date: Date): number {
  return moment(date).day();
}

/**
 * Get start of month
 * @param date Date to get start of month for
 * @returns Date object set to first day of month
 */
export function getStartOfMonth(date: Date): Date {
  return moment(date).startOf('month').toDate();
}



/**
 * Generates a text-based calendar for the specified month
 * @param date The date to show in the calendar
 * @param type Optional type text to display (e.g., "Заїзди", "Виїзди")
 * @returns Text representation of the calendar
 */
export function generateCalendarText(date: Date, type: string = ''): string {
  // Calendar title with month and year
  const month = date.toLocaleString('uk-UA', { month: 'long' });
  const year = date.getFullYear();
  const dayOfMonth = date.getDate();
  
  // Get the first day of the month and number of days
  const startOfMonth = getStartOfMonth(date);
  const daysInMonth = getDaysInMonth(date);
  
  // Day names (Ukrainian)
  const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  
  // Generate the header
  let calendar = `📅 *${type || 'Календар'} - ${month} ${year}*\n\n`;
  
  // Add day names
  calendar += dayNames.join(' ') + '\n';
  
  // Calculate the starting position
  let startingDay = getDayOfWeek(startOfMonth);
  let currentDay = 1;
  
  // Generate the calendar grid
  for (let i = 0; i < 6; i++) { // Up to 6 rows
    let row = '';
    
    for (let j = 0; j < 7; j++) { // 7 days in a week
      if (i === 0 && j < startingDay) {
        // Empty space before the first day
        row += '   ';
      } else if (currentDay > daysInMonth) {
        // Empty space after the last day
        row += '   ';
      } else {
        // Format the day number
        const dayNum = currentDay.toString().padStart(2);
        
        // Highlight current day
        if (currentDay === dayOfMonth) {
          // If it's the selected date, display with brackets
          row += `[${dayNum}]`;
        } else {
          // Regular day
          row += ` ${dayNum} `;
        }
        
        currentDay++;
      }
    }
    
    // Add the row if it contains any days
    if (row.trim() !== '') {
      calendar += row + '\n';
    }
    
    // Break if we've displayed all days
    if (currentDay > daysInMonth) {
      break;
    }
  }
  
  return calendar;
}

/**
 * Generate a calendar image using canvas
 * @param date The date to display
 * @param type Title of the calendar (e.g., 'Заїзди', 'Виїзди')
 * @returns Buffer containing the PNG image data
 */
export async function generateCalendarImage(date: Date, type: string = ''): Promise<Buffer> {
  try {
    const width = 600;
    const height = 300;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background color as fallback
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    try {
      // Load and draw background image
      // Adjust the path to your assets directory
      const image = await loadImage(path.join(__dirname, '../../assets/332463779.jpg'));
      
      // Draw image with proper scaling to cover the canvas
      const scale = Math.max(width / image.width, height / image.height);
      const x = (width - image.width * scale) / 2;
      const y = (height - image.height * scale) / 2;
      
      ctx.drawImage(image, x, y, image.width * scale, image.height * scale);

      // Apply a gradient overlay
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    } catch (error) {
      logger.warn('Could not load background image, using solid background', error);
    }

    // Draw type text if provided
    if (type) {
      ctx.font = 'bold 32px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(type, width / 2, 60);

      // Add decorative line under type
      ctx.beginPath();
      ctx.moveTo(width / 2 - 50, 75);
      ctx.lineTo(width / 2 + 50, 75);
      ctx.strokeStyle = '#2F80ED';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Draw day number
    ctx.font = 'bold 120px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(date.getDate().toString(), width / 2, 180);

    // Draw month and year
    const month = date.toLocaleString('uk-UA', { month: 'long' });
    const year = date.getFullYear();
    
    // Month
    ctx.font = 'bold 36px Arial';
    ctx.fillStyle = '#2F80ED';
    ctx.fillText(month, width / 2, 230);
    
    // Year
    ctx.font = '24px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(year + ' р.', width / 2, 260);

    return canvas.toBuffer('image/png');
  } catch (error) {
    logger.error('Error generating calendar image:', error);
    throw error;
  }
}