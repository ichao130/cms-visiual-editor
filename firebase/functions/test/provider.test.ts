import { afterEach, describe, expect, it } from "vitest";
import { MockProvider, makeProvider } from "../src/ai/provider.js";

describe("MockProvider", () => {
  const provider = new MockProvider();

  it("themeify returns attributed HTML with validation issues", async () => {
    const out = (await provider.run({
      op: "themeify",
      args: { html: "<section><h2>見出し</h2><p>本文</p></section>" },
    })) as { html: string; issues: unknown[] };
    expect(out.html).toContain("data-section");
    expect(out.html).toContain("data-field");
    expect(Array.isArray(out.issues)).toBe(true);
  });

  it("draft returns a paragraph of text", async () => {
    const out = (await provider.run({ op: "draft", args: { prompt: "珈琲店" } })) as {
      text: string;
    };
    expect(out.text).toContain("<p>");
    expect(out.text).toContain("珈琲店");
  });

  it("rewrite applies the instruction", async () => {
    const out = (await provider.run({
      op: "rewrite",
      args: { text: "<p>一文目です。二文目です。</p>", instruction: "短く" },
    })) as { text: string };
    expect(out.text).toContain("一文目です");
    expect(out.text).not.toContain("二文目です");
  });

  it("seo returns a title and a description", async () => {
    const out = (await provider.run({
      op: "seo",
      args: { title: "記事", body: "<p>説明のための本文です。</p>" },
    })) as { title: string; description: string };
    expect(out.title).toBe("記事");
    expect(out.description).toContain("説明のための本文です");
  });

  it("coerces missing args to empty strings instead of throwing", async () => {
    const out = (await provider.run({ op: "seo", args: {} })) as {
      title: string;
      description: string;
    };
    expect(out).toEqual({ title: "", description: "" });
  });

  it("throws on an unknown op", async () => {
    await expect(
      provider.run({ op: "nope" as "draft", args: {} }),
    ).rejects.toThrow(/unknown op/);
  });
});

describe("makeProvider", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it("uses the offline mock when no API key is configured", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(makeProvider().name).toBe("mock");
  });

  it("uses Claude when an API key is configured", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(makeProvider().name).toBe("claude");
  });
});
