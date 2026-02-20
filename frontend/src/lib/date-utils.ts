/**
 * Shared date formatting utilities.
 * Single source of truth — used across Home, Logs, Admin, NextAutoRenewalInfo.
 */

/** Format to locale date string (e.g. "2/20/2026"). Handles strings, Date objects, timestamps. */
export const formatDate = (dateString: string | Date | number | null | undefined): string => {
  if (!dateString) return 'N/A';

  // If already a formatted string (contains timezone), return as-is
  if (
    typeof dateString === 'string' &&
    dateString.includes(' at ') &&
    /P[DS]T|E[DS]T|[A-Z]{2,4}$/.test(dateString)
  ) {
    return dateString;
  }

  try {
    const date = dateString instanceof Date ? dateString : new Date(dateString);
    if (isNaN(date.getTime())) return String(dateString);
    return date.toLocaleDateString();
  } catch {
    return String(dateString);
  }
};

/** Format to full locale date+time (e.g. "2/20/2026, 3:45:00 PM"). */
export const formatDateTime = (dateString: string | Date | number | null | undefined): string => {
  if (!dateString) return 'Unknown';
  try {
    const date = dateString instanceof Date ? dateString : new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleString();
  } catch {
    return 'Invalid Date';
  }
};

/** Format to short date+time (e.g. "Thu, Feb 20, 3:45 PM"). Used for auto-renewal info. */
export const formatShortDateTime = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return 'Invalid Date';
  }
};

/** Calculate duration from a start time to now (e.g. "2m 15s"). */
export const calculateDuration = (startedAt: string | null | undefined): string => {
  if (!startedAt) return '0m 0s';
  try {
    const start = new Date(startedAt).getTime();
    if (isNaN(start)) return '0m 0s';
    const diff = Date.now() - start;
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  } catch {
    return '0m 0s';
  }
};
