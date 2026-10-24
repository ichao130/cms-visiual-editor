import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

// Bundles the three Electron entry points. Workspace TS packages (@pcms/*)
// resolve through Vite, so no separate build step is needed for them.
export default defineConfig({
  main: {
    build: { outDir: "out/main", rollupOptions: { input: "src/main/index.ts" } },
  },
  preload: {
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
