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

/** What is known about a runway when working out its markings. All optional. */
export interface MarkingInput {
  airportIdent?: string;
  widthM?: number;
  /** Paved surface. Unknown counts as paved. */
  hard?: boolean;
  /** The runway has an ILS at either end. Unknown counts as yes. */
  ils?: boolean;
}

export interface RunwayMarkings {
  /** Which rules the layout follows. */
  standard: 'FAA' | 'ICAO';
  /**
   * What is painted: the full precision set (aiming point and touchdown zone bars), the aiming
   * point only, threshold and centreline only, or nothing on an unpaved runway.
   */
  painted: 'precision' | 'aiming' | 'basic' | 'none';
  /** Start of the aiming point marking, metres from the threshold, or null when there is none. */
  aimingM: number | null;
  aimingLengthM: number;
  /** Touchdown zone markings: start position and number of bars on each side of the centreline. */
  bars: { atM: number; count: number }[];
  barLengthM: number;
  /** Length of the touchdown zone from the threshold, metres, or null when none is marked. */
  tdzM: number | null;
  /** Threshold stripes on each side of the centreline. */
  thresholdStripes: number;
  /** Spacing of the distance scale under the runway, metres. */
  tickM: number;
  /** Default length of runway shown, metres. */
  windowM: number;
}

/**
 * True for airports that follow FAA marking rules: the contiguous US (K...), Alaska, Hawaii and
 * the Pacific territories (PA, PH, PG, PF, PO, PP), Puerto Rico and the US Virgin Islands (TJ,
 * TI), and three-character FAA identifiers such as "1S2".
 */
export function usesFaaMarkings(ident: string): boolean {
  const id = ident.trim().toUpperCase();
  if (/^K[A-Z0-9]{3}$/.test(id)) return true;
  if (/^P[AHGFOP][A-Z0-9]{2}$/.test(id) || /^T[JI][A-Z0-9]{2}$/.test(id)) return true;
  return id.length === 3 && /[0-9]/.test(id);
}

/**
 * Standard runway markings for a runway. The sim does not expose what is painted, so the layout
 * is worked out from the rules that apply to it:
 *
 *  - Which rules: FAA (AC 150/5340-1) for US airports, ICAO Annex 14 elsewhere, from the airport
 *    identifier. Without an identifier, the distance unit decides (feet: FAA). The scale under
 *    the drawing always follows the distance unit, whichever rules apply.
 *  - FAA: aiming point at 1,000 ft, touchdown zone bars at 500, 1,500, 2,000, 2,500 and 3,000 ft
 *    (3, 2, 2, 1, 1 bars), leaving out any within 900 ft of the middle of the runway.
 *  - ICAO: aiming point at 150, 250, 300 or 400 m and 1, 2, 3, 4 or 6 pairs of bars every 150 m,
 *    both by landing distance available; a pair within 50 m of the aiming point is left out.
 *    Bars are distance coded: 3 up to 300 m, 2 up to 600 m, 1 up to 900 m.
 *  - What is painted: the full set on a paved runway with an ILS at either end; the aiming point
 *    only on other paved runways of 1,200 m (4,000 ft) or more; threshold and centreline on
 *    shorter paved runways; nothing on grass, gravel and other unpaved surfaces.
 *  - Threshold stripes by runway width (4, 6, 8, 12 or 16 in all).
 *
 * `lengthM` is the landing distance: from the landing threshold to the far end.
 */
export function runwayMarkings(lengthM: number, dist: 'ft' | 'm', rw: MarkingInput = {}): RunwayMarkings {
  const ft = (x: number) => x / FT_PER_M;
  const standard: 'FAA' | 'ICAO' = rw.airportIdent ? (usesFaaMarkings(rw.airportIdent) ? 'FAA' : 'ICAO') : dist === 'ft' ? 'FAA' : 'ICAO';
  const scale = dist === 'ft' ? { tickM: ft(500), windowM: ft(4000) } : { tickM: 150, windowM: 1200 };
  const painted: RunwayMarkings['painted'] = rw.hard === false ? 'none' : rw.ils !== false ? 'precision' : lengthM >= 1200 ? 'aiming' : 'basic';
  const w = rw.widthM ?? 45;
  const thresholdStripes = painted === 'none' ? 0 : w < 20.5 ? 2 : w < 26.5 ? 3 : w < 37.5 ? 4 : w < 52.5 ? 6 : 8;
  const half = lengthM / 2;

  let aimingM: number;
  let aimingLengthM: number;
  let barLengthM: number;
  let tdzM: number;
  let bars: { atM: number; count: number }[] = [];
  if (standard === 'FAA') {
    aimingM = ft(1000);
    aimingLengthM = ft(150);
    barLengthM = ft(75);
    tdzM = Math.min(ft(3000), half);
    const all = [
      { atM: ft(500), count: 3 },
      { atM: ft(1500), count: 2 },
      { atM: ft(2000), count: 2 },
      { atM: ft(2500), count: 1 },
      { atM: ft(3000), count: 1 },
    ];
    bars = all.filter((b) => b.atM <= half - ft(900));
  } else {
    aimingM = lengthM < 800 ? 150 : lengthM < 1200 ? 250 : lengthM < 2400 ? 300 : 400;
    aimingLengthM = lengthM < 1200 ? 40 : 50;
    barLengthM = 22.5;
    tdzM = Math.min(900, half);
    const pairs = lengthM < 900 ? 1 : lengthM < 1200 ? 2 : lengthM < 1500 ? 3 : lengthM < 2400 ? 4 : 6;
    for (let i = 1; i <= pairs; i++) {
      const atM = i * 150;
      if (Math.abs(atM - aimingM) <= 50 || atM >= half) continue;
      bars.push({ atM, count: atM <= 300 ? 3 : atM <= 600 ? 2 : 1 });
    }
  }
  if (painted !== 'precision') bars = [];
  const hasAiming = (painted === 'precision' || painted === 'aiming') && aimingM < half;
  return {
    standard,
    painted,
    aimingM: hasAiming ? aimingM : null,
    aimingLengthM,
    bars,
    barLengthM,
    tdzM: painted === 'precision' ? tdzM : null,
    thresholdStripes,
    tickM: scale.tickM,
    windowM: scale.windowM,
  };
}
