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

  constructor(opts: DetectorOptions) {
    this.opts = opts;
  }

  get currentPhase(): Phase {
    return this.phase;
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
  build(samples: Sample[], ci: number, runways: RunwayEnd[], touchAndGo: boolean, bounces: number, simVs: number | null): LandingRecord {
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

    const vs = simVs ?? before.vs;
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
        peakG: Math.round(peakG * 100) / 100,
        touchdownIasKt: Math.round(contact.ias),
        touchdownGsKt: Math.round(contact.gs),
        pitchDeg: round1(contact.pitch),
        bankDeg: round1(contact.bank),
        crabDeg: round1(crab),
        headwindKt: round1(wind.head),
        crosswindKt: round1(wind.cross),
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

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Resample to a fixed 5 Hz grid from 30 s before contact to the end of the rollout (max 25 s). */
export function buildTrace(samples: Sample[], contactT: number, runway: RunwayEnd | null): LandingTrace {
  const tr: LandingTrace = { t: [], agl: [], vs: [], pitch: [], ias: [], elevator: [], g: [], centerline: [] };
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
    tr.centerline.push(runway && s.onGround ? round1(runwayRelative(runway, s.lat, s.lon).cross) : null);
  }
  return tr;
}
