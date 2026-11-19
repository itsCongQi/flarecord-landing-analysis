<p align="center"><img src="PackageSources/Flarecord/Assets/app-icon.svg" width="96" alt="Flarecord icon"></p>

# Flarecord

**A landing monitor for Microsoft Flight Simulator 2024 that lives on the in-sim tablet.**

Flarecord records every landing you fly and shows you exactly what happened: where you touched
down, how the flare went, and what the aircraft was doing at each height on the way in. It runs
entirely inside the simulator as an EFB app. There is nothing to start alongside the sim and
nothing to connect.

It is a measuring instrument. It reports what happened and leaves the judgement to you: no
grades and no coaching.

![The Landing page](docs/images/landing.png)

## What you get

- **Automatic recording.** Flarecord arms below 200 ft on approach and saves the landing when you
  slow down. It works in any aircraft that has the tablet.
- **Touchdown point on the runway.** A top-down runway view with your approach and rollout track,
  the flare start, the height over the threshold and the touchdown point, drawn over the
  touchdown zone and markings for that runway.
- **Values at contact.** Vertical speed, peak load, airspeed and ground speed, pitch, bank, crab,
  headwind and crosswind, flare height and duration, float time and bounces.
- **Values by height.** One row each for 200, 100, 50, 30, 20 and 10 ft, the threshold and
  touchdown, so "what were my pitch and sink rate at 50 ft" is a single glance.
- **Approach and flare chart.** Radio altitude, vertical speed, pitch, airspeed and elevator input
  stacked on one time axis. Tap anywhere to read every value at that moment.
- **Rollout view.** Your track after touchdown over a plain runway seen from above, to show how
  far you were from the centreline and where.
- **A log that persists.** Every landing is kept between sessions, with new ones marked until you
  open them.
- **Summary across landings.** Medians, touchdown points overlaid on one runway, and a
  landing-by-landing trend, for all aircraft or the ones you tick.
- **Your units.** Feet or metres, fpm or m/s, knots or km/h.
- **Methods on show.** A "?" next to a figure explains how it was obtained, and Settings lists the
  full methodology.

## Screens

### Summary

Opens first. Figures across your last 10, last 30 or all landings, filtered by aircraft, with a
notice when a new landing is waiting.

![The Summary page](docs/images/summary.png)

### Log

Every landing as a table, newest first, with a filter. An amber dot marks a landing you have not
opened yet.

![The Log page](docs/images/log.png)

## Install

Flarecord is at an early stage and there is no packaged download yet. For now it is built from
source with the MSFS 2024 SDK:

1. Install the MSFS 2024 SDK and its samples.
2. Follow [`PackageSources/Flarecord/README-build.md`](PackageSources/Flarecord/README-build.md)
   to build the package.
3. Copy the resulting `flarecord-landing-monitor` folder into your Community folder and start the
   sim. Flarecord appears on the tablet in every aircraft.

Copying this repository into the Community folder as it is does nothing, because it is source
code and not a built package.

## Using it

1. Fly an approach. The status strip at the top of the app shows **MONITORING**, then **ARMED**
   below 200 ft, then **RECORDING** through the rollout.
2. After you slow down, open the tablet and Flarecord. Summary shows a notice for the new landing.
3. Open the landing, tap the chart or a height row to inspect a moment, and use Previous and Next
   to step through the log.

Until your first landing the app shows example data, labelled as such.

## Good to know

- **Runway markings are derived, not read from the sim.** The simulator does not expose painted
  markings, so Flarecord draws what the standards call for on that runway: FAA rules at US
  airports and ICAO rules elsewhere, scaled to the runway. Scenery that differs will not match.
- **Runway identification comes from the sim's navigation data.** If no runway is matched, the
  landing is still recorded, without the runway views.
- **Your data is in plain files you can back up.** Landings are saved in the simulator's work
  folder for this addon, up to 500 of them, with charts for the newest 60. Settings in the app
  shows the folder and how to back it up or move it to another PC.
- **Still being proven in flight.** The analysis is tested against simulated landings, and the
  app builds and loads in the sim. Recording with the tablet closed, and runway matching across
  many airports, are still being checked.

## For developers

The analysis core is plain TypeScript with no simulator dependencies and is tested in Node:

```
npm install
npm test
```

Node 22.6 or newer is required. How things are measured, the flare detection method, storage,
and notes on the MSFS 2024 EFB platform are in [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Disclaimer

Flarecord is an independent project for flight simulation only. It is not affiliated with or
endorsed by Microsoft or Asobo Studio, and it must not be used for real-world flying.
