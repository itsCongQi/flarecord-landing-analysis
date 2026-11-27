import { angleDiff } from './geo.ts';
import { buildTakeoff, CLIMB_MAX_S, CLIMB_TOP_FT, FINE_AFTER_S } from './takeoff.ts';
import type { RunwayEnd, Sample, TakeoffRecord } from './types.ts';

export interface TakeoffDetectorOptions {
  findRunways?: (lat: number, lon: number) => Promise<RunwayEnd[]>;
  onTakeoff: (rec: TakeoffRecord) => void;
  aircraftName?: () => string;
  now?: () => number;
}

type Phase = 'idle' | 'roll' | 'climb';

/** Ground samples kept while nothing is happening, so the record can begin where the roll did, seconds. */
const GROUND_KEEP_S = 40;
/** The roll is noticed when ground speed passes this while still rising, kt. */
const ROLL_GS_KT = 30;
/** A roll that reached this speed and then slowed below ROLL_GS_KT is a rejected takeoff, kt. */
const REJECT_GS_KT = 50;
/** Leaving the ground counts as liftoff after this long in the air, seconds. */
const AIRBORNE_S = 0.5;
/** Wheels on the ground at least this long before liftoff, so a bounce on landing is not a takeoff, seconds. */
const MIN_ROLL_S = 3;
const ROLL_MAX_S = 180;
const RATE_NORMAL_HZ = 20;
const RATE_RELAXED_HZ = 4;

/**
 * Turns a stream of samples into takeoff records. It runs beside the LandingDetector on the same
 * samples and keeps its own state.
 *
 *  idle  -> roll   on the ground, ground speed above 30 kt and rising
 *  roll  -> climb  in the air for half a second, after at least 3 s on the ground
 *  roll  -> idle   slowed below 30 kt: saved as a rejected takeoff if it had passed 50 kt on a runway
 *  climb -> idle   3,000 ft above the liftoff point, 3 minutes after liftoff, or back on the ground: saved
 */
export class TakeoffDetector {
  private readonly opts: TakeoffDetectorOptions;
  private phase: Phase = 'idle';
  /** Idle: the last seconds on the ground. Roll and climb: every sample from the start of the roll. */
  private fine: Sample[] = [];
  private climb: Sample[] = [];
  private liftoff = -1;
  private airborneAt = -1;
  private peakGs = 0;
  private maxAgl = 0;
  private groundAgl = 0;
  private touchAndGo = false;
  /** The ground buffer begins right after a flight (a landing in progress). */
  private afterFlight = false;
  private runwayPromise: Promise<RunwayEnd[]> | null = null;
  private lastT = -1;

