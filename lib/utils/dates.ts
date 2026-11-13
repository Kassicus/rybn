/**
 * Date formatting utilities for Rybn
 */

import { format, parse, isValid } from 'date-fns';

/**
 * Formats a date string to a readable format
 * @param dateString - Date in YYYY-MM-DD format or Date object
 * @param formatStr - Format string (defaults to "MMMM do, yyyy" -> "October 24th, 2024")
 * @returns Formatted date string or original string if invalid
 */
export function formatDate(
  dateString: string | Date | null | undefined,
  formatStr: string = "MMMM do, yyyy"
): string {
  if (!dateString) return '';

  try {
    let date: Date;

    if (typeof dateString === 'string') {
      // Parse YYYY-MM-DD format
      date = parse(dateString, 'yyyy-MM-dd', new Date());
    } else {
      date = dateString;
    }

    if (!isValid(date)) {
      return dateString.toString();
    }

    return format(date, formatStr);
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateString.toString();
  }
}

/**
 * Formats a date for display in profile fields
 * @param dateString - Date in YYYY-MM-DD format
 * @returns Formatted date like "October 24th, 2024"
 */
export function formatProfileDate(dateString: string | null | undefined): string {
  return formatDate(dateString, "MMMM do, yyyy");
}

/**
 * Formats a date with short month and year
 * @param dateString - Date in YYYY-MM-DD format
 * @returns Formatted date like "Oct 24, 2024"
 */
export function formatShortDate(dateString: string | null | undefined): string {
  return formatDate(dateString, "MMM d, yyyy");
}

/**
 * Formats just the month and day (no year)
 * Useful for birthdays and anniversaries
 * @param dateString - Date in YYYY-MM-DD format
 * @returns Formatted date like "October 24th"
 */
export function formatMonthDay(dateString: string | null | undefined): string {
  return formatDate(dateString, "MMMM do");
}

/**
 * Checks if a date string is valid
 * @param dateString - Date in YYYY-MM-DD format
 * @returns True if valid
 */
export function isValidDateString(dateString: string | null | undefined): boolean {
  if (!dateString) return false;

  try {
    const date = parse(dateString, 'yyyy-MM-dd', new Date());
    return isValid(date);
  } catch {
    return false;
  }
}

/**
 * True when the text is YYYY-MM-DD and names a day on the Gregorian calendar
 * (so 2024-02-29 is one and 2026-02-29 is not). Year 0000 is refused: the
 * database's date type has no year zero.
 */
export function isCalendarDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;

  const [year, month, day] = text.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/**
 * Formats a number as currency
 * @param amount - Amount to format
 * @param currency - Currency code (defaults to USD)
 * @returns Formatted currency string like "$123.45"
 */
export function formatCurrency(
  amount: number | null | undefined,
  currency: string = 'USD'
): string {
  if (amount === null || amount === undefined) return '$0.00';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
