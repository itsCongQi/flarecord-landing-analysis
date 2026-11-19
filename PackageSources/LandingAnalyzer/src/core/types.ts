/**
 * Core data types for the landing analyzer.
 *
 * Everything under src/core is plain TypeScript with no MSFS dependencies, so it
 * can be unit-tested in Node with simulated flight data (see /test).
 *
 * Sign conventions (normalised by the sim adapter, NOT raw SimVar signs):
 *   pitch     degrees, nose UP is positive
 *   bank      degrees, RIGHT wing down is positive
 *   vs        feet per minute, climbing is positive
 *   elevator  -1..+1, PULL (nose-up input) is positive
 *   headings  degrees TRUE, 0..360
 */

export interface Sample {
  /** Sim time in seconds (monotonic, from E:SIMULATION TIME). */
  t: number;
  /** Height of the gear above ground in feet. */
  agl: number;
  /** Vertical speed, fpm. */
  vs: number;
  ias: number;
  gs: number;
  pitch: number;
  bank: number;
  heading: number;
  track: number;
  /** Load factor in g (1.0 = level flight). */
  g: number;
  /** Pitch control input, -1..+1, pull positive. */
  elevator: number;
  onGround: boolean;
  lat: number;
  lon: number;
  /** Ambient wind direction (from), degrees true. */
  windDir: number;
  /** Ambient wind speed, kt. */
  windSpd: number;
}

/** One physical runway end, as used for touchdown geometry. */
export interface RunwayEnd {
  airportIdent: string;
  /** e.g. "27L". */
  designation: string;
  /** Landing threshold position. */
  thresholdLat: number;
  thresholdLon: number;
  /** Runway heading in degrees TRUE, pointing from this threshold down the runway. */
  headingTrue: number;
  /** Usable length from this threshold, metres. */
  lengthM: number;
  widthM: number;
}

export interface FlareInfo {
  /** Height (ft) where the flare was judged to start, or null if no flare was found. */
  flareHeightFt: number | null;
  /** Seconds from flare start to first contact. */
  flareDurationS: number | null;
  /** Vertical speed when the flare began, fpm. */
  vsAtFlareFpm: number | null;
  /** Pitch added from approach attitude to touchdown attitude, degrees. */
  pitchChangeDeg: number | null;
  /** Seconds spent below 5 ft before contact (long float = wasted runway). */
  floatTimeS: number;
  /** Average approach pitch between 100 ft and 50 ft (the reference attitude). */
  approachPitchDeg: number | null;
  /** How the flare marker was found. */
  method: 'pitch' | 'input' | 'none';
}

export interface TouchdownGeometry {
  runway: RunwayEnd;
  /** Distance from the landing threshold along the centreline, metres (negative = short of threshold). */
  distFromThresholdM: number;
  /** Signed distance from the centreline, metres (positive = right of centreline). */
  centerlineOffsetM: number;
  /** Whether touchdown was inside the standard touchdown zone (150 m .. 900 m). */
  inTouchdownZone: boolean;
}

export interface ScoreBreakdown {
  total: number;
  /** Per-category points and maximum, only categories that could be measured. */
  parts: { key: string; label: string; points: number; max: number; note: string }[];
  grade: 'Excellent' | 'Good' | 'Acceptable' | 'Firm' | 'Hard';
}

export interface LandingSummary {
  id: string;
  /** Wall-clock time (ms since epoch) when the landing was recorded. */
  recordedAt: number;
  aircraft: string;
  touchdownVsFpm: number;
  peakG: number;
  touchdownIasKt: number;
  touchdownGsKt: number;
  pitchDeg: number;
  bankDeg: number;
  /** Heading minus track at contact (crab), degrees, positive = nose right of track. */
  crabDeg: number;
  headwindKt: number;
  /** Positive = wind from the right. */
  crosswindKt: number;
  bounces: number;
  touchAndGo: boolean;
  flare: FlareInfo;
  geometry: TouchdownGeometry | null;
  score: ScoreBreakdown;
  /** True for the built-in example landings shown while the log is empty (never stored). */
  example?: boolean;
}

/** Downsampled time series kept for the graphs. t is seconds relative to first contact. */
export interface LandingTrace {
  t: number[];
  agl: number[];
  vs: number[];
  pitch: number[];
  ias: number[];
  elevator: number[];
  g: number[];
  /** Centreline offset (m) during the rollout, only when a runway was matched. */
  centerline: (number | null)[];
}

export interface LandingRecord {
  summary: LandingSummary;
  trace: LandingTrace | null;
}
