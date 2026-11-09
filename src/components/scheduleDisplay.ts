import type { OfficeSchedule } from '../types';

const dateTime = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export function formatScheduleTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return dateTime.format(new Date(value));
}
/** "in 5 min", "in 3 h", "in 2 days", or "now" when due. */
export function formatUntil(value: string | null, now = Date.now()): string {
  if (!value) return '';
  const minutes = Math.round((Date.parse(value) - now) / 60_000);
  if (minutes <= 0) return 'due now';
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 1440) return `in ${Math.round(minutes / 60)} h`;
  return `in ${Math.round(minutes / 1440)} days`;
}
/** Enabled schedules ordered by their next run. */
export function upcomingSchedules(schedules: OfficeSchedule[]): OfficeSchedule[] {
  return schedules.filter(item => item.enabled && item.nextRunAt).sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!));
}

