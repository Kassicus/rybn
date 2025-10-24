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
