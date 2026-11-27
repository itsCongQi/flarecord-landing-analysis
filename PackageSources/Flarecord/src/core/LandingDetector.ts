import { detectFlare } from './flare.ts';
import { angleDiff, matchRunway, runwayRelative, windComponents } from './geo.ts';
import { scoreLanding } from './score.ts';
import type { LandingRecord, LandingTrace, RunwayEnd, Sample, TouchdownGeometry } from './types.ts';

export interface DetectorOptions {
  /** Returns runway ends near a position. May be slow (facility lookups), so it is async. */
  findRunways?: (lat: number, lon: number) => Promise<RunwayEnd[]>;
  /** Called once per finished landing. */
  onLanding: (rec: LandingRecord) => void;
  /** Optional sim-provided touchdown sink rate in fpm (negative = down), read at contact. */
  simTouchdownVs?: () => number | null;
  aircraftName?: () => string;
  now?: () => number;
}

type Phase = 'idle' | 'armed' | 'rollout';

const HISTORY_S = 120;
const TRACE_BEFORE_S = 30;
const TRACE_AFTER_MAX_S = 25;
const TRACE_STEP_S = 0.2;
const ARM_MIN_AIRBORNE_S = 5;
const ARM_MIN_AGL_FT = 50;
/** Window before contact over which the average sink rate is fitted, seconds. */
export const FIT_WINDOW_S = 0.5;
/** How long after contact the sampler is asked to keep its fast rate, seconds. */
const FAST_AFTER_CONTACT_S = 3;
/** Sampling rates asked of the sampler, Hz. See LandingDetector.wantedRateHz. */
export const RATE_FAST_HZ = 60;
export const RATE_NORMAL_HZ = 20;
export const RATE_RELAXED_HZ = 4;
/** Above this height (or on the ground) with no landing in progress, the relaxed rate is enough, feet. */
const RELAXED_ABOVE_AGL_FT = 1500;

/**
 * Turns a stream of samples into landing records.
 *
 *  idle    -> armed    airborne below 200 ft AGL and descending, after a real flight: airborne
 *                      without a break for at least 5 s and above 50 ft at some point since
 *                      the wheels last touched (so spawn settling and ground jitter on
 *                      SIM ON GROUND never arm it)
 *  armed   -> idle     climbs back above 500 ft (go-around)
 *  armed   -> rollout  first wheel contact
 *  rollout -> idle     ground speed below 30 kt, 90 s on the ground, or a touch-and-go climb past 100 ft
 */
export class LandingDetector {
  private readonly opts: DetectorOptions;
  private history: Sample[] = [];
  private phase: Phase = 'idle';
  private contactIdx = -1;
  private contactSimVs: number | null = null;
  private runwayPromise: Promise<RunwayEnd[]> | null = null;
  private bounces = 0;
  private airborneSince: number | null = null;
  /** Start of the current airborne stretch (null while on the ground), for arming. */
  private flightSince: number | null = null;
  /** Highest AGL since the wheels last touched, for arming. */
  private maxAglSinceGround = 0;
  /** Height reading with the aircraft standing on its wheels, feet (null until seen). */
  private parkedOffset: number | null = null;

