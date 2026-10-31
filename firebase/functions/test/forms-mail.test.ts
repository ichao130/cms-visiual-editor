import { afterEach, describe, expect, it } from "vitest";
import { composeAutoReply, composeNotification } from "../src/mail/compose.js";
import {
  MockMailer,
  SendgridMailer,
  makeMailer,
  type Http,
  type HttpResponse,
} from "../src/mail/mailer.js";
import type { FormConfig } from "../src/validate.js";

const config: FormConfig = {
  name: "お問い合わせ",
  fields: [
    { name: "nombre", label: "お名前", type: "text" },
    { name: "mail", label: "メール", type: "email" },
    { name: "msg", label: "本文", type: "textarea" },
  ],
  notifyEmails: [" owner@example.com ", "", "staff@example.com"],
  autoReply: true,
};
const fields = { nombre: "田中", mail: "tanaka@example.com", msg: "こんにちは" };

describe("composeNotification", () => {
  it("addresses all configured recipients and lists the fields", () => {
    const msg = composeNotification(config, fields, { siteName: "テスト珈琲店" });
    expect(msg).not.toBeNull();
    expect(msg!.to).toEqual(["owner@example.com", "staff@example.com"]);
    expect(msg!.subject).toBe("[テスト珈琲店] お問い合わせに新しい送信がありました");
    expect(msg!.text).toContain("お名前: 田中");
    expect(msg!.text).toContain("メール: tanaka@example.com");
    // Reply-To is the submitter so the owner can reply directly.
    expect(msg!.replyTo).toBe("tanaka@example.com");
  });

  it("returns null when there are no recipients", () => {
    expect(composeNotification({ ...config, notifyEmails: [] }, fields)).toBeNull();
  });

  it("drops Reply-To when the email field is missing or invalid", () => {
    const msg = composeNotification(config, { ...fields, mail: "not-an-email" });
    expect(msg!.replyTo).toBeUndefined();
  });

  it("uses a custom subject when set", () => {
    const msg = composeNotification({ ...config, notifySubject: "新着!" }, fields);
    expect(msg!.subject).toBe("新着!");
  });
});

describe("composeAutoReply", () => {
  it("replies to the submitter with their submission echoed back", () => {
    const msg = composeAutoReply(config, fields);
    expect(msg!.to).toEqual(["tanaka@example.com"]);
    expect(msg!.subject).toBe("お問い合わせありがとうございます");
    expect(msg!.text).toContain("--- 送信内容 ---");
    expect(msg!.text).toContain("本文: こんにちは");
  });

  it("is null when auto-reply is off", () => {
    expect(composeAutoReply({ ...config, autoReply: false }, fields)).toBeNull();
  });

  it("is null when the submitter gave no valid email", () => {
    expect(composeAutoReply(config, { ...fields, mail: "" })).toBeNull();
  });

  it("prefers the configured body, then the completion message", () => {
    expect(composeAutoReply({ ...config, autoReplyBody: "受付ました" }, fields)!.text).toContain(
      "受付ました",
    );
    expect(
      composeAutoReply({ ...config, completionMessage: "ありがとう" }, fields)!.text,
    ).toContain("ありがとう");
  });
});

describe("MockMailer", () => {
  it("records what it would send", async () => {
    const m = new MockMailer();
    await m.send({ to: ["a@b.c"], subject: "s", text: "t" });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].subject).toBe("s");
  });
});

describe("SendgridMailer", () => {
  it("posts a v3 mail/send payload with the bearer key and reply_to", async () => {
    let seen: { url: string; auth: string; body: unknown } | null = null;
    const http: Http = async (url, init) => {
      seen = { url, auth: init.headers.Authorization, body: JSON.parse(init.body) };
      return { ok: true, status: 202, text: async () => "" } satisfies HttpResponse;
    };
    await new SendgridMailer("KEY", "from@site.test", http).send({
      to: ["x@y.z", "p@q.r"],
      subject: "件名",
      text: "本文",
      replyTo: "visitor@site.test",
    });
    expect(seen!.url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(seen!.auth).toBe("Bearer KEY");
    const body = seen!.body as {
      personalizations: { to: { email: string }[] }[];
      from: { email: string };
      reply_to: { email: string };
      subject: string;
    };
    expect(body.personalizations[0].to).toEqual([{ email: "x@y.z" }, { email: "p@q.r" }]);
    expect(body.from.email).toBe("from@site.test");
    expect(body.reply_to.email).toBe("visitor@site.test");
    expect(body.subject).toBe("件名");
  });

  it("throws on a non-OK response", async () => {
    const http: Http = async () => ({ ok: false, status: 401, text: async () => "bad key" });
    await expect(
      new SendgridMailer("K", "f@x.y", http).send({ to: ["a@b.c"], subject: "s", text: "t" }),
    ).rejects.toThrow(/SendGrid error: 401/);
  });
});

describe("makeMailer", () => {
  const keys = ["SENDGRID_API_KEY", "MAIL_FROM"];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("falls back to the mock when unconfigured", () => {
    delete process.env.SENDGRID_API_KEY;
    delete process.env.MAIL_FROM;
    expect(makeMailer(process.env).name).toBe("mock");
  });

  it("uses SendGrid when configured", () => {
    process.env.SENDGRID_API_KEY = "k";
    process.env.MAIL_FROM = "f@x.y";
    expect(makeMailer(process.env).name).toBe("sendgrid");
  });
});
