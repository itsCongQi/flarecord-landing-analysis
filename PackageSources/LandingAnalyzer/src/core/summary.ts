/** Figures across many landings, for the Summary page. Descriptive only: medians, not ratings. */
import type { LandingSummary } from './types.ts';

export interface LandingStats {
  count: number;
  medianVs: number;
  medianG: number;
  /** Median distance past the threshold, m, over landings with a runway. */
  medianTdM: number | null;
  /** Median distance from the centreline (either side), m, over landings with a runway. */
  medianClM: number | null;
  medianFlareFt: number | null;
  /** Landings with at least one bounce. */
  bounced: number;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Medians over a set of landings, touch-and-goes excluded. Null when there are none. */
export function summarize(list: readonly LandingSummary[]): LandingStats | null {
  const xs = list.filter((s) => !s.touchAndGo);
  if (xs.length === 0) return null;
  const geo = xs.filter((s) => s.geometry);
  const flares = xs.filter((s) => s.flare.flareHeightFt !== null).map((s) => s.flare.flareHeightFt as number);
  return {
    count: xs.length,
    medianVs: median(xs.map((s) => s.touchdownVsFpm)),
    medianG: median(xs.map((s) => s.peakG)),
    medianTdM: geo.length ? median(geo.map((s) => s.geometry!.distFromThresholdM)) : null,
    medianClM: geo.length ? median(geo.map((s) => Math.abs(s.geometry!.centerlineOffsetM))) : null,
    medianFlareFt: flares.length ? median(flares) : null,
    bounced: xs.filter((s) => s.bounces > 0).length,
  };
}

/** Aircraft in the log with how many landings each has, most flown first. */
export function aircraftCounts(list: readonly LandingSummary[]): { aircraft: string; count: number }[] {
  const out: { aircraft: string; count: number }[] = [];
  for (const s of list) {
    const hit = out.find((o) => o.aircraft === s.aircraft);
    if (hit) hit.count++;
    else out.push({ aircraft: s.aircraft, count: 1 });
  }
  return out.sort((a, b) => b.count - a.count);
}
