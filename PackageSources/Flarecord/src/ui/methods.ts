/**
 * How each figure is obtained, in plain words. One list feeds both the "?" notes next to the
 * figures and the Methodology section in Settings, so the two cannot drift apart.
 */
export interface Method {
  key: string;
  title: string;
  text: string;
}

export const METHODS: Method[] = [
  {
    key: 'recording',
    title: 'Recording',
    text: 'Flarecord reads the aircraft state from the simulator 20 times a second. It arms below 200 ft on a descent after a real flight, raises the rate to as much as 60 times a second from arming until 3 s after touchdown, and saves the landing when ground speed falls below 30 kt. Touchdown is the first moment the simulator reports the aircraft on the ground.',
  },
  {
    key: 'vs',
    title: 'Vertical speed at touchdown',
    text: 'The main figure is the simulator\'s own touchdown velocity (PLANE TOUCHDOWN NORMAL VELOCITY), read at first wheel contact. It is the speed at right angles to the ground at that instant, so runway slope is included. The "0.5 s avg" figure is separate: the slope of a straight line fitted to gear height over the last half second before contact. A gap between the two means the sink rate was still changing as the wheels touched. If the simulator gives no touchdown value, the 0.5 s average becomes the main figure and is labelled as such.',
  },
  {
    key: 'g',
    title: 'Peak load',
    text: 'The highest load factor the simulator reports (G FORCE) from 0.1 s before first contact to 1 s after it. A spike shorter than the gap between two readings can be missed, so treat it as a lower bound on very firm arrivals.',
  },
  {
    key: 'crab',
    title: 'Crab',
    text: 'True heading minus ground track at first contact. R means the nose points right of the direction of travel.',
  },
  {
    key: 'wind',
    title: 'Headwind and crosswind',
    text: 'The ambient wind at the aircraft at first contact, split into the part along the aircraft heading and the part across it. It is the wind the simulator applies at that point, not a reported airport wind.',
  },
  {
    key: 'flare',
    title: 'Flare start, height and duration',
    text: 'The approach attitude is the average pitch between 100 ft and 50 ft. Walking back from touchdown, the flare starts just after the last moment the smoothed pitch was still within 0.5° of that attitude. It counts only if touchdown pitch is at least 1° above the approach attitude and the start is below 60 ft. For aircraft that flare with little pitch change, the start of the final sustained pull on the elevator is used instead. Flare height is the gear height at that moment, duration is the time from there to first contact, and V/S at flare is the vertical speed there.',
  },
  {
    key: 'pitchChange',
    title: 'Pitch change',
    text: 'Pitch at touchdown minus the approach attitude, which is the average pitch between 100 ft and 50 ft and is shown as "from".',
  },
  {
    key: 'float',
    title: 'Float',
    text: 'Time spent below 5 ft (1.5 m) of gear height before first contact.',
  },
  {
    key: 'bounces',
    title: 'Bounces',
    text: 'The number of times the wheels left the ground for at least 0.2 s after first contact and came back down. Climbing past 100 ft after contact is recorded as a touch-and-go instead.',
  },
  {
    key: 'height',
    title: 'Heights',
    text: 'Height is the simulator\'s height above the ground directly under the aircraft, so airport elevation plays no part. It is zeroed for each landing: whatever the simulator reads with the wheels on the runway during the rollout is subtracted, so 0 is wheels on the ground in any aircraft. Each row of the table is the last descent through that height.',
  },
  {
    key: 'position',
    title: 'Touchdown point',
    text: 'The runway comes from the simulator\'s navigation data: the closest runway whose direction matches the ground track at contact. Distance is measured along the centreline from the landing threshold (the displaced threshold where there is one) to the aircraft position at first contact, and the offset is the distance from the centreline at that point. The height over the threshold is the gear height where the track crosses it.',
  },
  {
    key: 'markings',
    title: 'Runway markings and touchdown zone',
    text: 'The simulator does not provide painted markings, so they are drawn from standards: FAA rules (AC 150/5340-1) at US airports and ICAO Annex 14 elsewhere, for the length, surface and ILS status of that runway. The scenery\'s own paint may differ.',
  },
];

const BY_KEY: { [key: string]: Method } = {};
for (const m of METHODS) BY_KEY[m.key] = m;

export function method(key: string): Method | null {
  return BY_KEY[key] ?? null;
}

/** The "?" button for a figure. `corner` pins it to the top right of a value cell. */
export function helpBtn(key: string, corner = false): string {
  return `<span class="la-help${corner ? ' la-help-corner' : ''}" data-help="${key}">?</span>`;
}
