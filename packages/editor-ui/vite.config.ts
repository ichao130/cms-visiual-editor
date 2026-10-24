import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev harness + production bundle for the editor renderer.
// In the desktop app the same `mount()` is loaded by apps/desktop; here Vite
// serves a browser build wired to a mock window.pcms so the UI is runnable and
// previewable without Electron.
export default defineConfig({
  plugins: [react()],
  server: { port: 5178, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
