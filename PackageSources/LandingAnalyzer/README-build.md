# Building the EFB app

Verified with MSFS 2024 SDK 1.8.2 (EFB sample: `@efb/efb-api` 1.0.3, `@microsoft/msfs-sdk` 2.1.1).

The build config in this folder (`package.json`, `package-lock.json`, `tsconfig.json`, `.env`,
`build.js`) is the SDK's `TemplateApp` config renamed to `LandingAnalyzer`. It needs the SDK
sample's `efb_api/` and `vendor/` folders next to it, because `@efb/efb-api` is not on npm.

1. Install the SDK **Samples**. They are a separate download: in the sim, turn on Developer Mode,
   then Help > SDK > Samples. You need `<MSFS 2024 SDK>/Samples/DevmodeProjects/EFB/`.
2. Copy that `EFB/` folder somewhere you own.
3. Copy this `LandingAnalyzer/` folder into its `PackageSources/`, next to `TemplateApp/`.
   Copy `PackageDefinitions/landing-analyzer-efb.xml` and `LandingAnalyzerProject.xml` from the
   repo root into the `EFB/` folder (same relative paths). Create
   `PackageDefinitions/landing-analyzer-efb/ContentInfo/` and copy the sample's `thumbnail.jpg`
   into it (or use your own).
4. `npm install` in `efb_api/` and `LandingAnalyzer/`, then `npm run build` in `LandingAnalyzer/`.
   Keep the committed `package-lock.json`: a fresh resolve picks an `esbuild-sass-plugin` that
   needs a newer esbuild than the sample uses, and the install fails.
5. Build the package from the `EFB/` folder:

   ```
   "<MSFS 2024 SDK>\Tools\bin\fspackagetool.exe" LandingAnalyzerProject.xml -nopause -rebuild -outputdir Packages -tempdir _PackageInt
   ```

   fspackagetool runs the sim in a background package-build mode and closes it when done.
6. Copy `Packages/Packages/landing-analyzer-efb/` (the folder with `manifest.json` and
   `layout.json`; the project XML adds the inner `Packages`) into your Community folder.

Notes:

- The app class is named `LandingAnalyzer` on purpose. The EFB uses the class name as the app's
  internal name, and `build.js` scopes the CSS to `.efb-view.<folder name>`, as in the sample.
- `tsconfig.json` sets `allowImportingTsExtensions` (with `noEmit`) because the core files
  import with `.ts` extensions so they also run under Node's test runner.
- The build targets ES2017 (Coherent GT), so avoid newer built-ins such as `Array.flatMap`.
