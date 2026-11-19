# Building the EFB app

This folder replaces the SDK's `TemplateApp`. To build it:

1. Copy `<MSFS 2024 SDK>/Samples/DevmodeProjects/EFB/` somewhere you own.
2. Copy this `LandingAnalyzer/` folder next to `TemplateApp/` in its `PackageSources/`.
3. Copy `TemplateApp`'s `package.json`, `tsconfig.json`, `.env`, build config and
   `*.code-workspace` into `LandingAnalyzer/`, then replace every `TemplateApp` name with
   `LandingAnalyzer` (entry file is `src/LandingAnalyzer.tsx`).
4. In `tsconfig.json` add `"allowImportingTsExtensions": true` and `"noEmit": true` (the core
   files import with `.ts` extensions so they also run under Node's test runner; the bundler
   emits the output). Add `"@microsoft/msfs-types"` to `types` for `SimVar`.
5. `npm install` in `efb_api/` and `LandingAnalyzer/`, then `npm run build`.
6. Point the package definition (the sample's `PackageDefinitions/*.xml`) at the
   `LandingAnalyzer/dist` output and build the package in the sim's Project Editor
   (Dev Mode), or with `fspackagetool`.

The `TemplateApp` file names and the exact `@efb/efb-api` exports used in
`src/LandingAnalyzer.tsx` follow the SDK sample; if your SDK version differs, match the
sample's `TemplateApp.tsx`.
