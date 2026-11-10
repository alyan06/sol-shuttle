/** Tempe does not observe daylight saving, so the offset is fixed all year. */
const TEMPE_OFFSET_MS = -7 * 3_600_000;

function shifted(ms: number): Date {
  return new Date(ms + TEMPE_OFFSET_MS);
}

export function tempeDayKey(ms: number): string {
  return shifted(ms).toISOString().slice(0, 10);
}

export function tempeWeekday(ms: number): number {
  return shifted(ms).getUTCDay();
}

export function tempeSecondOfDay(ms: number): number {
  const d = shifted(ms);
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}

/** The instant of the most recent midnight in Tempe. */
export function tempeMidnight(ms: number): number {
  return ms - tempeSecondOfDay(ms) * 1000 - (ms % 1000);
}

export function tempeMinuteOfDay(ms: number): number {
  const d = shifted(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** A clock time, with the weekday in front when it isn't today in Tempe. */
export function formatSince(ms: number, now: number): string {
  if (tempeDayKey(ms) === tempeDayKey(now)) return formatClock(ms);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', weekday: 'short' }).format(ms);
  return `${day} ${formatClock(ms)}`;
}

/** Minutes after midnight to the "HH:MM" a time input wants, and back. */
export function minuteToInput(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function inputToMinute(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function formatClock(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ms);
}
