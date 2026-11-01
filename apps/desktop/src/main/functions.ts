import { getIdToken } from "./auth.js";
import { loadFirebaseConfig } from "./cloud.js";

/**
 * Minimal client for the Firebase callable functions (onCall) from the main
 * process. We don't pull in the Firebase SDK — a callable is just a POST with
 * `{ data }` and a Bearer ID token, answering `{ result }` or `{ error }`.
 * Secrets stay in the Functions environment; the app only sends the ID token
 * minted from the stored refresh token (CLAUDE.md: APIキーをアプリに埋め込まない).
 */

const REGION = "us-central1";

/** Thrown when there is no signed-in session, so callers can fall back quietly. */
export class NotSignedInError extends Error {
  constructor() {
    super("サインインが必要です。");
    this.name = "NotSignedInError";
  }
}

export async function callFunction<T>(name: string, data: unknown): Promise<T> {
  const config = loadFirebaseConfig();
  if (!config) throw new Error("クラウド設定（firebase.config.json）が見つかりません。");
  const token = await getIdToken();
  if (!token) throw new NotSignedInError();

  const url = `https://${REGION}-${config.projectId}.cloudfunctions.net/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = (await res.json().catch(() => null)) as
    | { result?: T; error?: { message?: string } }
    | null;
  if (!res.ok || !body || body.error) {
    throw new Error(body?.error?.message ?? `関数の呼び出しに失敗しました（${res.status}）。`);
  }
  return body.result as T;
}
