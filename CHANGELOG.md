# Changelog

What changed in each release of Flarecord. The newest release is first.

## 0.2.0

To update, close the simulator, delete the old `flarecord-landing-monitor` folder from Community
and put the new one in its place. Your recorded landings are kept.

### New

- **Departures.** Every takeoff is now recorded, from where the roll began to 3,000 ft. The new
  Departure tab shows the ground track over the runway, rotation speed and rate, liftoff pitch
  and speed, ground roll, runway ahead at liftoff and distance from the centreline, with pitch,
  pitch rate, airspeed and elevator input on a time axis that has liftoff at zero. A Climb view
  shows the climb by height with the gear, flap and thrust changes marked. Rejected takeoffs and
  touch-and-goes are logged.
- **Stable approach.** The approach is now recorded from 3,000 ft down. The Arrival page has a
  Touchdown / Approach switch, and the Approach view shows the height the approach was stable
  from, which condition was met last, glidepath and centreline deviation in dots, and engine
  power. The approach counts as stable with the gear down and landing flap set, speed within
  +10/-5 kt of the speed at 50 ft, sink no more than 1,000 fpm, within 1.5 dots of the glidepath
  and the centreline, and bank no more than 7°. Deviation is worked out from the aircraft
  position, so it is there on every runway, with or without an ILS tuned.
- **Second by second.** The five seconds either side of touchdown as a table that opens in place
  on the Arrival page.
- **Engine power** as a column in the values by height and a lane on the chart.
- **Log and Summary cover both.** A Departures / Arrivals switch on each. The landing log gains a
  STABLE column, and the Summary a median stable height and a trend lane.
- **Notice for new takeoffs.** Summary shows a notice when a takeoff has been recorded and not
  opened yet, as it does for landings.

### Changed

- The Landing tab is now called Arrival, and the tabs are Summary, Departure, Arrival, Log and
  Settings.
- Lower load on the simulator. Flarecord now reads the aircraft only as often as it needs to: a
  few times a second in cruise and on the ground, and at full rate only around the touchdown.
  After a landing only the page on screen is redrawn.
- The Methodology section in Settings is closed until you tap it.

### Fixed

- The icon on an empty page was stretched across the panel.

### Good to know

- Landings recorded with 0.1.0 stay in the log. They have no approach data, so their Approach
  view and STABLE column are empty.

## 0.1.0

First release. Automatic landing recording on the in-sim tablet: touchdown point on the runway,
values at contact and by height, approach and flare chart, rollout view, a log that persists in
files, and a summary across landings.
