import { describe, expect, it } from "vitest";
import {
  themeifyHtml,
  validateThemeHtml,
  draftText,
  rewriteText,
  seoSuggest,
  diagnoseThemeHtml,
  parseTemplate,
} from "../src/index.js";

describe("themeifyHtml", () => {
  const raw = `
    <section>
      <h1>ようこそ</h1>
      <p>本文です。</p>
      <img src="a.jpg" alt="">
      <a href="/next">次へ</a>
    </section>
    <section>
      <h2>二つ目</h2>
      <p>段落</p>
    </section>`;
  const out = themeifyHtml(raw);

  it("adds data-section to each section with a label", () => {
    expect(out).toContain('data-section="sec-1"');
    expect(out).toContain('data-section="sec-2"');
    expect(out).toContain('data-label="セクション1"');
  });

  it("annotates fields with inferred types", () => {
    expect(out).toContain('data-field="sec-1.f1"'); // h1
    expect(out).toMatch(/data-field="sec-1\.f3"[^>]*data-type="image"|data-type="image"[^>]*data-field="sec-1\.f3"/);
    expect(out).toContain('data-type="link"'); // the anchor
  });

  it("produces a template the parser can read back", () => {
    const schema = parseTemplate("themed", out);
    expect(schema.sections.map((s) => s.id)).toEqual(["sec-1", "sec-2"]);
    expect(schema.sections[0]!.fields.length).toBeGreaterThanOrEqual(4);
  });
});

describe("validateThemeHtml", () => {
  it("passes well-formed theme HTML", () => {
    const issues = validateThemeHtml('<section data-section="a"><h1 data-field="a.t" data-type="text">x</h1></section>');
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("flags an unknown data-type", () => {
    const issues = validateThemeHtml('<p data-field="x" data-type="bogus">x</p>');
    expect(issues.some((i) => i.level === "error" && i.message.includes("bogus"))).toBe(true);
  });

  it("warns when nothing is editable", () => {
    const issues = validateThemeHtml("<div><p>plain</p></div>");
    expect(issues.some((i) => i.level === "warning")).toBe(true);
  });
});

describe("offline AI heuristics", () => {
  it("drafts a paragraph mentioning the prompt", () => {
    expect(draftText("自家焙煎コーヒー")).toContain("自家焙煎コーヒー");
  });

  it("shortens text on request", () => {
    const out = rewriteText("<p>一文目です。二文目です。三文目です。</p>", "短くして");
    expect(out).toContain("一文目です");
    expect(out).not.toContain("三文目");
  });

  it("builds an SEO description from the body", () => {
    const { title, description } = seoSuggest("お店について", "<p>" + "あ".repeat(200) + "</p>");
    expect(title).toBe("お店について");
    expect(description.length).toBeLessThanOrEqual(120);
    expect(description.endsWith("…")).toBe(true);
  });
});

describe("diagnoseThemeHtml", () => {
  it("flags an unknown data-type with the valid types as the fix", () => {
    const d = diagnoseThemeHtml('<p data-field="x" data-type="wysiwyg" data-label="本文">x</p>');
    const hit = d.find((i) => i.message.includes("data-type"));
    expect(hit?.level).toBe("error");
    expect(hit?.fix).toContain("richtext");
  });

  it("warns when an image type is on a non-img element", () => {
    const d = diagnoseThemeHtml('<p data-field="hero.img" data-type="image">x</p>');
    const hit = d.find((i) => i.message.includes("image"));
    expect(hit?.level).toBe("warning");
    expect(hit?.fix).toContain("<img>");
  });

  it("warns on a duplicate field path within a section", () => {
    const d = diagnoseThemeHtml(
      '<section data-section="s1"><h2 data-field="s1.t">A</h2><p data-field="s1.t">B</p></section>',
    );
    expect(d.some((i) => i.message.includes("重複"))).toBe(true);
  });

  it("warns on a data-repeat with no editable field inside", () => {
    const d = diagnoseThemeHtml('<div data-repeat="items"><span>static</span></div>');
    expect(d.some((i) => i.message.includes("data-repeat"))).toBe(true);
  });

  it("warns when nothing is editable", () => {
    const d = diagnoseThemeHtml("<section><p>ただのHTML</p></section>");
    expect(d.some((i) => i.message.includes("編集できる箇所"))).toBe(true);
  });

  it("returns nothing for a clean fragment", () => {
    const d = diagnoseThemeHtml(
      '<section data-section="s1"><h2 data-field="s1.title" data-type="text">見出し</h2></section>',
    );
    expect(d).toEqual([]);
  });
});
