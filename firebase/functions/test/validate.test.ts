import { describe, expect, it } from "vitest";
import { validateSubmission, type FormConfig } from "../src/validate.js";
import { checkQuota, usagePeriod } from "../src/quota.js";

const config: FormConfig = {
  fields: [
    { name: "name", required: true, maxLength: 100 },
    { name: "email", required: true },
    { name: "message", maxLength: 2000 },
  ],
  honeypotField: "_gotcha",
  requireToken: true,
};

describe("validateSubmission", () => {
  it("accepts a valid submission and trims values", () => {
    const r = validateSubmission(
      { name: " 田中 ", email: "a@b.jp", message: "こんにちは", token: "t" },
      config,
    );
    expect(r).toEqual({ ok: true, fields: { name: "田中", email: "a@b.jp", message: "こんにちは" } });
  });

  it("treats a filled honeypot as spam", () => {
    const r = validateSubmission({ name: "x", email: "a@b.jp", token: "t", _gotcha: "bot" }, config);
    expect(r).toEqual({ spam: true });
  });

  it("rejects a missing captcha token", () => {
    const r = validateSubmission({ name: "x", email: "a@b.jp" }, config);
    expect(r).toEqual({ ok: false, errors: ["確認トークンがありません。"] });
  });

  it("reports missing required fields", () => {
    const r = validateSubmission({ email: "", token: "t" }, config);
    expect(r.ok).toBe(false);
    if (!("ok" in r) || r.ok) throw new Error("expected errors");
    expect(r.errors.length).toBe(2); // name + email
  });

  it("rejects over-length values", () => {
    const r = validateSubmission({ name: "a".repeat(101), email: "a@b.jp", token: "t" }, config);
    expect(r).toMatchObject({ ok: false });
  });
});

describe("checkQuota", () => {
  it("allows under the limit and reports remaining", () => {
    expect(checkQuota({ count: 3, limit: 10 })).toEqual({ allowed: true, remaining: 7 });
  });
  it("blocks at the limit", () => {
    expect(checkQuota({ count: 10, limit: 10 })).toEqual({ allowed: false, remaining: 0 });
  });
  it("falls back to the default limit when none is set", () => {
    expect(checkQuota({ count: 0, limit: 0 }).allowed).toBe(true);
  });
  it("buckets usage per month", () => {
    expect(usagePeriod(new Date(Date.UTC(2026, 1, 15)))).toBe("2026-02");
  });
});
