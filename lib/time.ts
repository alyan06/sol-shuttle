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

export function formatClock(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ms);
}
