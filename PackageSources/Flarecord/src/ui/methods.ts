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
    text: 'The main figure is the simulator\'s own touchdown velocity (PLANE TOUCHDOWN NORMAL VELOCITY), read at first wheel contact. It is the speed at right angles to the ground at that instant, so runway slope is included. The 0.5 s average is a separate measurement: the slope of a straight line fitted to gear height over the last half second before contact. A gap between the two means the sink rate was still changing as the wheels touched. If the simulator gives no touchdown value, the 0.5 s average becomes the main figure and is labelled as such.',
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
  {
    key: 'stable',
    title: 'Height the approach was stable from',
    text: 'The flight before each landing is kept at two readings a second, and the final descent is examined afterwards from 3,000 ft above the runway down to 100 ft. Six conditions are checked: gear down and the flaps at the setting they had at touchdown; indicated airspeed no more than 10 kt above or 5 kt below the speed flown at 50 ft; sink rate no more than 1,000 fpm; within one and a half dots of the glidepath; within one and a half dots of the centreline; bank no more than 7°. Each bar shows where its condition was met, and the figure beside it is the height from which it stayed met down to 100 ft, ignoring breaks shorter than 2 s. The approach was stable from the lowest of those heights. A plus sign means it already was at the top of the recording. Heights are altitude above the touchdown point, not radio height, which follows the terrain. Engine power is shown but is not one of the conditions.',
  },
  {
    key: 'deviation',
    title: 'Glidepath and localizer deviation',
    text: 'Worked out from the aircraft position, not read from an ILS receiver, so it is there on every runway whatever is tuned. Vertically it is the angle off a glidepath that passes 50 ft over the landing threshold, at the angle of the runway\'s own ILS when the navigation data has one (shown as G/S) and at 3.0° otherwise (shown as PATH). One dot is 0.35°. Laterally it is the angle off the extended centreline seen from where a localizer aerial stands, 1,000 ft beyond the far end, with two dots equal to 350 ft either side at the threshold. The largest values are taken between 1,000 ft and 100 ft above the runway. On an offset or circling approach the lateral figure is large until the aircraft lines up.',
  },
  {
    key: 'power',
    title: 'Engine power',
    text: 'For jets, N1 in percent averaged over all engines (TURB ENG N1). Propeller aircraft have no N1 and show propeller or engine RPM. The value at 500 ft is read on the final descent through 500 ft above the runway, and the value at touchdown at first wheel contact. Some add-on aircraft run their own engine model and may not fill the simulator\'s value.',
  },
  {
    key: 'takeoff',
    title: 'Takeoff recording',
    text: 'A takeoff is noticed when ground speed passes 30 kt while still rising. The record begins where the aircraft last stood still or lined up on that heading, using the readings kept from the 40 s before, and is read 20 times a second until 10 s after liftoff. Liftoff is the first moment the simulator reports the aircraft off the ground, once it has stayed off for half a second. The climb is then kept at one reading a second up to 3,000 ft above the liftoff point, or for 3 minutes. A roll after a landing without stopping is marked as a touch-and-go.',
  },
  {
    key: 'roll',
    title: 'Ground roll and runway ahead',
    text: 'The runway comes from the simulator\'s navigation data: the one under the aircraft at liftoff whose direction matches the ground track. Ground roll is the distance along the centreline from where the roll began to the liftoff point, and runway ahead is the distance from the liftoff point to the far end of the pavement. The centreline figure is the largest distance from the centreline with the wheels on the ground. Without a matched runway, ground roll is the ground speed added up over the roll, and the runway figures are not available.',
  },
  {
    key: 'rotation',
    title: 'Rotation start and rotation speed',
    text: 'Pitch rate is the change in pitch over the 0.4 s around each reading. The rotation is the last stretch of pitch rate at or above 1° per second that leads up to liftoff; dips shorter than half a second do not end it. Rotation speed is the indicated airspeed at the start of that stretch. It counts only when pitch rose by at least 2° between there and liftoff, so an aircraft that is flown off in its ground attitude shows no rotation figures. No reference speeds are compared: the simulator has no VR or V2 that holds for every aircraft.',
  },
  {
    key: 'rotationRate',
    title: 'Rotation rate',
    text: 'The average is the pitch gained between the start of the rotation and liftoff, divided by the time that took. The peak is the highest pitch rate in that time. Pitch after liftoff is not included.',
  },
  {
    key: 'rejected',
    title: 'Rejected takeoff',
    text: 'A roll on a runway that passed 50 kt of ground speed and then slowed below 30 kt without leaving the ground. The recording ends there, so runway left is measured at 30 kt, not at a full stop. Rejected takeoffs are listed in the log and left out of the Summary figures.',
  },
  {
    key: 'climb',
    title: 'Climb heights',
    text: 'Heights in the climb are altitude above the liftoff point, not radio height, which follows the terrain. Over runway end is the height where the track passes the far end of the pavement. Gear up is where the gear lever left the down position, and flap retraction is the first movement of the flap lever towards up. The 35 ft figures on the Takeoff view use radio height, zeroed with the wheels on the runway.',
  },
  {
    key: 'thrustReduction',
    title: 'Thrust or power reduction',
    text: 'Takeoff power is the average over the last 3 s of the roll. The reduction is the height where power first came more than 3 points of N1 below that (4 % for RPM) and stayed there for 3 s. An aircraft whose RPM does not drop in the climb, as with a fixed-pitch propeller at full throttle, shows no figure.',
  },
];

const BY_KEY: { [key: string]: Method } = {};
for (const m of METHODS) BY_KEY[m.key] = m;

export function method(key: string): Method | null {
  return BY_KEY[key] ?? null;
}

/** The small "?" button that follows a figure's title. */
export function helpBtn(key: string): string {
  return `<span class="la-help" data-help="${key}">?</span>`;
}
