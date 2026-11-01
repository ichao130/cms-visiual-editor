import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { app, safeStorage, shell } from "electron";
import type { CloudStatus } from "@pcms/shared";
import { cloudStatus, loadFirebaseConfig } from "./cloud.js";

/**
 * Desktop Google sign-in (CLAUDE.md: GUIで完結 / 案A). The flow runs entirely in
 * the main process:
 *   1. open the OS browser to Google's OAuth consent (loopback redirect + PKCE),
 *   2. catch the redirect on a throwaway 127.0.0.1 server, exchange the code for
 *      a Google ID token,
 *   3. trade that ID token for a Firebase session via the Identity Toolkit REST
 *      API (accounts:signInWithIdp),
 *   4. keep only the Firebase refresh token on the PC, encrypted with safeStorage.
 *
 * Nothing here is uploaded: the OAuth client id/secret live in the gitignored
 * firebase.config.json, and the refresh token stays in userData. ID tokens are
 * minted on demand (getIdToken) for the Firebase callables.
 */

interface StoredAuth {
  refreshToken: string;
  localId: string;
  email?: string;
  displayName?: string;
}

const authPath = () => join(app.getPath("userData"), "auth.json");

/** Cached Firebase ID token (short-lived) so repeated callable calls don't refresh each time. */
let idTokenCache: { token: string; expiresAt: number } | null = null;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadAuth(): StoredAuth | null {
  const path = authPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { enc: boolean; data: string };
    const json = raw.enc
      ? safeStorage.decryptString(Buffer.from(raw.data, "base64"))
      : Buffer.from(raw.data, "base64").toString("utf8");
    return JSON.parse(json) as StoredAuth;
  } catch {
    return null;
  }
}

function saveAuth(auth: StoredAuth): void {
  const json = JSON.stringify(auth);
  const enc = safeStorage.isEncryptionAvailable();
  const data = enc
    ? safeStorage.encryptString(json).toString("base64")
    : Buffer.from(json, "utf8").toString("base64");
  writeFileSync(authPath(), JSON.stringify({ enc, data }), "utf8");
}

function clearAuth(): void {
  idTokenCache = null;
  try {
    rmSync(authPath(), { force: true });
  } catch {
    /* already gone */
  }
}

/** The signed-in operator, if any — read by cloudStatus(). */
export function currentUser(): { email?: string } | null {
  const auth = loadAuth();
  return auth ? { email: auth.email } : null;
}

const SIGNIN_DONE_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>サインイン完了</title><style>body{font-family:system-ui,sans-serif;background:#f4f5f7;
color:#1f2430;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#fff;border-radius:12px;padding:40px 48px;box-shadow:0 8px 30px rgba(0,0,0,.08);
text-align:center}h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#5b6472;font-size:14px}</style></head>
<body><div class="card"><h1>サインインが完了しました</h1><p>このタブを閉じて KUMITO に戻ってください。</p></div></body></html>`;

/** Run the loopback OAuth dance and return the authorization code + the exact redirect URI used. */
function authorizeWithGoogle(clientId: string): Promise<{ code: string; redirectUri: string; verifier: string }> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  return new Promise((resolve, reject) => {
    let redirectUri = "";
    let timer: NodeJS.Timeout | undefined;
    const finish = (fn: () => void) => {
      if (timer) clearTimeout(timer);
      server.close();
      fn();
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const err = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (!err && !code) {
        // favicon or other stray request before the redirect arrives.
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(SIGNIN_DONE_HTML);
      if (err) return finish(() => reject(new Error(`サインインがキャンセルされました（${err}）。`)));
      if (url.searchParams.get("state") !== state) {
        return finish(() => reject(new Error("サインインの検証に失敗しました（state不一致）。もう一度お試しください。")));
      }
      if (!code) return finish(() => reject(new Error("認可コードを取得できませんでした。")));
      finish(() => resolve({ code, redirectUri, verifier }));
    });

    server.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      redirectUri = `http://127.0.0.1:${port}`;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "openid email profile");
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("prompt", "select_account");
      void shell.openExternal(authUrl.toString());
    });

    // Give up if the operator never completes the browser flow.
    timer = setTimeout(() => finish(() => reject(new Error("サインインがタイムアウトしました。もう一度お試しください。"))), 5 * 60_000);
  });
}

/** Start the full Google → Firebase sign-in and persist the session. */
export async function signIn(): Promise<CloudStatus> {
  const config = loadFirebaseConfig();
  if (!config) throw new Error("クラウド設定（firebase.config.json）が見つかりません。");
  if (!config.googleClientId) {
    throw new Error("GoogleのクライアントIDが未設定です。firebase.config.json に googleClientId を追加してください。");
  }

  const { code, redirectUri, verifier } = await authorizeWithGoogle(config.googleClientId);

  // 1. Google: authorization code → ID token (PKCE; secret sent when configured).
  const tokenBody = new URLSearchParams({
    client_id: config.googleClientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (config.googleClientSecret) tokenBody.set("client_secret", config.googleClientSecret);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    if (/client_secret|invalid_client/i.test(detail)) {
      throw new Error(
        "Googleのトークン交換に失敗しました。firebase.config.json に googleClientSecret（デスクトップ用クライアントシークレット）を追加してください。",
      );
    }
    throw new Error(`Googleのトークン交換に失敗しました（${tokenRes.status}）。`);
  }
  const googleTokens = (await tokenRes.json()) as { id_token?: string };
  if (!googleTokens.id_token) throw new Error("GoogleのIDトークンを取得できませんでした。");

  // 2. Firebase: Google ID token → Firebase session (Identity Toolkit REST).
  const idpRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postBody: `id_token=${googleTokens.id_token}&providerId=google.com`,
        requestUri: redirectUri,
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
    },
  );
  if (!idpRes.ok) {
    throw new Error(
      `Firebaseサインインに失敗しました（${idpRes.status}）。Firebase Authentication で Google プロバイダが有効か確認してください。`,
    );
  }
  const fb = (await idpRes.json()) as {
    idToken: string;
    refreshToken: string;
    expiresIn: string;
    email?: string;
    localId: string;
    displayName?: string;
  };

  saveAuth({ refreshToken: fb.refreshToken, localId: fb.localId, email: fb.email, displayName: fb.displayName });
  idTokenCache = { token: fb.idToken, expiresAt: Date.now() + Number(fb.expiresIn) * 1000 - 60_000 };
  return cloudStatus();
}

/** Forget the local session. */
export function signOut(): CloudStatus {
  clearAuth();
  return cloudStatus();
}

/**
 * A fresh Firebase ID token for authenticating callables, refreshed from the
 * stored refresh token when the cached one is stale. Null when not signed in.
 */
export async function getIdToken(): Promise<string | null> {
  if (idTokenCache && idTokenCache.expiresAt > Date.now()) return idTokenCache.token;
  const auth = loadAuth();
  const config = loadFirebaseConfig();
  if (!auth || !config) return null;
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: auth.refreshToken }).toString(),
  });
  if (!res.ok) {
    // Refresh token revoked/expired → drop the stale session.
    clearAuth();
    return null;
  }
  const data = (await res.json()) as { id_token: string; expires_in: string };
  idTokenCache = { token: data.id_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 - 60_000 };
  return data.id_token;
}
