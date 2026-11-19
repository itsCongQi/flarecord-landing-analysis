# Flarecord technical notes

How Flarecord measures things, where it keeps its data, and what was learned about the MSFS 2024
EFB platform while building it. For what the app does and how to install it, see the
[README](../README.md).

## What is measured

| Area | Measured | Notes |
|---|---|---|
| Touchdown | sink rate at contact, 0.5 s average sink rate, peak G (0.1 s before to 1 s after contact), IAS, GS, pitch, bank, crab | see "Touchdown rate and height" |
| Wind | headwind and crosswind components at contact | from ambient wind against heading |
| Bounces | count of re-contacts after at least 0.2 s airborne; touch-and-go detection | |
| Flare | flare start height and time, sink rate at flare start, pitch added, float time below 5 ft | see "Flare detection" |
| Runway | airport and runway, distance past the landing threshold (the displaced threshold where there is one), signed centreline offset, ground track, height over the threshold | from the sim's navigation data |
| Rollout | ground track after touchdown until 30 kt | |
| Landing index | optional single 0 to 100 figure, hidden unless switched on in Settings | see "Landing index" |

## Touchdown rate and height

- **Rate at contact.** The headline figure is the sim's own `PLANE TOUCHDOWN NORMAL VELOCITY`, read at
  first wheel contact: the speed at right angles to the ground at that instant.
- **0.5 s average.** Stored next to it as `avgVsFpm`: the slope of a least-squares line through gear
  height over the last half second before contact. It is shown under the headline figure as a
  cross-check, and it becomes the headline figure (`vsSource: 'fit'`) when the sim gives no touchdown
  value. A single `VERTICAL SPEED` sample is the last resort (`vsSource: 'sample'`).
- **Height zero.** `PLANE ALT ABOVE GROUND MINUS CG` does not read exactly 0 on the wheels in every
  aircraft. For each landing the median reading on the ground from 1 s after contact is subtracted
  from every height (`aglOffsetFt`); with too little rollout, the reading taken while standing before
  the flight is used, then the contact sample.
- **Sampling.** 20 Hz normally, up to 60 Hz from arming until 3 s after contact, limited by the
  frame rate.

The same explanations are shown in the app: a "?" next to a figure opens a note, and Settings has
a Methodology section. Both come from `src/ui/methods.ts`.

## Runway markings

The sim's facility data gives each runway's position, heading, length, width, displaced
threshold, surface and ILS, but not the paint. The runway view therefore draws the markings the
standards call for on that runway (`runwayMarkings` in `core/units.ts`):

- FAA rules for US airports and ICAO Annex 14 elsewhere, chosen from the airport identifier. The
  distance unit only sets the scale under the drawing.
- FAA: aiming point at 1,000 ft and touchdown zone bars every 500 ft to 3,000 ft, none within
  900 ft of mid-runway. ICAO: aiming point at 150 to 400 m and 1 to 6 pairs of bars every 150 m,
  both by landing distance available.
- The touchdown zone is shaded and its length is labelled.
- The full set on a paved runway with an ILS at either end, the aiming point only on other long
  paved runways, threshold and centreline on short ones, and nothing on unpaved runways.
- Threshold stripes by runway width.

An airport with non-standard paint, or scenery that differs from the rules, will not match.

## Flare detection

1. Reference attitude = mean pitch between 100 ft and 50 ft.
2. Attitude-based: walking back from touchdown, the flare starts right after the last moment the
   smoothed pitch was within 0.5° of the reference (only if it touched down ≥1° above it and
   below 60 ft).
3. Fallback, input-based: start of the final sustained pull, where smoothed elevator input last
   crossed 35% of its rise from the approach baseline to its peak.

## Landing index

Sink rate 25 · Peak G 15 · Touchdown zone 20 · Centreline 15 · Alignment 10 (crab allowance grows
with crosswind) · Attitude 10 · No bounce 5. If no runway is identified, the runway categories
are left out and the rest scaled to 100. A float over 4 s costs up to 10 points.
The index is off by default; switch it on in Settings.

## Landing log

Stored in the sim's DataStore (`SetStoredData`/`GetStoredData`), which persists between sessions.
Up to 500 landings; graphs kept for the newest 60 (about 8 KB each); the index is split into
pages of 50 so no single key passes about 70 KB. "Copy as CSV" is planned for moving data out of
the sim.

