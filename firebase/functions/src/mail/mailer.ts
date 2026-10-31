import type { MailMessage } from "./compose.js";

/**
 * Mail delivery behind the form receiver. The real sender (SendGrid HTTP API)
 * holds its key in the proxy env, never in the app (CLAUDE.md). HTTP is injected
 * so the payload shaping is unit-tested without network or credentials; with
 * nothing configured, the offline MockMailer records messages so the evaluation
 * build runs end-to-end.
 */

export interface Mailer {
  readonly name: string;
  send(msg: MailMessage): Promise<void>;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type Http = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<HttpResponse>;

/** Offline mailer: records what would be sent (evaluation build / tests). */
export class MockMailer implements Mailer {
  readonly name = "mock";
  readonly sent: MailMessage[] = [];
  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }
}

/** SendGrid v3 mail/send. `from` must be a verified sender in the account. */
export class SendgridMailer implements Mailer {
  readonly name = "sendgrid";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly http: Http,
  ) {}

  async send(msg: MailMessage): Promise<void> {
    const payload = {
      personalizations: [
        {
          to: msg.to.map((email) => ({ email })),
          ...(msg.replyTo ? {} : {}),
        },
      ],
      from: { email: this.from },
      ...(msg.replyTo ? { reply_to: { email: msg.replyTo } } : {}),
      subject: msg.subject,
      content: [{ type: "text/plain", value: msg.text }],
    };
    const res = await this.http("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`SendGrid error: ${res.status} ${await res.text()}`);
    }
  }
}

/** Pick a mailer from the environment; falls back to the offline mock. */
export function makeMailer(
  env: NodeJS.ProcessEnv = process.env,
  http: Http = globalThis.fetch as unknown as Http,
): Mailer {
  if (env.SENDGRID_API_KEY && env.MAIL_FROM) {
    return new SendgridMailer(env.SENDGRID_API_KEY, env.MAIL_FROM, http);
  }
  return new MockMailer();
}
