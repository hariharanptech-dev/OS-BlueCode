export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  private t: number;
  constructor(start: Date | string | number = '2026-01-15T10:00:00.000Z') {
    this.t = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
  advanceMinutes(m: number): void {
    this.advance(m * 60_000);
  }
  advanceDays(d: number): void {
    this.advance(d * 86_400_000);
  }
  set(d: Date | string): void {
    this.t = new Date(d).getTime();
  }
}
