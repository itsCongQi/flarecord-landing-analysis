import type { LandingSummary } from '../core/types.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (x: number) => (x < 10 ? '0' : '') + x;

/** "18 Nov 21:14" in local time. Built by hand: Coherent's locale formatting is unreliable. */
export function fmtWhen(ms: number, withYear = false): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() + ',' : ''} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * "just now", "5 minutes ago", "3 hours ago", then whole days from one day on. A time in the
 * future (a clock change) reads as "just now".
 */
export function fmtAgo(ms: number, now: number = Date.now()): string {
  const min = Math.floor((now - ms) / 60000);
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'} ago`;
  if (min < 1) return 'just now';
  if (min < 60) return n(min, 'minute');
  if (min < 1440) return n(Math.floor(min / 60), 'hour');
  return n(Math.floor(min / 1440), 'day');
}

export function airport(s: LandingSummary): string {
  return s.geometry ? s.geometry.runway.airportIdent : '';
}

/** "KSEA 16L", or a plain note when no runway was matched. */
export function where(s: LandingSummary): string {
  return s.geometry ? `${s.geometry.runway.airportIdent} ${s.geometry.runway.designation}` : 'No runway';
}

/** Value with an L/R side instead of a sign, e.g. "2.8", "R". */
export function sided(v: number, digits: number): { value: string; side: string } {
  const value = Math.abs(v).toFixed(digits);
  return { value, side: Number(value) === 0 ? '' : v > 0 ? 'R' : 'L' };
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
