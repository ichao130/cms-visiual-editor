/**
 * Pure form-submission validation (no Firebase), so it is unit-testable.
 * Covers the spam/basic checks CLAUDE.md lists: honeypot, required fields,
 * length caps, and a Turnstile/reCAPTCHA token presence check (the real token
 * verification is a network call done in the handler).
 */

export interface FormFieldDef {
  name: string;
  required?: boolean;
  maxLength?: number;
}

export interface FormConfig {
  fields: FormFieldDef[];
  /** Hidden field that must stay empty; non-empty means a bot. */
  honeypotField?: string;
  /** Require a captcha token field to be present. */
  requireToken?: boolean;
}

export type SubmissionResult =
  | { ok: true; fields: Record<string, string> }
  | { ok: false; errors: string[] }
  | { spam: true };

const TOKEN_KEYS = ["token", "cf-turnstile-response", "g-recaptcha-response"];

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
    fields[f.name] = value;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, fields };
}
