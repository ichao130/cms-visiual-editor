/**
 * Pure form-submission validation (no Firebase), so it is unit-testable.
 * Covers the spam/basic checks CLAUDE.md lists: honeypot, required fields,
 * length caps, and a Turnstile/reCAPTCHA token presence check (the real token
 * verification is a network call done in the handler).
 */

export interface FormFieldDef {
  name: string;
  /** Human label, used in notification / auto-reply mail. */
  label?: string;
  required?: boolean;
  maxLength?: number;
  /** Field type; "email" adds a format check. Others are treated as free text. */
  type?: string;
}

// Conservative email shape: one @, non-empty local/domain, a dotted domain. The
// real deliverability is not checked here — this only rejects obvious garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FormConfig {
  /** Form display name, used in mail subjects. */
  name?: string;
  fields: FormFieldDef[];
  /** Hidden field that must stay empty; non-empty means a bot. */
  honeypotField?: string;
  /** Require a captcha token field to be present. */
  requireToken?: boolean;
  /** Notification recipients (複数宛先). */
  notifyEmails?: string[];
  /** Override the notification subject. */
  notifySubject?: string;
  /** Send an auto-reply to the submitter's email field. */
  autoReply?: boolean;
  /** Override the auto-reply subject / body. */
  autoReplySubject?: string;
  autoReplyBody?: string;
  /** Message shown on the completion page (also the auto-reply fallback body). */
  completionMessage?: string;
  /**
   * Store the submission in Firestore. Default true; false = 「保存せずメール
   * 転送だけ」 (CLAUDE.md privacy option) — only the notification mail is sent.
   */
  storeSubmission?: boolean;
}

export type SubmissionResult =
  | { ok: true; fields: Record<string, string> }
  | { ok: false; errors: string[] }
  | { spam: true };

const TOKEN_KEYS = ["token", "cf-turnstile-response", "g-recaptcha-response"];

/** The captcha token from a submission (Turnstile / reCAPTCHA / generic), or "". */
export function captchaToken(data: Record<string, unknown> | undefined): string {
  const d = data ?? {};
  return TOKEN_KEYS.map((k) => String(d[k] ?? "").trim()).find((v) => v !== "") ?? "";
}

export function validateSubmission(
  data: Record<string, unknown> | undefined,
  config: FormConfig,
): SubmissionResult {
  const d = data ?? {};

  if (config.honeypotField) {
    const trap = String(d[config.honeypotField] ?? "").trim();
    if (trap !== "") return { spam: true };
  }

  if (config.requireToken) {
    const token = TOKEN_KEYS.map((k) => String(d[k] ?? "").trim()).find((v) => v !== "");
    if (!token) return { ok: false, errors: ["確認トークンがありません。"] };
  }

  const errors: string[] = [];
  const fields: Record<string, string> = {};
  for (const f of config.fields) {
    const value = d[f.name] == null ? "" : String(d[f.name]).trim();
    if (f.required && value === "") {
      errors.push(`「${f.name}」は必須です。`);
      continue;
    }
    if (f.maxLength != null && value.length > f.maxLength) {
      errors.push(`「${f.name}」が長すぎます。`);
      continue;
    }
    if (f.type === "email" && value !== "" && !EMAIL_RE.test(value)) {
      errors.push(`「${f.name}」のメールアドレスの形式が正しくありません。`);
      continue;
    }
    fields[f.name] = value;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, fields };
}
