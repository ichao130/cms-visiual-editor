import { describe, expect, it } from "vitest";
import type { FormDef } from "@pcms/shared";
import { buildFormEmbed, HONEYPOT_FIELD } from "../src/index.js";

function form(): FormDef {
  return {
    id: "contact",
    name: "お問い合わせ",
    fields: [
      { name: "name", label: "お名前", type: "text", required: true },
      { name: "email", label: "メール", type: "email", required: true },
      { name: "tel", label: "電話", type: "tel" },
      { name: "body", label: "内容", type: "textarea", required: true },
      { name: "topic", label: "ご用件", type: "select", options: ["予約", "その他"] },
      { name: "agree", label: "同意する", type: "checkbox", required: true },
    ],
    notifyEmails: ["owner@example.test"],
    autoReply: false,
    completionMessage: "送信ありがとうございました。",
  };
}

const opts = { endpoint: "https://example.test/submitForm", siteId: "site-1" };

describe("buildFormEmbed", () => {
  const html = buildFormEmbed(form(), opts);

  it("renders each field with the right input type", () => {
    expect(html).toContain('<input type="text" name="name" required>');
    expect(html).toContain('<input type="email" name="email" required>');
    expect(html).toContain('<input type="tel" name="tel">');
    expect(html).toContain('<textarea name="body" required></textarea>');
    expect(html).toContain('<select name="topic">');
    expect(html).toContain('<option value="予約">予約</option>');
    expect(html).toContain('<input type="checkbox" name="agree" value="1" required>');
  });

  it("includes a honeypot field", () => {
    expect(html).toContain(`name="${HONEYPOT_FIELD}"`);
  });

  it("posts JSON with the site id, form id and completion message", () => {
    expect(html).toContain('fetch("https://example.test/submitForm"');
    expect(html).toContain('siteId:"site-1"');
    expect(html).toContain('formId:"contact"');
    expect(html).toContain("送信ありがとうございました。");
  });

  it("escapes field labels and names", () => {
    const evil = buildFormEmbed(
      {
        ...form(),
        fields: [{ name: "x", label: '<script>"&', type: "text" }],
      },
      opts,
    );
    expect(evil).toContain("&lt;script&gt;&quot;&amp;");
    expect(evil).not.toContain('<script>"&</');
  });

  it("matches the snapshot", () => {
    expect(html).toMatchSnapshot();
  });
});
