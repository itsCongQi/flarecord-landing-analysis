import type { FlareInfo, Sample } from './types.ts';

/** Centred moving average over a time window (seconds). */
export function smooth(samples: Sample[], pick: (s: Sample) => number, windowS: number): number[] {
  const out: number[] = new Array(samples.length);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = samples[i].t;
    while (hi < samples.length && samples[hi].t <= t + windowS / 2) sum += pick(samples[hi++]);
    while (samples[lo].t < t - windowS / 2) sum -= pick(samples[lo++]);
    out[i] = sum / (hi - lo);
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Find where the flare began.
 *
 * `approach` is every airborne sample from about 100 ft AGL down to the last sample before
 * first contact, in time order.
 *
 * Method (this addon's own design):
 *  1. Reference attitude = mean pitch between 100 ft and 50 ft (the stabilised approach attitude).
 *  2. Primary, attitude based: walking back from touchdown, the flare starts right after the
 *     last moment the smoothed pitch was still within 0.5 deg of the reference. A flare only
 *     counts if the aircraft touched down at least 1 deg above the reference and the marker is
 *     below 60 ft.
 *  3. Fallback, input based (for aircraft that flare with very little pitch change): the start of
 *     the final sustained pull, i.e. where smoothed elevator input last crossed 35% of the way
 *     from its approach baseline to its peak before touchdown.
 */
export function detectFlare(approach: Sample[]): FlareInfo {
  const none: FlareInfo = {
    flareHeightFt: null,
    flareDurationS: null,
    vsAtFlareFpm: null,
    pitchChangeDeg: null,
    floatTimeS: 0,
    approachPitchDeg: null,
    method: 'none',
  };
  if (approach.length < 5) return none;

  const last = approach[approach.length - 1];
  const contactT = last.t;

  let floatStart = contactT;
  for (let i = approach.length - 1; i >= 0 && approach[i].agl < 5; i--) floatStart = approach[i].t;
  const floatTimeS = contactT - floatStart;

  const refBand = approach.filter((s) => s.agl >= 50 && s.agl <= 100);
  const refSamples = refBand.length >= 3 ? refBand : approach.slice(0, Math.max(3, Math.floor(approach.length / 4)));
  const refPitch = mean(refSamples.map((s) => s.pitch));
  const refElev = mean(refSamples.map((s) => s.elevator));

  const pitchS = smooth(approach, (s) => s.pitch, 0.5);
  const elevS = smooth(approach, (s) => s.elevator, 0.5);

  const result = (idx: number, method: FlareInfo['method']): FlareInfo => ({
    flareHeightFt: approach[idx].agl,
    flareDurationS: contactT - approach[idx].t,
    vsAtFlareFpm: approach[idx].vs,
    pitchChangeDeg: pitchS[pitchS.length - 1] - refPitch,
    floatTimeS,
    approachPitchDeg: refPitch,
    method,
  });

  // 1. Attitude based.
  const pitchAtContact = pitchS[pitchS.length - 1];
  if (pitchAtContact - refPitch >= 1.0) {
    let idx = -1;
    for (let i = pitchS.length - 1; i >= 0; i--) {
      if (pitchS[i] <= refPitch + 0.5) {
        idx = Math.min(i + 1, pitchS.length - 1);
        break;
      }
    }
    if (idx >= 0 && approach[idx].agl <= 60) return result(idx, 'pitch');
  }

  // 2. Input based.
  let peakIdx = 0;
  for (let i = 1; i < elevS.length; i++) if (elevS[i] > elevS[peakIdx]) peakIdx = i;
  const rise = elevS[peakIdx] - refElev;
  if (rise >= 0.08) {
    const level = refElev + 0.35 * rise;
    for (let i = peakIdx; i >= 0; i--) {
      if (elevS[i] <= level) {
        const idx = Math.min(i + 1, peakIdx);
        if (approach[idx].agl <= 60) return result(idx, 'input');
        break;
      }
    }
  }

  return { ...none, floatTimeS, approachPitchDeg: refPitch, pitchChangeDeg: pitchAtContact - refPitch };
}
