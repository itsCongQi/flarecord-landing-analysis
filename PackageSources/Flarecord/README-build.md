# Building the EFB app

Verified with MSFS 2024 SDK 1.8.2 (EFB sample: `@efb/efb-api` 1.0.3, `@microsoft/msfs-sdk` 2.1.1).

The build config in this folder (`package.json`, `package-lock.json`, `tsconfig.json`, `.env`,
`build.js`) is the SDK's `TemplateApp` config renamed to `Flarecord`. It needs the SDK
sample's `efb_api/` and `vendor/` folders next to it, because `@efb/efb-api` is not on npm.

1. Install the SDK **Samples**. They are a separate download: in the sim, turn on Developer Mode,
   then Help > SDK > Samples. You need `<MSFS 2024 SDK>/Samples/DevmodeProjects/EFB/`.
2. Copy that `EFB/` folder somewhere you own.
3. Copy this `Flarecord/` folder into its `PackageSources/`, next to `TemplateApp/`.
   Copy `PackageDefinitions/flarecord-landing-monitor.xml` and `FlarecordProject.xml` from the
   repo root into the `EFB/` folder (same relative paths). Create
   `PackageDefinitions/flarecord-landing-monitor/ContentInfo/` and copy the sample's `thumbnail.jpg`
   into it (or use your own).
4. `npm install` in `efb_api/` and `Flarecord/`, then `npm run build` in `Flarecord/`.
   Keep the committed `package-lock.json`: a fresh resolve picks an `esbuild-sass-plugin` that
   needs a newer esbuild than the sample uses, and the install fails.
5. Build the package from the `EFB/` folder:

   ```
   "<MSFS 2024 SDK>\Tools\bin\fspackagetool.exe" FlarecordProject.xml -nopause -rebuild -outputdir Packages -tempdir _PackageInt
   ```

   fspackagetool runs the sim in a background package-build mode and closes it when done.
6. Copy `Packages/Packages/flarecord-landing-monitor/` (the folder with `manifest.json` and
   `layout.json`; the project XML adds the inner `Packages`) into your Community folder.

Notes:

- The app class is named `Flarecord` on purpose. The EFB uses the class name as the app's
  internal name, and `build.js` scopes the CSS to `.efb-view.<folder name>`, as in the sample.
- `tsconfig.json` sets `allowImportingTsExtensions` (with `noEmit`) because the core files
  import with `.ts` extensions so they also run under Node's test runner.
- The build targets ES2017 (Coherent GT), so avoid newer built-ins such as `Array.flatMap`.
