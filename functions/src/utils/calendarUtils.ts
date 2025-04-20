import * as Canvas from 'canvas';
import moment from 'moment-timezone';

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
 * Generate a calendar image for a specific month
 * @param date Date object representing the month to display
 * @param title Optional title for the calendar
 * @returns Promise resolving to a Buffer containing the image data
 */
export async function generateCalendarImage(date: Date, title?: string): Promise<Buffer> {
  // Canvas settings
  const canvasWidth = 800;
  const canvasHeight = 600;
  const canvas = Canvas.createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');

  // Colors
  const bgColor = '#f0f0f0';
  const headerBgColor = '#4a76a8'; // Ukrainian blue color
  const headerTextColor = '#ffffff';
  const dayNameColor = '#555555';
  const todayBgColor = '#ffd700'; // Ukrainian yellow color
  const selectedDayBgColor = '#e6f7ff';
  const dayTextColor = '#333333';

  // Fill background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Calendar title
  const month = moment(date).format('MMMM YYYY');
  const headerText = title ? `${title} - ${month}` : month;
  
  ctx.fillStyle = headerBgColor;
  ctx.fillRect(0, 0, canvasWidth, 80);
  
  ctx.font = 'bold 32px Arial';
  ctx.fillStyle = headerTextColor;
  ctx.textAlign = 'center';
  ctx.fillText(headerText, canvasWidth / 2, 50);

  // Day names
  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const cellWidth = canvasWidth / 7;
  const dayNamesY = 120;
  
  ctx.font = 'bold 18px Arial';
  ctx.fillStyle = dayNameColor;
  ctx.textAlign = 'center';
  
  dayNames.forEach((name, i) => {
    ctx.fillText(name, i * cellWidth + cellWidth / 2, dayNamesY);
  });

  // Calendar cells
  const startOfMonth = getStartOfMonth(date);
  const daysInMonth = getDaysInMonth(date);
  const firstWeekday = getDayOfWeek(startOfMonth);
  
  const cellHeight = 80;
  let rowCount = Math.ceil((firstWeekday + daysInMonth) / 7);
  const calendarStartY = 140;
  
  // Current date for highlighting today
  const today = getKievDateWithOffset();
  const isCurrentMonth = 
    today.getMonth() === date.getMonth() && 
    today.getFullYear() === date.getFullYear();
  const todayDate = today.getDate();
  const selectedDate = date.getDate();

  ctx.textAlign = 'left';
  ctx.font = '16px Arial';

  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < 7; col++) {
      const dayIndex = row * 7 + col - firstWeekday + 1;
      const x = col * cellWidth;
      const y = calendarStartY + row * cellHeight;
      
      // Draw cell border
      ctx.strokeStyle = '#dddddd';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cellWidth, cellHeight);
      
      if (dayIndex > 0 && dayIndex <= daysInMonth) {
        // Highlight today
        if (isCurrentMonth && dayIndex === todayDate) {
          ctx.fillStyle = todayBgColor;
          ctx.fillRect(x, y, cellWidth, cellHeight);
        } 
        // Highlight selected day
        else if (dayIndex === selectedDate) {
          ctx.fillStyle = selectedDayBgColor;
          ctx.fillRect(x, y, cellWidth, cellHeight);
        }
        
        // Draw day number
        ctx.fillStyle = dayTextColor;
        ctx.fillText(dayIndex.toString(), x + 10, y + 25);
      }
    }
  }

  // Convert canvas to buffer
  return canvas.toBuffer('image/png');
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