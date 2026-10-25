import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the editor dev harness (Vite + mock window.pcms) in a
 * real browser. Run with `pnpm test:e2e` (needs `pnpm exec playwright install
 * chromium` once). The web server is reused if one is already running on 5178.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5178",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm --filter @pcms/editor-ui dev",
    url: "http://localhost:5178",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
