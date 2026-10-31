import type { FormConfig } from "../validate.js";

/**
 * Pure composition of the notification and auto-reply mail for a form
 * submission (no network, no Firebase), so the content is unit-testable. The
 * handler sends the result through a Mailer. CLAUDE.md: 通知メール（複数宛先）,
 * 自動返信.
 */

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  /** Reply-To, set to the submitter's address on notifications when known. */
  replyTo?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The submitter's address, taken from the first email-typed field. */
function submitterEmail(config: FormConfig, fields: Record<string, string>): string | undefined {
  const field = config.fields.find((f) => f.type === "email");
  const value = field ? (fields[field.name] ?? "").trim() : "";
  return value !== "" && EMAIL_RE.test(value) ? value : undefined;
}

/** "ラベル: 値" lines for every defined field, in form order. */
function fieldLines(config: FormConfig, fields: Record<string, string>): string {
  return config.fields
    .map((f) => `${f.label ?? f.name}: ${fields[f.name] ?? ""}`)
    .join("\n");
}

const clean = (list: string[] | undefined): string[] =>
  (list ?? []).map((s) => s.trim()).filter((s) => s !== "");

/**
 * Notification mail to the form's recipients. Returns null when no recipient is
 * configured (nothing to send). Reply-To is the submitter so the owner can
 * reply straight from their inbox.
 */
export function composeNotification(
  config: FormConfig,
  fields: Record<string, string>,
  opts: { siteName?: string } = {},
): MailMessage | null {
  const to = clean(config.notifyEmails);
  if (to.length === 0) return null;
  const formName = config.name ?? "フォーム";
  const site = (opts.siteName ?? "").trim();
  const subject =
    config.notifySubject?.trim() ||
    (site ? `[${site}] ${formName}に新しい送信がありました` : `${formName}に新しい送信がありました`);
  const text = `${formName}に新しい送信がありました。\n\n${fieldLines(config, fields)}`;
  const replyTo = submitterEmail(config, fields);
  return { to, subject, text, ...(replyTo ? { replyTo } : {}) };
}

/**
 * Auto-reply to the submitter. Returns null when auto-reply is off or the
 * submission has no valid email field (nobody to reply to).
 */
export function composeAutoReply(
  config: FormConfig,
  fields: Record<string, string>,
): MailMessage | null {
  if (!config.autoReply) return null;
  const to = submitterEmail(config, fields);
  if (!to) return null;
  const subject = config.autoReplySubject?.trim() || "お問い合わせありがとうございます";
  const intro =
    config.autoReplyBody?.trim() ||
    config.completionMessage?.trim() ||
    "お問い合わせを受け付けました。内容を確認のうえ、折り返しご連絡いたします。";
  const text = `${intro}\n\n--- 送信内容 ---\n${fieldLines(config, fields)}`;
  return { to: [to], subject, text };
}
