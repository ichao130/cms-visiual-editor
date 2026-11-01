import { createHash } from "node:crypto";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { EDITOR_RUNTIME } from "../../packages/editor-ui/src/preview/editorRuntime";

/**
 * Replace `__PREVIEW_RUNTIME_HASH__` in the renderer HTML's CSP with the
 * sha256 of the editor runtime that the preview iframe runs inline. Computed
 * from the same constant the preview injects, so the hash can never drift.
 * Keeps the main window's `script-src` free of 'unsafe-inline'.
 */
const PREVIEW_HASH_TOKEN = "__PREVIEW_RUNTIME_HASH__";

function previewRuntimeCspPlugin() {
  const csp = `'sha256-${createHash("sha256").update(EDITOR_RUNTIME).digest("base64")}'`;
  const swap = (html: string) => html.replaceAll(PREVIEW_HASH_TOKEN, csp);
  return {
    name: "pcms-preview-runtime-csp",
    // Dev serve goes through transformIndexHtml; the production build emits the
    // HTML as a rollup asset, which electron-vite does not run that hook over —
    // so rewrite it in generateBundle too.
    transformIndexHtml(html: string) {
      return swap(html);
    },
    generateBundle(_options: unknown, bundle: Record<string, { type: string; source?: unknown }>) {
      for (const file of Object.values(bundle)) {
        if (file.type === "asset" && typeof file.source === "string" && file.source.includes(PREVIEW_HASH_TOKEN)) {
          file.source = swap(file.source);
        }
      }
    },
  };
}

// Bundles the three Electron entry points. The @pcms/* workspace packages are
// devDependencies and get bundled into the output here (so they need not be in
// the packaged node_modules); only real runtime deps (electron-updater,
// ssh2-sftp-client) stay external via externalizeDepsPlugin.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: "out/main", rollupOptions: { input: "src/main/index.ts" } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: "out/preload", rollupOptions: { input: "src/preload/index.ts" } },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react(), previewRuntimeCspPlugin()],
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: "src/renderer/index.html" },
    },
  },
});
