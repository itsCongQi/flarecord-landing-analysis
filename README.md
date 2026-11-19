# Landing Analyzer for MSFS 2024 (prototype)

An in-sim landing analysis addon that runs entirely inside Microsoft Flight Simulator 2024 as a
third-party **EFB tablet app**. No external exe, no SimConnect client. It records every approach,
detects touchdown, bounces and the flare, scores the landing, draws graphs of the last seconds
before touchdown, and keeps a log of past landings across sessions.

Status: **prototype**. The analysis core and the log are written and tested against simulated
landings (6 of 6 tests pass). The EFB wiring is written against the SDK's TemplateApp sample but
has not yet been compiled against the real `efb_api` package or flown in the sim.

> **This repository is source code, not an installable addon.** Copying it into the sim's
> Community folder does nothing (there is no `manifest.json`, `layout.json` or built JS yet).
> Build it first, see `PackageSources/LandingAnalyzer/README-build.md`.

## What it measures

| Area | Measured | Notes |
|---|---|---|
| Touchdown | sink rate, peak G (first 1 s after contact), IAS, GS, pitch, bank, crab | sink rate prefers the sim's own `PLANE TOUCHDOWN NORMAL VELOCITY` |
| Wind | headwind and crosswind components at contact | from ambient wind vs heading |
| Bounces | count of re-contacts after ≥0.2 s airborne; touch-and-go detection | |
| Flare | flare start height and time, sink rate at flare start, pitch added, float time below 5 ft | own detector, see below |
| Runway | airport and runway, distance past threshold, signed centreline offset, touchdown zone | via the sim's navdata (FacilityLoader) |
| Rollout | centreline offset through the rollout until 30 kt | |
| Score | 0 to 100 with a per-category breakdown and a grade; one coaching tip | own weights, see below |

### Graphs (Analysis page)

Synchronised on one time axis (seconds to touchdown), with FLARE and TD markers, zoomable to
30 s / 15 s / 8 s: vertical speed (with a −150 fpm target line), height above ground, pitch with
pitch-control input overlaid, indicated airspeed, plus a rollout centreline graph.

### Flare detection (this addon's own method)

1. Reference attitude = mean pitch between 100 ft and 50 ft.
2. Attitude-based: walking back from touchdown, the flare starts right after the last moment the
   smoothed pitch was within 0.5° of the reference (only if it touched down ≥1° above it and
   below 60 ft).
3. Fallback, input-based: start of the final sustained pull, where smoothed elevator input last
   crossed 35% of its rise from the approach baseline to its peak.

### Score (this addon's own weights)

Sink rate 25 · Peak G 15 · Touchdown zone 20 · Centreline 15 · Alignment 10 (crab allowance grows
with crosswind) · Attitude 10 · No bounce 5. If no runway is identified, the runway categories
are left out and the rest scaled to 100. A float over 4 s costs up to 10 points. Sink over
600 fpm or over 1.8 g is always graded **Hard**.

### Landing log

Stored in the sim's DataStore (`SetStoredData`/`GetStoredData`), which persists between sessions.
Up to 500 landings; graphs kept for the newest 60 (about 8 KB each); the index is split into
pages of 50 so no single key passes about 70 KB. History page shows averages, best score, a
score trend and a filterable list; any row opens that landing. "Copy as CSV" is planned for
moving data out of the sim.

## How it compares with the X-Plane plugin you linked

Feature parity on: touchdown stats, peak G, wind components, bounce count, runway
identification, threshold distance, signed centreline deviation, pre-touchdown and rollout
graphs, flare marker, landing score, automatic persistent log.

Different by design: own flare algorithm (attitude first, input fallback; no separate
"pre-flare" marker yet), own score weights that include sink rate, a coaching tip, a single EFB
app instead of separate windows, DataStore log instead of a CSV file.

Not included (yet): the live HUD of forces (thrust, drag, lift-to-weight). Most of those
values are not exposed as SimVars for every aircraft. A "Live" page with G, AoA and crab is an
easy addition if wanted.

## SDK findings (checked 19 Nov 2026)

- **EFB apps are a supported SDK feature.** You build an app, not a custom EFB; once packaged it
  appears on the EFB of every aircraft. Built from the SDK's EFB TemplateApp with Node 18+.
  [EFB API docs](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/efb/electronic-flight-bag-api/)
- **Background capture.** `App` has `BootMode` (COLD / WARM / HOT) and an `install()` hook, and
  `SuspendMode` (SLEEP / TERMINATE). The capture service starts in `install()` so it does not
  depend on the app being open. The docs do not state in words whether app code runs while the
  tablet is closed, but a released EFB app (MSFS Passport 2024) says it "tracks your flying in
  the background (even with the EFB closed)", which is strong evidence it works.
  **Still to confirm in our own test flight.** Fallback if it doesn't: a small WASM module that
  records and hands data to the app over the Comm Bus.
- **Reading data.** `SimVar.GetSimVarValue` works the same in EFB apps; Asobo staff advise
  polling in `onUpdate` and minimising reads and DOM updates. We sample 15 SimVars at 20 Hz and
  only push to the UI at 4 Hz.
- **Persistence.** DataStore is saved with the user's save data (cloud save). One devsupport
  report says values were lost for some users who quit through the in-game "Quit to desktop";
  Asobo could not reproduce it. The size limit is not documented, so we cap per-key size and total
  landings. Our log writes after every landing, so at worst the last landing of a session is
  at risk.

## Layout

```
PackageSources/LandingAnalyzer/
  src/core/            plain TS, no sim dependencies (tested in Node)
    types.ts           Sample, LandingSummary, LandingTrace ...
    LandingDetector.ts state machine: idle → armed (<200 ft, descending) → rollout → record
    flare.ts           flare detection
    score.ts           scoring
    geo.ts             runway geometry, wind components, runway matching
  src/storage/         LandingLog (paged DataStore log), DataStoreAdapter
  src/sim/             SimVarSampler (20 Hz SimVar reads), RunwayProvider (FacilityLoader)
  src/ui/              pages: Latest, Analysis, History; chartSvg (dependency-free SVG charts)
  src/AnalyzerService.ts   always-on capture, started from App.install()
  src/LandingAnalyzer.tsx  EFB App + AppView registration
  README-build.md      how to drop this into the SDK's EFB sample and build it
test/                  synthetic approach generator + tests
```

Run the tests: `npm install && npm test` (Node 22.6+; uses Node's built-in TypeScript stripping).

## Next steps

1. Build inside the SDK EFB sample (README-build.md) and fix any `efb_api` API differences.
2. Test flight: confirm capture with the tablet closed, the SimVar sign constants in
   `SimVarSampler.ts`, and whether `OneWayRunway.course` is true or magnetic.
3. Confirm DataStore survives a sim restart (quit both ways).
4. Then: CSV copy-out, per-aircraft filters, a "Live" page, settings (units, thresholds).
