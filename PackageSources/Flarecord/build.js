const copyStaticFiles = require("esbuild-copy-static-files");
const globalExternals = require("@fal-works/esbuild-plugin-global-externals");
const { typecheckPlugin } = require("@jgoz/esbuild-plugin-typecheck");
const esbuild = require("esbuild");
const postcss = require("postcss");
const postCssUrl = require("postcss-url");
const postcssPrefixSelector = require("postcss-prefix-selector");
const sassPlugin = require("esbuild-sass-plugin");

require("dotenv").config({ path: __dirname + "/.env" });

const env = {
  typechecking: process.env.TYPECHECKING === "true",
  sourcemaps: process.env.SOURCE_MAPS === "true",
  minify: process.env.MINIFY === "true",
};

const baseConfig = {
  entryPoints: ["src/Flarecord.tsx"],
  keepNames: true,
  bundle: true,
  outdir: "dist",
  sourcemap: env.sourcemaps,
  minify: env.minify,
  logLevel: "debug",
  loader: {
    ".html": "copy",
  },
  target: "es2017",
  define: { BASE_URL: `"coui://html_ui/efb_ui/efb_apps/Flarecord"` },
  plugins: [
    copyStaticFiles({
      src: "./Assets",
      dest: "./dist/Assets",
    }),
    globalExternals.globalExternals({
      "@microsoft/msfs-sdk": {
        varName: "msfssdk",
        type: "cjs",
      },
      "@workingtitlesim/garminsdk": {
        varName: "garminsdk",
        type: "cjs",
      },
    }),
    sassPlugin.sassPlugin({
      async transform(source) {
        const { css } = await postcss([
          postCssUrl({
            url: "copy",
          }),
          postcssPrefixSelector({
            prefix: `.efb-view.${__dirname.split("\\").at(-1)}`,
          }),
        ]).process(source, { from: undefined });
        return css;
      },
    }),
  ],
};

/**
 * The simulator's JS engine rejects a unary operator directly in front of `await`
 * (`!await x`, `typeof await x`), and a script that fails to parse is dropped without the app
 * ever appearing on the tablet. esbuild prints `!(await x)` as `!await x`, so check the output.
 */
function checkBundle() {
  const fs = require("fs");
  const lines = fs.readFileSync(__dirname + "/dist/Flarecord.js", "utf8").split("\n");
  const bad = [];
  lines.forEach((line, i) => {
    if (/(?:[!~]|\btypeof|\bvoid)\s*await\b/.test(line)) bad.push(`${i + 1}: ${line.trim()}`);
  });
  if (bad.length) {
    console.error("Flarecord.js has an operator in front of await, which the sim cannot parse.");
    console.error("Store the awaited value in a variable first:\n" + bad.join("\n"));
    process.exit(1);
  }
}

if (env.typechecking) {
  baseConfig.plugins.push(
    typecheckPlugin({ watch: process.env.SERVING_MODE === "WATCH" })
  );
}

if (process.env.SERVING_MODE === "WATCH") {
  esbuild.context(baseConfig).then((ctx) => ctx.watch());
} else if (process.env.SERVING_MODE === "SERVE") {
  esbuild
    .context(baseConfig)
    .then((ctx) => ctx.serve({ port: process.env.PORT_SERVER }));
} else if (["", undefined].includes(process.env.SERVING_MODE)) {
  esbuild.build(baseConfig).then(checkBundle);
} else {
  console.error(`MODE ${process.env.SERVING_MODE} is unknown`);
}
