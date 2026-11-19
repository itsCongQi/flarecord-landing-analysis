/**
 * Display units. Landings are always stored in fixed units (distances in metres, heights in
 * feet, vertical speed in fpm, speeds in knots) and converted only when shown, so changing a
 * unit never touches the log.
 */
export interface Settings {
  /** Runway distances: touchdown point, centreline offset, runway length. */
  dist: 'ft' | 'm';
  /** Radio altitude and flare height. */
  height: 'ft' | 'm';
  vs: 'fpm' | 'mps';
  speed: 'kt' | 'kmh';
  /** Show the 0..100 landing index on the Touchdown page. */
  index: boolean;
}

export const DEFAULT_SETTINGS: Settings = { dist: 'ft', height: 'ft', vs: 'fpm', speed: 'kt', index: false };

export const FT_PER_M = 3.280839895;

/** Read settings from stored JSON, falling back to the default for anything missing or invalid. */
export function parseSettings(raw: string | null): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw) return out;
  try {
    const p = JSON.parse(raw) as Partial<Settings>;
    if (p.dist === 'ft' || p.dist === 'm') out.dist = p.dist;
    if (p.height === 'ft' || p.height === 'm') out.height = p.height;
    if (p.vs === 'fpm' || p.vs === 'mps') out.vs = p.vs;
    if (p.speed === 'kt' || p.speed === 'kmh') out.speed = p.speed;
    if (typeof p.index === 'boolean') out.index = p.index;
  } catch {
    // Damaged settings: use the defaults.
  }
  return out;
}

/** Thousands separators without Number.toLocaleString, which Coherent does not format reliably. */
export function group(n: number): string {
  const s = String(Math.abs(Math.round(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return (Math.round(n) < 0 ? '-' : '') + out;
}

/** Converters from the stored unit to the display unit, with the unit label. */
export class Units {
  readonly s: Settings;
  constructor(s: Settings) {
    this.s = s;
  }

  get distUnit(): string {
    return this.s.dist;
  }
  get heightUnit(): string {
    return this.s.height;
  }
  get vsUnit(): string {
    return this.s.vs === 'fpm' ? 'fpm' : 'm/s';
  }
  get speedUnit(): string {
    return this.s.speed === 'kt' ? 'kt' : 'km/h';
  }

  /** Metres to the runway distance unit. */
  dist(m: number): number {
    return this.s.dist === 'ft' ? m * FT_PER_M : m;
  }
  /** Feet to the height unit. */
  height(ft: number): number {
    return this.s.height === 'ft' ? ft : ft / FT_PER_M;
  }
  /** fpm to the vertical speed unit. */
  vs(fpm: number): number {
    return this.s.vs === 'fpm' ? fpm : fpm * 0.00508;
  }
  /** Knots to the speed unit. */
  speed(kt: number): number {
    return this.s.speed === 'kt' ? kt : kt * 1.852;
  }

  fmtDist(m: number): string {
    return group(this.dist(m));
  }
  fmtHeight(ft: number): string {
    return group(this.height(ft));
  }
  fmtVs(fpm: number): string {
    return this.s.vs === 'fpm' ? group(fpm) : this.vs(fpm).toFixed(1);
  }
  fmtSpeed(kt: number): string {
    return group(this.speed(kt));
  }
}

export interface RunwayMarkings {
  /** Start of the aiming point marking, metres from the threshold. */
  aimingM: number;
  aimingLengthM: number;
  /** Touchdown zone markings: start position and number of bars on each side of the centreline. */
  bars: { atM: number; count: number }[];
  barLengthM: number;
  /** Spacing of the distance scale under the runway, metres. */
  tickM: number;
  /** Default length of runway shown, metres. */
  windowM: number;
}

/**
 * Standard runway marking positions for a runway of the given landing length. The sim does not
 * expose the painted markings, so they are drawn where the standards put them: the FAA layout
 * when distances are in feet (aiming point at 1,000 ft, touchdown zone bars every 500 ft to
 * 3,000 ft) and the ICAO layout when in metres (aiming point 150 to 400 m by runway length, bars
 * every 150 m to 900 m). Markings past the middle of the runway are left out, as on real runways.
 */
export function runwayMarkings(lengthM: number, dist: 'ft' | 'm'): RunwayMarkings {
  const half = lengthM / 2;
  if (dist === 'ft') {
    const ft = (x: number) => x / FT_PER_M;
    const all = [
      { atM: ft(500), count: 3 },
      { atM: ft(1500), count: 2 },
      { atM: ft(2000), count: 2 },
      { atM: ft(2500), count: 1 },
      { atM: ft(3000), count: 1 },
    ];
    return { aimingM: ft(1000), aimingLengthM: ft(150), bars: all.filter((b) => b.atM < half), barLengthM: ft(75), tickM: ft(500), windowM: ft(4000) };
  }
  const aimingM = lengthM < 800 ? 150 : lengthM < 1200 ? 250 : lengthM < 2400 ? 300 : 400;
  const pairs = lengthM < 900 ? 1 : lengthM < 1200 ? 2 : lengthM < 1500 ? 3 : lengthM < 2400 ? 4 : 6;
  const counts = [3, 2, 2, 1, 1];
  const bars: { atM: number; count: number }[] = [];
  for (let i = 1; i <= pairs; i++) {
    const atM = i * 150;
    // A pair that would sit within 50 m of the aiming point is omitted.
    if (Math.abs(atM - aimingM) <= 50 || atM >= half) continue;
    bars.push({ atM, count: counts[Math.min(bars.length, counts.length - 1)] });
  }
  return { aimingM, aimingLengthM: 50, bars, barLengthM: 22.5, tickM: 150, windowM: 1200 };
}
