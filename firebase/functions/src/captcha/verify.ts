/**
 * Captcha token verification (Cloudflare Turnstile / Google reCAPTCHA). The
 * secret lives in the proxy env, never in the app (CLAUDE.md スパム対策). HTTP is
 * injected so the siteverify request shaping and response parsing are
 * unit-tested without network or a real secret. With no secret configured the
 * verifier is null and the handler keeps its presence-only check.
 */

export interface CaptchaResult {
  ok: boolean;
  /** Provider error codes when it failed, for logging. */
  reason?: string;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type Http = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<HttpResponse>;

export interface CaptchaVerifier {
  readonly name: string;
  verify(token: string, remoteIp?: string): Promise<CaptchaResult>;
}

interface SiteverifyResponse {
  success?: boolean;
  score?: number;
  "error-codes"?: string[];
}

async function siteverify(
  http: Http,
  url: string,
  params: Record<string, string>,
): Promise<SiteverifyResponse> {
  const body = new URLSearchParams(params).toString();
  const res = await http(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`captcha siteverify error: ${res.status}`);
  return (await res.json()) as SiteverifyResponse;
}

const errReason = (r: SiteverifyResponse): string | undefined =>
  r["error-codes"] && r["error-codes"].length > 0 ? r["error-codes"].join(",") : undefined;

/** Cloudflare Turnstile. */
export class TurnstileVerifier implements CaptchaVerifier {
  readonly name = "turnstile";
  constructor(
    private readonly secret: string,
    private readonly http: Http,
  ) {}

  async verify(token: string, remoteIp?: string): Promise<CaptchaResult> {
    if (!token) return { ok: false, reason: "missing-token" };
    const r = await siteverify(this.http, "https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      secret: this.secret,
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {}),
    });
    return { ok: r.success === true, reason: r.success ? undefined : errReason(r) };
  }
}

/** Google reCAPTCHA (v2 checkbox, or v3 with an optional minimum score). */
export class RecaptchaVerifier implements CaptchaVerifier {
  readonly name = "recaptcha";
  constructor(
    private readonly secret: string,
    private readonly http: Http,
    /** v3 minimum score (0–1); undefined accepts any score (v2). */
    private readonly minScore?: number,
  ) {}

  async verify(token: string, remoteIp?: string): Promise<CaptchaResult> {
    if (!token) return { ok: false, reason: "missing-token" };
    const r = await siteverify(this.http, "https://www.google.com/recaptcha/api/siteverify", {
      secret: this.secret,
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {}),
    });
    if (r.success !== true) return { ok: false, reason: errReason(r) };
    if (this.minScore != null && (r.score ?? 0) < this.minScore) {
      return { ok: false, reason: `low-score:${r.score ?? 0}` };
    }
    return { ok: true };
  }
}

/** Pick a verifier from the env; null when no secret is configured. */
export function makeCaptchaVerifier(
  env: NodeJS.ProcessEnv = process.env,
  http: Http = globalThis.fetch as unknown as Http,
): CaptchaVerifier | null {
  if (env.TURNSTILE_SECRET) return new TurnstileVerifier(env.TURNSTILE_SECRET, http);
  if (env.RECAPTCHA_SECRET) {
    const min = env.RECAPTCHA_MIN_SCORE ? Number(env.RECAPTCHA_MIN_SCORE) : undefined;
    return new RecaptchaVerifier(
      env.RECAPTCHA_SECRET,
      http,
      min != null && Number.isFinite(min) ? min : undefined,
    );
  }
  return null;
}