  constructor(opts: TakeoffDetectorOptions) {
    this.opts = opts;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /**
   * How often the sampler should read the sim for this detector, Hz: the normal rate for the roll
   * and the first seconds in the air, the relaxed rate otherwise (the climb is kept at one sample
   * a second). The fast rate used around a touchdown is never needed.
   */
  get wantedRateHz(): number {
    if (this.phase === 'roll') return RATE_NORMAL_HZ;
    if (this.phase === 'climb' && this.lastT - this.fine[this.liftoff].t <= FINE_AFTER_S) return RATE_NORMAL_HZ;
    return RATE_RELAXED_HZ;
  }

  reset(): void {
    this.phase = 'idle';
    this.fine = [];
    this.climb = [];
    this.liftoff = -1;
    this.airborneAt = -1;
    this.afterFlight = false;
    this.runwayPromise = null;
  }

  push(s: Sample): void {
    // Time went backwards or jumped (flight reloaded, slew, replay): start over.
    if (this.lastT >= 0 && (s.t < this.lastT || s.t - this.lastT > 5)) this.reset();
    this.lastT = s.t;
    if (this.phase === 'idle') this.onIdle(s);
    else if (this.phase === 'roll') this.onRoll(s);
    else this.onClimb(s);
  }

  private onIdle(s: Sample): void {
    if (!s.onGround) {
      this.fine = [];
      this.afterFlight = true;
      return;
    }
    this.fine.push(s);
    let drop = 0;
    while (drop < this.fine.length && this.fine[drop].t < s.t - GROUND_KEEP_S) drop++;
    if (drop > 0) {
      this.fine.splice(0, drop);
      this.afterFlight = false;
    }
    if (s.gs < ROLL_GS_KT) return;
    // Rising: at least 1 kt faster than a second ago.
    let before: Sample | null = null;
    for (let i = this.fine.length - 2; i >= 0; i--) {
      if (s.t - this.fine[i].t >= 1 - 1e-3) {
        before = this.fine[i];
        break;
      }
    }
    if (!before || s.gs - before.gs < 1) return;

    // The roll began where the aircraft last stood still, or where it lined up on this heading.
    let start = this.fine.length - 1;
    while (start > 0 && this.fine[start - 1].gs >= 3 && Math.abs(angleDiff(this.fine[start - 1].heading, s.heading)) <= 10) start--;
    this.touchAndGo = start === 0 && this.afterFlight && this.fine[0].gs >= ROLL_GS_KT;
    this.fine = this.fine.slice(start);
    this.afterFlight = false;
    this.phase = 'roll';
    this.peakGs = s.gs;
    this.airborneAt = -1;
    this.groundAgl = s.agl;
    this.runwayPromise = this.opts.findRunways ? this.opts.findRunways(s.lat, s.lon).catch(() => []) : null;
  }

  private onRoll(s: Sample): void {
    this.fine.push(s);
    if (!s.onGround) {
      if (this.airborneAt < 0) this.airborneAt = this.fine.length - 1;
      const first = this.fine[this.airborneAt];
      if (s.t - first.t < AIRBORNE_S) return;
      if (first.t - this.fine[0].t < MIN_ROLL_S) return void this.reset();
      this.phase = 'climb';
      this.liftoff = this.airborneAt;
      this.climb = [first];
      this.maxAgl = 0;
      return;
    }
    this.airborneAt = -1;
    this.groundAgl = s.agl;
    this.peakGs = Math.max(this.peakGs, s.gs);
    if (s.gs < ROLL_GS_KT || s.t - this.fine[0].t > ROLL_MAX_S) {
      if (this.peakGs >= REJECT_GS_KT && s.gs < ROLL_GS_KT) this.finish(true);
      else {
        // A fast taxi or a roll too short to count: keep watching from here.
        this.phase = 'idle';
        this.fine = this.fine.slice(-1);
      }
    }
  }

  private onClimb(s: Sample): void {
    const lo = this.fine[this.liftoff];
    if (s.t - lo.t <= FINE_AFTER_S) this.fine.push(s);
    const lastC = this.climb[this.climb.length - 1];
    if (s.t - lastC.t >= 1 - 1e-3) this.climb.push(s);
    const h = s.alt !== undefined && lo.alt !== undefined ? s.alt - lo.alt : s.agl - this.groundAgl;
    this.maxAgl = Math.max(this.maxAgl, s.agl - this.groundAgl);
    if (s.onGround) {
      // Back down after a hop of a few feet: a skip on the runway, not a takeoff.
      if (this.maxAgl < 20) return void this.reset();
      return void this.finish(false);
    }
    if (h >= CLIMB_TOP_FT || s.t - lo.t >= CLIMB_MAX_S) {
      if (this.climb[this.climb.length - 1] !== s) this.climb.push(s);
      this.finish(false);
    }
  }

  private finish(rejected: boolean): void {
    const fine = this.fine;
    const climb = this.climb;
    const liftoff = rejected ? -1 : this.liftoff;
    const touchAndGo = this.touchAndGo;
    const runwaysP = this.runwayPromise ?? Promise.resolve([]);
    this.reset();
    void runwaysP.then((runways) => {
      const rec = buildTakeoff({ fine, liftoff, climb, runways, touchAndGo, aircraft: this.opts.aircraftName?.() ?? 'Unknown aircraft', now: this.opts.now?.() ?? Date.now() });
      // A roll that slowed down again counts as a rejected takeoff only on a runway.
      if (rejected && !rec.summary.runway) return;
      this.opts.onTakeoff(rec);
    });
  }
}
