/// <reference types="@microsoft/msfs-types/js/simvar" />
import type { Sample } from '../core/types.ts';

/**
 * Reads the aircraft state from SimVars at a fixed rate and normalises signs to the core
 * conventions (see core/types.ts).
 *
 * VERIFY IN SIM: sign of PLANE BANK DEGREES and YOKE Y POSITION. The constants below are set
 * from the SimVar docs; flip them if the Live page shows the wrong direction.
 */
const PITCH_SIGN = -1; // PLANE PITCH DEGREES is negative when the nose is up.
const BANK_SIGN = -1; // PLANE BANK DEGREES is positive for a left bank; core uses right-wing-down positive.
const YOKE_SIGN = 1; // YOKE Y POSITION: +1 = full pull (verify).

export class SimVarSampler {
  private timer: number | null = null;
  private timerHz = 0;
  private lastT = -1;

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
    this.onSample({
      t,
      agl: g('PLANE ALT ABOVE GROUND MINUS CG', 'feet'),
      vs: g('VERTICAL SPEED', 'feet per minute'),
      ias: g('AIRSPEED INDICATED', 'knots'),
      gs: g('GROUND VELOCITY', 'knots'),
      pitch: PITCH_SIGN * g('PLANE PITCH DEGREES', 'degrees'),
      bank: BANK_SIGN * g('PLANE BANK DEGREES', 'degrees'),
      heading: g('PLANE HEADING DEGREES TRUE', 'degrees'),
      track: g('GPS GROUND TRUE TRACK', 'degrees'),
      g: g('G FORCE', 'GForce'),
      elevator: YOKE_SIGN * g('YOKE Y POSITION', 'position'),
      onGround: g('SIM ON GROUND', 'bool') === 1,
      lat: g('PLANE LATITUDE', 'degrees'),
      lon: g('PLANE LONGITUDE', 'degrees'),
      windDir: g('AMBIENT WIND DIRECTION', 'degrees'),
      windSpd: g('AMBIENT WIND VELOCITY', 'knots'),
    });
  }
}
