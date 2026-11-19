import type { LandingSummary } from '../core/types.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (x: number) => (x < 10 ? '0' : '') + x;

/** "18 Nov 21:14" in local time. Built by hand: Coherent's locale formatting is unreliable. */
export function fmtWhen(ms: number, withYear = false): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() + ',' : ''} ${two(d.getHours())}:${two(d.getMinutes())}`;
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
