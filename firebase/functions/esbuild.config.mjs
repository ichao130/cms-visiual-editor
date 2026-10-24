import { build } from "esbuild";

// Firebase uploads only the functions directory, so the deploy artifact must be
// self-contained: bundle the workspace packages (@pcms/engine, @pcms/shared) and
// their deps into lib/index.js. firebase-admin / firebase-functions are provided
// at runtime, so they stay external. @anthropic-ai/sdk is loaded via a dynamic
// import of a non-literal specifier, so esbuild leaves it alone (optional dep).
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "lib/index.js",
  external: ["firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*"],
  // Shim require() for any bundled CommonJS dependency under ESM output.
  banner: {
    js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
  },
  logLevel: "info",
});
