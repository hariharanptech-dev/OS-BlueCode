export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
const DAY_MS = 86_400_000;
/** UTC arithmetic: exactly N*24h. No local time, no DST, no calendar-month ambiguity. */
export function addDaysUtc(date: Date, days: number): Date {
  if (!Number.isInteger(days) || days <= 0) throw new RangeError('days must be a positive integer');
  return new Date(date.getTime() + days * DAY_MS);
}
