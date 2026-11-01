import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { parseFirebaseConfig, type CloudStatus, type FirebaseClientConfig } from "@pcms/shared";
import { currentUser } from "./auth.js";

/**
 * Cloud (Firebase) connection — step 1: load the public web config from the PC
 * and report connection status. Secrets never live here; they stay in the
 * Functions environment (CLAUDE.md: APIキーをアプリに埋め込まない). Sign-in and the
 * callable wiring build on top of this once the operator authenticates.
 *
 * Config is read from the first of these that exists:
 *   1. the path in PCMS_FIREBASE_CONFIG (dev / tests),
 *   2. firebase.config.json in the app's userData folder (the installed app),
 *   3. firebase.config.json next to the desktop package (dev convenience).
 */
function configCandidates(): string[] {
  const paths: string[] = [];
  const override = process.env.PCMS_FIREBASE_CONFIG;
  if (override && override.trim() !== "") paths.push(override);
  paths.push(join(app.getPath("userData"), "firebase.config.json"));
  if (!app.isPackaged) paths.push(join(app.getAppPath(), "firebase.config.json"));
  return paths;
}

let cached: FirebaseClientConfig | null | undefined;

export function loadFirebaseConfig(): FirebaseClientConfig | null {
  if (cached !== undefined) return cached;
  cached = null;
  for (const path of configCandidates()) {
    if (!existsSync(path)) continue;
    try {
      cached = parseFirebaseConfig(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      // Unreadable / invalid JSON at this candidate → try the next.
      cached = null;
    }
    if (cached) break;
  }
  return cached;
}

/** Current cloud connection status for the dashboard. */
export function cloudStatus(): CloudStatus {
  const config = loadFirebaseConfig();
  if (!config) return { configured: false, signedIn: false };
  const user = currentUser();
  return {
    configured: true,
    projectId: config.projectId,
    signedIn: Boolean(user),
    email: user?.email,
  };
}