A log saved by an earlier build under the `LANDAN.v1.` key prefix is moved to `FLARECORD.v1.` on
first start.

## File storage

The DataStore cannot be backed up by hand and has a reported loss on "Quit to desktop", so the same
data is also kept as files. JavaScript in the sim cannot write files; a WASM module can, inside its
package's work folder. The package therefore carries a small standalone module,
`modules/flarecord_storage.wasm` (source in `PackageSources/Flarecord/wasm`).

- **Protocol.** The app sends `FLARECORD_FS_REQ` over the Comm Bus as `<id>\n<op>\n<key>\n<value>`
  (`P` ping, `R` read, `W` write) and the module answers on `FLARECORD_FS_RES` with
  `<id>\n<status>\n<value>` (`OK`, `MISSING`, `ERR`). One file per key, `/work/<key>.json`; keys are
  limited to letters, digits, `.`, `-` and `_`. The app sends one request at a time.
- **Mirror.** `MirroredStore` writes every key to the DataStore (synchronous, used for reads) and to
  the files. A revision number kept on both sides is compared at start: no revision in the files
  copies everything out, an equal one does nothing, and a different one merges the two (landings
  from both sides by id, settings and the unread list from the files) and writes the result to both.
- **Fallback.** If the module does not answer within 15 s of start, the app runs on the DataStore
  alone and Settings says so.
- **Location.** `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\flarecord-landing-monitor\work`
  on the Steam version.
- **Build.** `wasm/build-wasm.ps1` calls the SDK's own `clang-cl` and `wasm-ld`; Visual Studio is
  not needed. The built module is committed, so the app can be built without compiling it.

## MSFS 2024 EFB platform notes (checked November 2026)

- **EFB apps are a supported SDK feature.** You build an app, not a custom EFB; once packaged it
  appears on the EFB of every aircraft. Built from the SDK's EFB TemplateApp with Node 18+.
  [EFB API docs](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/efb/electronic-flight-bag-api/)
- **Background capture.** `App` has `BootMode` (COLD / WARM / HOT) and an `install()` hook, and
  `SuspendMode` (SLEEP / TERMINATE). The capture service starts in `install()` so it does not
  depend on the app being open. The docs do not state in words whether app code runs while the
  tablet is closed, but a released EFB app (MSFS Passport 2024) says it "tracks your flying in
  the background (even with the EFB closed)", which is strong evidence it works.
  **Still to be confirmed in a test flight.** Fallback if it doesn't: a small WASM module that
  records and hands data to the app over the Comm Bus.
- **Reading data.** `SimVar.GetSimVarValue` works the same in EFB apps; Asobo staff advise
  polling in `onUpdate` and minimising reads and DOM updates. Flarecord samples 15 SimVars at 20 Hz and
  only push to the UI at 4 Hz.
- **Persistence.** DataStore is saved with the user's save data (cloud save). One devsupport
  report says values were lost for some users who quit through the in-game "Quit to desktop";
  Asobo could not reproduce it. The size limit is not documented, so per-key size and total
  landings are capped. The log writes after every landing, so at worst the last landing of a session is
  at risk.

## Source layout

```
PackageSources/Flarecord/
  src/core/            plain TS, no sim dependencies (tested in Node)
    types.ts           Sample, LandingSummary, LandingTrace ...
    LandingDetector.ts state machine: idle → armed (<200 ft, descending) → rollout → record
    flare.ts           flare detection
    score.ts           the optional landing index
    units.ts           display units, settings, standard runway marking positions
    summary.ts         medians across landings, aircraft list
    gates.ts           values at set heights, interpolated trace read-out
    geo.ts             runway geometry, wind components, runway matching
  src/storage/         LandingLog (paged log), DataStoreAdapter, MirroredStore and FileBridge (file copy)
  wasm/                the storage module's source and build script; modules/ holds the built .wasm
  src/sim/             SimVarSampler (20 Hz SimVar reads), RunwayProvider (FacilityLoader)
  src/ui/              pages: Landing, Log, Summary, Settings; chartSvg and runwaySvg
                       (dependency-free SVG drawings)
  src/AnalyzerService.ts   always-on capture, started from App.install()
  src/Flarecord.tsx  EFB App + AppView registration
  README-build.md      how to drop this into the SDK's EFB sample and build it
test/                  synthetic approach generator + tests
```

Run the tests: `npm install && npm test` (Node 22.6+; uses Node's built-in TypeScript stripping).
