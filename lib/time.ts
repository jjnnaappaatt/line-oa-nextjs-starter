/**
 * Timezone / calendar helpers for the reminder engine and the bot.
 *
 * All day-granular comparisons are done in ONE fixed local timezone, expressed as a UTC offset
 * (default +7 = Asia/Bangkok). We shift `now` by the offset and read the UTC field, so a "civil day"
 * is an exact UTC-midnight instant — no DST, no host-timezone surprises on serverless.
 *
 * Set `REMINDER_UTC_OFFSET_HOURS` to relocate (e.g. 9 for Asia/Tokyo, -5 for US Eastern standard).
 * A fractional offset (e.g. 5.5 for India) works too.
 */
export function offsetHours(): number {
  const v = Number(process.env.REMINDER_UTC_OFFSET_HOURS);
  return Number.isFinite(v) ? v : 7;
}

function shifted(now: Date): Date {
  return new Date(now.getTime() + offsetHours() * 3600 * 1000);
}

/** Local calendar parts (year, 1-based month, day) at the configured offset. */
export function localParts(now: Date): { y: number; m: number; d: number } {
  const b = shifted(now);
  return { y: b.getUTCFullYear(), m: b.getUTCMonth() + 1, d: b.getUTCDate() };
}

/** Local civil-day midnight as a UTC instant — the basis for exact day-granular spacing. */
export function asOfCivil(now: Date): Date {
  const p = localParts(now);
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}

/** Whole days between two instants (floor). */
export function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

/** Local hour (0–23) — the cron route gates delivery to the configured send hour with this. */
export function localHour(now: Date): number {
  return shifted(now).getUTCHours();
}

/** ISO report month "YYYY-MM" for the local current month. */
export function currentReportMonth(now: Date): string {
  const p = localParts(now);
  return `${p.y}-${String(p.m).padStart(2, "0")}`;
}

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** UTC-midnight instant of the submission deadline for a report month (clamped to the month length). */
export function deadlineDate(rm: string, deadlineDay: number): Date {
  const [y, m] = rm.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(deadlineDay || 25, lastDay)));
}

/** Human label for a report month, e.g. "Jul 2026". */
export function monthLabel(rm: string): string {
  const [y, m] = rm.split("-").map(Number);
  return `${MONTHS[m]} ${y}`;
}

/** Human label for a deadline date, e.g. "25 Jul 2026". */
export function deadlineLabel(rm: string, deadlineDay: number): string {
  const d = deadlineDate(rm, deadlineDay);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth() + 1]} ${d.getUTCFullYear()}`;
}
