import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

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
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: "src/renderer/index.html" },
    },
  },
});
