import type { LandingSummary } from '../core/types.ts';

export const gradeClass = (g: LandingSummary['score']['grade']): string => `la-grade-${g.toLowerCase()}`;

export function fmtVs(fpm: number): string {
  return `${fpm > 0 ? '+' : ''}${fpm} fpm`;
}

export function fmtWhen(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function where(s: LandingSummary): string {
  return s.geometry ? `${s.geometry.runway.airportIdent} RWY ${s.geometry.runway.designation}` : 'Runway not identified';
}

/** One plain-language coaching line, picked from the weakest scored category. */
export function coachingTip(s: LandingSummary): string {
  if (s.bounces > 0) return 'Bounced: hold the flare attitude after contact instead of releasing back pressure.';
  if (s.flare.method === 'none') return 'No flare detected: start raising the nose around 20 to 30 ft to reduce the sink rate.';
  if (s.flare.floatTimeS > 4) return `Floated ${s.flare.floatTimeS.toFixed(1)} s: reduce power earlier or flare a little later.`;
  const weakest = [...s.score.parts].sort((a, b) => a.points / a.max - b.points / b.max)[0];
  if (!weakest || weakest.points / weakest.max > 0.9) return 'Clean landing. Repeat it!';
  switch (weakest.key) {
    case 'sink':
      return 'Firm touchdown: begin the flare slightly earlier and keep it smooth.';
    case 'g':
      return 'High load on contact: aim for a steadier sink rate in the last 10 ft.';
    case 'tdz':
      return (s.geometry?.distFromThresholdM ?? 0) < 250 ? 'Landed short of the aiming point: keep the glide path until the flare.' : 'Landed long: aim for the 300 m markers and avoid a long float.';
    case 'cl':
      return 'Off the centreline: line up earlier and use rudder to track the centreline in the flare.';
    case 'align':
      return 'Crabbed at touchdown: kick out the crab with rudder just before contact.';
    case 'att':
      return 'Attitude: level the wings (or hold only the bank needed for crosswind) and keep the nose up.';
    default:
      return 'Review the graphs to see where the approach changed.';
  }
}
