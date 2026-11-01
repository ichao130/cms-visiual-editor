import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { parseFirebaseConfig, type CloudStatus, type FirebaseClientConfig } from "@pcms/shared";

/**
 * Cloud (Firebase) connection — step 1: load the public web config from the PC
 * and report connection status. Secrets never live here; they stay in the
 * Functions environment (CLAUDE.md: APIキーをアプリに埋め込まない). Sign-in and the
 * callable wiring build on top of this once the operator authenticates.
 *
 * Config is read from (in order):
 *   1. the path in PCMS_FIREBASE_CONFIG (used in dev / tests), or
 *   2. firebase.config.json in the app's userData folder.
 */
function configPath(): string {
  const override = process.env.PCMS_FIREBASE_CONFIG;
  if (override && override.trim() !== "") return override;
  return join(app.getPath("userData"), "firebase.config.json");
}

let cached: FirebaseClientConfig | null | undefined;

export function loadFirebaseConfig(): FirebaseClientConfig | null {
  if (cached !== undefined) return cached;
  try {
    const raw = readFileSync(configPath(), "utf8");
    cached = parseFirebaseConfig(JSON.parse(raw));
  } catch {
    // Missing or unreadable file → not configured (not an error state).
    cached = null;
  }
  return cached;
}

/** Current cloud connection status for the dashboard. */
export function cloudStatus(): CloudStatus {
  const config = loadFirebaseConfig();
  if (!config) return { configured: false, signedIn: false };
  // Sign-in is wired in the next step; report configured-but-signed-out for now.
  return { configured: true, projectId: config.projectId, signedIn: false };
}
