/// <reference types="@microsoft/msfs-types/js/simvar" />
import type { PowerKind, Sample } from '../core/types.ts';

/**
 * Reads the aircraft state from SimVars at a fixed rate and normalises signs to the core
 * conventions (see core/types.ts).
 *
 * VERIFY IN SIM: GEAR IS ON GROUND indices (0 nose, 1 left, 2 right), TURB ENG N1 on aircraft with
 * their own engine model, and the sign of PLANE BANK DEGREES and YOKE Y POSITION. The constants below are set
 * from the SimVar docs; flip them if the Live page shows the wrong direction.
 */
const PITCH_SIGN = -1; // PLANE PITCH DEGREES is negative when the nose is up.
const BANK_SIGN = -1; // PLANE BANK DEGREES is positive for a left bank; core uses right-wing-down positive.
const YOKE_SIGN = 1; // YOKE Y POSITION: +1 = full pull (verify).

export class SimVarSampler {
  private timer: number | null = null;
  private timerHz = 0;
  private lastT = -1;
  /** What does not change during a flight, read again every 10 s (the aircraft can be swapped). */
  private craft: { at: number; engines: number; kind: PowerKind | null; rpmVar: string; fixedGear: boolean } = { at: -1e9, engines: 0, kind: null, rpmVar: '', fixedGear: false };

  constructor(
    private readonly onSample: (s: Sample) => void,
    /**
     * The rate wanted right now, Hz. Asked after every tick, and the timer itself is re-armed when
     * the answer changes, so a low rate means few wake-ups, not skipped ones.
     */
    private readonly rate: () => number = () => 20,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.arm(this.wantedHz());
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private wantedHz(): number {
    const hz = this.rate();
    return hz >= 1 && hz <= 60 ? hz : 20;
  }

  private arm(hz: number): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timerHz = hz;
    this.timer = window.setInterval(() => this.tick(), 1000 / hz);
  }

  /** Sink rate the sim itself measured at the last touchdown, fpm, negative = down. */
  static simTouchdownVs(): number | null {
    const fps = SimVar.GetSimVarValue('PLANE TOUCHDOWN NORMAL VELOCITY', 'feet per second') as number;
    return Number.isFinite(fps) && fps !== 0 ? -Math.abs(fps) * 60 : null;
  }

  static aircraftTitle(): string {
    return (SimVar.GetSimVarValue('TITLE', 'string') as string) || 'Unknown aircraft';
  }

  private tick(): void {
    try {
      this.read();
    } finally {
      const hz = this.wantedHz();
      if (this.timer !== null && hz !== this.timerHz) this.arm(hz);
    }
  }

  private read(): void {
    const t = SimVar.GetSimVarValue('E:SIMULATION TIME', 'seconds') as number;
    // Paused, or the sim loop hasn't advanced: nothing new to record.
    if (t === this.lastT) return;
    this.lastT = t;
    const g = (name: string, unit: string) => SimVar.GetSimVarValue(name, unit) as number;
    if (Math.abs(t - this.craft.at) > 10) {
      // ENGINE TYPE: 0 piston, 1 jet, 5 turboprop. Jets are read as N1, propeller aircraft as RPM.
      const type = g('ENGINE TYPE', 'Enum');
      this.craft = {
        at: t,
        engines: Math.max(0, Math.min(4, Math.round(g('NUMBER OF ENGINES', 'number')) || 0)),
        kind: type === 1 ? 'n1' : type === 0 || type === 5 ? 'rpm' : null,
        rpmVar: type === 5 ? 'PROP RPM' : 'GENERAL ENG RPM',
        fixedGear: g('IS GEAR RETRACTABLE', 'bool') !== 1,
      };
    }
    const c = this.craft;
    let power: number | null = null;
    let spread = 0;
    if (c.kind && c.engines > 0) {
      let sum = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 1; i <= c.engines; i++) {
        const v = c.kind === 'n1' ? g(`TURB ENG N1:${i}`, 'percent') : g(`${c.rpmVar}:${i}`, 'rpm');
        sum += v;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      power = sum / c.engines;
      spread = hi - lo;
      if (!Number.isFinite(power)) power = null;
    }
    const onGround = g('SIM ON GROUND', 'bool') === 1;
    const agl = g('PLANE ALT ABOVE GROUND MINUS CG', 'feet');
    // Which wheels are down only matters around the touchdown. GEAR IS ON GROUND: 0 nose, 1 left, 2 right.
    let wow = 0;
    if (onGround || agl < 50) wow = (g('GEAR IS ON GROUND:1', 'bool') === 1 ? 1 : 0) | (g('GEAR IS ON GROUND:2', 'bool') === 1 ? 2 : 0) | (g('GEAR IS ON GROUND:0', 'bool') === 1 ? 4 : 0);
    this.onSample({
      t,
      agl,
      vs: g('VERTICAL SPEED', 'feet per minute'),
      ias: g('AIRSPEED INDICATED', 'knots'),
      gs: g('GROUND VELOCITY', 'knots'),
      pitch: PITCH_SIGN * g('PLANE PITCH DEGREES', 'degrees'),
      bank: BANK_SIGN * g('PLANE BANK DEGREES', 'degrees'),
      heading: g('PLANE HEADING DEGREES TRUE', 'degrees'),
      track: g('GPS GROUND TRUE TRACK', 'degrees'),
      g: g('G FORCE', 'GForce'),
      elevator: YOKE_SIGN * g('YOKE Y POSITION', 'position'),
      onGround,
      lat: g('PLANE LATITUDE', 'degrees'),
      lon: g('PLANE LONGITUDE', 'degrees'),
      windDir: g('AMBIENT WIND DIRECTION', 'degrees'),
      windSpd: g('AMBIENT WIND VELOCITY', 'knots'),
      alt: g('PLANE ALTITUDE', 'feet'),
      power,
      powerSpread: spread,
      powerKind: c.kind,
      gearDown: c.fixedGear || g('GEAR HANDLE POSITION', 'bool') === 1,
      flaps: Math.round(g('FLAPS HANDLE INDEX', 'number')) || 0,
      aoa: g('INCIDENCE ALPHA', 'degrees'),
      wow,
    });
  }
}
