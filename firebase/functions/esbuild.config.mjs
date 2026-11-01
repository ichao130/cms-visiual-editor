import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Firebase uploads only the functions directory, so the deploy artifact must be
// self-contained: bundle the workspace packages (@pcms/engine, @pcms/shared) and
// their deps into lib/index.js. firebase-admin / firebase-functions are provided
// at runtime, so they stay external. @anthropic-ai/sdk is loaded via a dynamic
// import of a non-literal specifier, so esbuild leaves it alone (optional dep).
//
// The workspace packages are resolved by alias straight to their source, so they
// are NOT listed in this package's package.json — the uploaded manifest then
// carries no "workspace:*" specifier for Cloud Build's npm install to choke on.
const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => resolve(here, p);
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "lib/index.js",
  alias: {
    "@pcms/engine": src("../../packages/engine/src/index.ts"),
    "@pcms/shared": src("../../packages/shared/src/index.ts"),
  },
  external: ["firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*"],
  // Shim require() for any bundled CommonJS dependency under ESM output.
  banner: {
    js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
  },
  logLevel: "info",
});
