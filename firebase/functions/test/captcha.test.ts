import { afterEach, describe, expect, it } from "vitest";
import {
  RecaptchaVerifier,
  TurnstileVerifier,
  makeCaptchaVerifier,
  type Http,
  type HttpResponse,
} from "../src/captcha/verify.js";
import { captchaToken } from "../src/validate.js";

const ok = (body: unknown): HttpResponse => ({ ok: true, status: 200, json: async () => body });

describe("captchaToken", () => {
  it("reads the Turnstile / reCAPTCHA / generic token keys", () => {
    expect(captchaToken({ "cf-turnstile-response": " abc " })).toBe("abc");
    expect(captchaToken({ "g-recaptcha-response": "xyz" })).toBe("xyz");
    expect(captchaToken({ token: "t" })).toBe("t");
    expect(captchaToken({})).toBe("");
  });
});

describe("TurnstileVerifier", () => {
  it("posts the secret + response form-encoded and accepts success", async () => {
    let seen: { url: string; ct: string; body: string } | null = null;
    const http: Http = async (url, init) => {
      seen = { url, ct: init.headers["Content-Type"], body: init.body };
      return ok({ success: true });
    };
    const r = await new TurnstileVerifier("SECRET", http).verify("TOK", "1.2.3.4");
    expect(seen!.url).toContain("challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(seen!.ct).toBe("application/x-www-form-urlencoded");
    expect(seen!.body).toContain("secret=SECRET");
    expect(seen!.body).toContain("response=TOK");
    expect(seen!.body).toContain("remoteip=1.2.3.4");
    expect(r.ok).toBe(true);
  });

  it("fails with the provider error codes", async () => {
    const http: Http = async () => ok({ success: false, "error-codes": ["invalid-input-response"] });
    const r = await new TurnstileVerifier("s", http).verify("bad");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-input-response");
  });

  it("rejects a missing token without calling the provider", async () => {
    let called = false;
    const http: Http = async () => {
      called = true;
      return ok({ success: true });
    };
    const r = await new TurnstileVerifier("s", http).verify("");
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("RecaptchaVerifier", () => {
  it("enforces a minimum score for v3", async () => {
    const http: Http = async () => ok({ success: true, score: 0.3 });
    const low = await new RecaptchaVerifier("s", http, 0.5).verify("t");
    expect(low.ok).toBe(false);
    expect(low.reason).toContain("low-score");

    const http2: Http = async () => ok({ success: true, score: 0.9 });
    const high = await new RecaptchaVerifier("s", http2, 0.5).verify("t");
    expect(high.ok).toBe(true);
  });

  it("accepts any score when no minimum is set (v2)", async () => {
    const http: Http = async () => ok({ success: true });
    expect((await new RecaptchaVerifier("s", http).verify("t")).ok).toBe(true);
  });

  it("throws on a non-OK siteverify response", async () => {
    const http: Http = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(new RecaptchaVerifier("s", http).verify("t")).rejects.toThrow(/siteverify error: 500/);
  });
});

describe("makeCaptchaVerifier", () => {
  const keys = ["TURNSTILE_SECRET", "RECAPTCHA_SECRET", "RECAPTCHA_MIN_SCORE"];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const clear = () => keys.forEach((k) => delete process.env[k]);

  it("is null when no secret is configured (presence-only fallback)", () => {
    clear();
    expect(makeCaptchaVerifier(process.env)).toBeNull();
  });

  it("prefers Turnstile when its secret is set", () => {
    clear();
    process.env.TURNSTILE_SECRET = "k";
    expect(makeCaptchaVerifier(process.env)?.name).toBe("turnstile");
  });

  it("uses reCAPTCHA when only its secret is set", () => {
    clear();
    process.env.RECAPTCHA_SECRET = "k";
    expect(makeCaptchaVerifier(process.env)?.name).toBe("recaptcha");
  });
});
