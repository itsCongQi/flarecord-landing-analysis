/**
 * Core data types for Flarecord.
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
  // The values below were added with the approach recording. They are optional so recordings and
  // test data made before then still load.
  /** Altitude above mean sea level, feet. */
  alt?: number;
  /** Engine power: N1 in percent for jets, RPM for propeller aircraft (see powerKind). Average of all engines. */
  power?: number | null;
  /** Highest minus lowest engine, same unit as power. */
  powerSpread?: number;
  powerKind?: PowerKind | null;
  /** Gear selected down, or fixed gear. */
  gearDown?: boolean;
  /** Flap handle position, 0 = up. */
  flaps?: number;
  /** Angle of attack, degrees. */
  aoa?: number;
  /** Wheels on the ground: 1 = left main, 2 = right main, 4 = nose, added together. */
  wow?: number;
}

/** What the engine power figure is: N1 in percent (jets) or RPM (propeller aircraft). */
export type PowerKind = 'n1' | 'rpm';

/** One physical runway end, as used for touchdown geometry. */
export interface RunwayEnd {
  airportIdent: string;
  /** e.g. "27L". */
  designation: string;
  /** Landing threshold position (the displaced threshold where there is one). */
  thresholdLat: number;
  thresholdLon: number;
  /** Runway heading in degrees TRUE, pointing from this threshold down the runway. */
  headingTrue: number;
  /** Length from the landing threshold to the far end of the pavement, metres. */
  lengthM: number;
  widthM: number;
  /** Pavement before the landing threshold (displaced threshold), metres. */
  displacedM?: number;
  /** Paved surface (concrete, asphalt and the like). Absent on landings recorded before this was stored. */
  hard?: boolean;
  /** The runway has an ILS at either end. Absent on landings recorded before this was stored. */
  ils?: boolean;
  /** Glidepath angle of this end's own ILS, degrees, when the navdata has one. */
  gsDeg?: number;
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
  /** Sink rate at first contact, fpm (negative = down). See vsSource for where it came from. */
  touchdownVsFpm: number;
  /** Average sink rate over the last 0.5 s before contact (fitted to height), fpm. Absent on older landings. */
  avgVsFpm?: number | null;
  /** Source of touchdownVsFpm: the sim's touchdown value, the 0.5 s fit, or one vertical speed sample. */
  vsSource?: 'sim' | 'fit' | 'sample';
  /** Height reading with the wheels on the ground that was subtracted from every height, feet. */
  aglOffsetFt?: number;
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
  /** Ambient wind at contact: direction (from, degrees true) and speed. */
  windDirDeg?: number;
  windKt?: number;
  bounces: number;
  touchAndGo: boolean;
  flare: FlareInfo;
  geometry: TouchdownGeometry | null;
  score: ScoreBreakdown;
  /** The approach flown to this landing. Absent on landings recorded before it was stored, or when too little of it was recorded. */
  approach?: ApproachSummary;
  /** Engine power at contact (see powerKind), and what it is. Absent on older landings. */
  powerAtTd?: number | null;
  powerKind?: PowerKind | null;
  /** Seconds from first contact to each gear touching, null when it never did in the recording. Absent on older landings. */
  gearContact?: { left: number | null; right: number | null; nose: number | null };
}

/** The conditions that together make an approach stable, in the order they are shown. */
export type ConditionKey = 'config' | 'speed' | 'sink' | 'glidepath' | 'localizer' | 'bank';

export interface ConditionResult {
  key: ConditionKey;
  /** False when it could not be measured (path conditions without a matched runway). */
  measured: boolean;
  /** Height above the runway from which it stayed met down to 100 ft, feet. Null when it was not met at 100 ft. */
  fromFt: number | null;
  /** It was met from the top of the recorded approach, so the real height is at least fromFt. */
  top: boolean;
}

export interface ApproachSummary {
  /** Highest height above the runway in the recorded final descent, feet (at most 3,000). */
  topFt: number;
  /** Height above the runway from which every measured condition stayed met down to 100 ft. Null when not stable at 100 ft. */
  stableFt: number | null;
  /** Stable from the top of the recording: the real figure is at least stableFt. */
  stableAtTop: boolean;
  /** The condition that was met last, which sets stableFt. */
  last: ConditionKey | null;
  conditions: ConditionResult[];
  /** Largest glidepath deviations between 1,000 ft and 100 ft, dots (both positive numbers). Null without a runway. */
  gsMaxAbove: number | null;
  gsMaxBelow: number | null;
  /** Largest lateral deviations between 1,000 ft and 100 ft, dots, left and right of the centreline. */
  locMaxL: number | null;
  locMaxR: number | null;
  /** Glidepath angle the vertical deviation is measured against, and whether it is the runway's ILS. */
  pathDeg: number;
  ilsPath: boolean;
  /** Engine power at 500 ft above the runway. */
  powerAt500: number | null;
  /** The speed the speed condition is measured against: indicated airspeed at 50 ft, kt. */
  refIasKt: number | null;
  /** Height above the runway passing over the landing threshold, feet. Null without a runway. */
  thresholdFt: number | null;
}

/** The final descent, one point every 2 s, oldest first, for the Approach view. */
export interface ApproachTrace {
  /** Seconds to touchdown (negative). */
  t: number[];
  /** Height above the runway, feet. */
  h: number[];
  vs: number[];
  ias: number[];
  bank: number[];
  power: (number | null)[];
  /** Glidepath deviation, dots, above positive. Null without a runway. */
  gs: (number | null)[];
  /** Lateral deviation, dots, right positive. Null without a runway. */
  loc: (number | null)[];
  flaps: number[];
  /** 1 = gear down. */
  gear: number[];
  /** Distance to the landing threshold, metres (positive on the approach). Null without a runway. */
  dist: (number | null)[];
  /** Conditions met at this point: bit n is condition n in the order of ConditionKey. */
  met: number[];
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
  /** Centreline offset (m, positive = right), only when a runway was matched. */
  centerline: (number | null)[];
  /** Distance past the landing threshold (m, negative on the approach), only when a runway was matched. */
  along?: (number | null)[];
  // Added with the approach recording; absent on older landings.
  bank?: number[];
  aoa?: number[];
  gs?: number[];
  power?: (number | null)[];
  /** Wheels on the ground, see Sample.wow. */
  wow?: number[];
  approach?: ApproachTrace;
}

export interface LandingRecord {
  summary: LandingSummary;
  trace: LandingTrace | null;
}