  constructor(opts: DetectorOptions) {
    this.opts = opts;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /**
   * True while a touchdown is close or has just happened: the sampler runs at its fast rate then,
   * so the contact instant and the load peak are caught more closely.
   */
  get wantsFastSampling(): boolean {
    if (this.phase === 'armed') return true;
    if (this.phase !== 'rollout' || this.contactIdx < 0) return false;
    return this.history[this.history.length - 1].t - this.history[this.contactIdx].t < FAST_AFTER_CONTACT_S;
  }

  /**
   * How often the sampler should read the sim, Hz. The work done on the sim's UI thread follows
   * this, so it is kept as low as each stage needs:
   *
   *   fast     armed, and for a few seconds after contact: the contact instant and the load peak
   *   relaxed  nothing in progress, and on the ground or well above it (taxi, climb, cruise):
   *            only arming is watched, which needs seconds, not milliseconds
   *   normal   everything else: low approach before arming, and the rest of the rollout
   */
  get wantedRateHz(): number {
    if (this.wantsFastSampling) return RATE_FAST_HZ;
    const last = this.history[this.history.length - 1];
    if (this.phase === 'idle' && last && (last.onGround || last.agl > RELAXED_ABOVE_AGL_FT)) return RATE_RELAXED_HZ;
    return RATE_NORMAL_HZ;
  }

  reset(): void {
    this.history = [];
    this.phase = 'idle';
    this.contactIdx = -1;
    this.runwayPromise = null;
    this.bounces = 0;
    this.airborneSince = null;
    this.flightSince = null;
    this.maxAglSinceGround = 0;
    this.parkedOffset = null;
  }

  push(s: Sample): void {
    const prev = this.history[this.history.length - 1];
    // Time went backwards or jumped (flight reloaded, slew, replay): start over.
    if (prev && (s.t < prev.t || s.t - prev.t > 5)) this.reset();
    this.history.push(s);

    if (this.phase !== 'rollout') {
      // Drop old history while not in a landing.
      const cutoff = s.t - HISTORY_S;
      let drop = 0;
      while (drop < this.history.length && this.history[drop].t < cutoff) drop++;
      if (drop > 0) this.history.splice(0, drop);
    }

    if (s.onGround) {
      this.flightSince = null;
      this.maxAglSinceGround = 0;
      // Standing or taxiing slowly: note what the height reads with the wheels on the ground.
      // Smoothed over about a second of standing still, whatever the sampling rate.
      if (s.gs < 5) {
        const k = prev ? Math.min(1, Math.max(0, s.t - prev.t)) : 1;
        this.parkedOffset = this.parkedOffset === null ? s.agl : this.parkedOffset + k * (s.agl - this.parkedOffset);
      }
    } else {
      if (this.flightSince === null) this.flightSince = s.t;
      this.maxAglSinceGround = Math.max(this.maxAglSinceGround, s.agl);
    }

    switch (this.phase) {
      case 'idle': {
        const realFlight = this.flightSince !== null && s.t - this.flightSince >= ARM_MIN_AIRBORNE_S && this.maxAglSinceGround >= ARM_MIN_AGL_FT;
        if (!s.onGround && realFlight && s.agl < 200 && s.vs < 0) this.phase = 'armed';
        break;
      }
      case 'armed':
        if (!s.onGround && s.agl > 500) this.phase = 'idle';
        else if (s.onGround) this.onContact();
        break;
      case 'rollout':
        this.onRolloutSample(s);
        break;
    }
  }

  private onContact(): void {
    this.phase = 'rollout';
    this.contactIdx = this.history.length - 1;
    this.bounces = 0;
    this.airborneSince = null;
    this.contactSimVs = this.opts.simTouchdownVs?.() ?? null;
    const c = this.history[this.contactIdx];
    this.runwayPromise = this.opts.findRunways ? this.opts.findRunways(c.lat, c.lon).catch(() => []) : null;
  }

  private onRolloutSample(s: Sample): void {
    const contactT = this.history[this.contactIdx].t;
    if (!s.onGround) {
      if (this.airborneSince === null) this.airborneSince = s.t;
      if (s.agl > 100) return void this.finish(true);
    } else if (this.airborneSince !== null) {
      // Back on the ground: it was a bounce if we were airborne for a meaningful moment.
      if (s.t - this.airborneSince >= 0.2) this.bounces++;
      this.airborneSince = null;
    }
    if ((s.onGround && s.gs < 30) || s.t - contactT > 90) this.finish(false);
  }

  private finish(touchAndGo: boolean): void {
    const samples = this.history;
    const ci = this.contactIdx;
    const runwaysP = this.runwayPromise ?? Promise.resolve([]);
    const simVs = this.contactSimVs;
    this.phase = 'idle';
    this.history = samples.slice(-5);
    this.contactIdx = -1;
    this.runwayPromise = null;
    const bounces = this.bounces;
    void runwaysP.then((runways) => {
      this.opts.onLanding(this.build(samples, ci, runways, touchAndGo, bounces, simVs));
    });
  }

  /** Build the record. Public for tests. */
  build(raw: Sample[], ci: number, runways: RunwayEnd[], touchAndGo: boolean, bounces: number, simVs: number | null): LandingRecord {
    // Zero the height for this aircraft, so 0 ft is wheels on the ground whatever the airframe.
    const offset = groundOffset(raw, ci, this.parkedOffset);
    const samples = offset === 0 ? raw : raw.map((s) => ({ ...s, agl: s.agl - offset }));
    const contact = samples[ci];
    const before = samples[Math.max(0, ci - 1)];
    const contactT = contact.t;

    // Approach window: airborne samples from ~100 ft down to contact.
    let start = ci - 1;
    while (start > 0 && samples[start - 1].agl <= 110 && !samples[start - 1].onGround) start--;
    const approach = samples.slice(start, ci);
    const flare = detectFlare(approach);

    let peakG = 0;
    for (const s of samples) if (s.t >= contactT - 0.1 && s.t <= contactT + 1.0) peakG = Math.max(peakG, s.g);

    // The headline figure is the sim's own value at contact. Without it, the fitted average over
    // the last half second is steadier than one vertical speed sample and follows runway slope.
    const avgVs = fitSinkRate(samples, ci);
    const vs = simVs ?? avgVs ?? before.vs;
    const vsSource = simVs !== null ? 'sim' : avgVs !== null ? 'fit' : 'sample';
    const crab = angleDiff(contact.heading, contact.track);
    const wind = windComponents(contact.windDir, contact.windSpd, contact.heading);

    const runway = matchRunway(runways, contact.lat, contact.lon, contact.track);
    let geometry: TouchdownGeometry | null = null;
    if (runway) {
      const rel = runwayRelative(runway, contact.lat, contact.lon);
      geometry = {
        runway,
        distFromThresholdM: rel.along,
        centerlineOffsetM: rel.cross,
        inTouchdownZone: rel.along >= 150 && rel.along <= 900,
      };
    }

    const score = scoreLanding({
      touchdownVsFpm: vs,
      peakG,
      bankDeg: contact.bank,
      pitchDeg: contact.pitch,
      crabDeg: crab,
      crosswindKt: wind.cross,
      bounces,
      flare,
      geometry,
    });

    const now = this.opts.now?.() ?? Date.now();
    return {
      summary: {
        id: `${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
        recordedAt: now,
        aircraft: this.opts.aircraftName?.() ?? 'Unknown aircraft',
        touchdownVsFpm: Math.round(vs),
        avgVsFpm: avgVs === null ? null : Math.round(avgVs),
        vsSource,
        aglOffsetFt: round1(offset),
        peakG: Math.round(peakG * 100) / 100,
        touchdownIasKt: Math.round(contact.ias),
        touchdownGsKt: Math.round(contact.gs),
        pitchDeg: round1(contact.pitch),
        bankDeg: round1(contact.bank),
        crabDeg: round1(crab),
        headwindKt: round1(wind.head),
        crosswindKt: round1(wind.cross),
        windDirDeg: Math.round(contact.windDir),
        windKt: Math.round(contact.windSpd),
        bounces,
        touchAndGo,
        flare,
        geometry,
        score,
      },
      trace: buildTrace(samples, contactT, runway),
    };
  }
}

/**
 * Average sink rate over the last half second before contact, fpm (negative = down): the slope of
 * the least-squares straight line through height against time, contact sample included. Height is
 * measured to the ground under the aircraft, so the result follows a sloping runway. Null when
 * there are too few samples to fit.
 */
export function fitSinkRate(samples: Sample[], ci: number, windowS = FIT_WINDOW_S): number | null {
  const contactT = samples[ci].t;
  let from = ci;
  while (from > 0 && samples[from - 1].t >= contactT - windowS - 1e-6 && !samples[from - 1].onGround) from--;
  const n = ci - from + 1;
  if (n < 4) return null;
  let st = 0;
  let sh = 0;
  for (let i = from; i <= ci; i++) {
    st += samples[i].t - contactT;
    sh += samples[i].agl;
  }
  const mt = st / n;
  const mh = sh / n;
  let num = 0;
  let den = 0;
  for (let i = from; i <= ci; i++) {
    const dt = samples[i].t - contactT - mt;
    num += dt * (samples[i].agl - mh);
    den += dt * dt;
  }
  return den > 0 ? (num / den) * 60 : null;
}

/**
 * What the height reads with the wheels on the ground, feet. Taken from the settled part of the
 * rollout of this landing (median, from 1 s after contact), else from the last time the aircraft
 * stood still before the flight, else from the contact sample itself.
 */
export function groundOffset(samples: Sample[], ci: number, parked: number | null): number {
  const contactT = samples[ci].t;
  const settled: number[] = [];
  for (let i = ci; i < samples.length; i++) if (samples[i].onGround && samples[i].t >= contactT + 1) settled.push(samples[i].agl);
  if (settled.length >= 5) {
    settled.sort((a, b) => a - b);
    return settled[Math.floor(settled.length / 2)];
  }
  return parked ?? samples[ci].agl;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Resample to a fixed 5 Hz grid from 30 s before contact to the end of the rollout (max 25 s). */
export function buildTrace(samples: Sample[], contactT: number, runway: RunwayEnd | null): LandingTrace {
  const tr: LandingTrace = { t: [], agl: [], vs: [], pitch: [], ias: [], elevator: [], g: [], centerline: [], along: [] };
  const endT = Math.min(samples[samples.length - 1].t, contactT + TRACE_AFTER_MAX_S);
  let j = 0;
  for (let t = Math.max(samples[0].t, contactT - TRACE_BEFORE_S); t <= endT + 1e-6; t += TRACE_STEP_S) {
    while (j < samples.length - 1 && samples[j + 1].t <= t) j++;
    const s = samples[j];
    tr.t.push(Math.round((t - contactT) * 10) / 10);
    tr.agl.push(round1(Math.max(0, s.agl)));
    tr.vs.push(Math.round(s.vs));
    tr.pitch.push(round1(s.pitch));
    tr.ias.push(Math.round(s.ias));
    tr.elevator.push(Math.round(s.elevator * 100) / 100);
    tr.g.push(Math.round(s.g * 100) / 100);
    // The whole ground track relative to the runway, approach included, for the runway view.
    const rel = runway ? runwayRelative(runway, s.lat, s.lon) : null;
    tr.centerline.push(rel ? round1(rel.cross) : null);
    tr.along!.push(rel ? Math.round(rel.along) : null);
  }
  return tr;
}
