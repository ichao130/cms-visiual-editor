import { describe, expect, it } from "vitest";
import {
  mergeThemeConfig,
  renderComposedPage,
  themeRootCss,
  themeStyleTag,
} from "../src/index.js";

const layout =
  '<html><head><title>T</title><link rel="stylesheet" href="/assets/style.css" /></head><body>' +
  '<main data-slot="content"></main></body></html>';

const sections = { hero: '<section><h1 data-field="heading">H</h1></section>' };

describe("themeRootCss / themeStyleTag", () => {
  it("maps colors/fonts/spacing to CSS custom properties", () => {
    const css = themeRootCss({
      colors: { primary: "#112233", accent: "#c98a3b" },
      fonts: { heading: "'Mincho', serif", body: "sans-serif" },
      spacing: { section: "5rem" },
    });
    expect(css).toBe(
      ":root{--primary:#112233;--accent:#c98a3b;--font-heading:'Mincho', serif;--font-body:sans-serif;--space-section:5rem}",
    );
  });

  it("emits nothing for an empty or absent config", () => {
    expect(themeStyleTag(undefined)).toBe("");
    expect(themeStyleTag({})).toBe("");
    expect(themeStyleTag({ colors: {} })).toBe("");
  });

  it("sanitizes values so they can't break out of the declaration", () => {
    const css = themeRootCss({
      colors: { primary: "red;}</style><script>alert(1)</script>" },
      fonts: { body: "a;{}<b>" },
    });
    // A value can't inject extra braces or a closing tag: exactly one :root{…}.
    expect((css.match(/\{/g) ?? []).length).toBe(1);
    expect((css.match(/\}/g) ?? []).length).toBe(1);
    expect(css).not.toContain("<");
    expect(css.endsWith("}")).toBe(true);
    // The full tag wrapper stays well-formed around a sanitized value.
    expect(themeStyleTag({ colors: { primary: "red;}<x>" } })).toBe(
      "<style data-pcms-theme>:root{--primary:redx}</style>",
    );
  });
});

describe("mergeThemeConfig", () => {
  it("overlays overrides on presets, keeping unset preset keys", () => {
    const merged = mergeThemeConfig(
      { colors: { primary: "#000", accent: "#111", bg: "#fff" }, fonts: { body: "serif" } },
      { colors: { primary: "#f00" } },
    );
    expect(merged.colors).toEqual({ primary: "#f00", accent: "#111", bg: "#fff" });
    expect(merged.fonts).toEqual({ body: "serif" });
  });

  it("returns the base when there is no override, and vice versa", () => {
    expect(mergeThemeConfig({ colors: { primary: "#000" } }, undefined).colors).toEqual({
      primary: "#000",
    });
    expect(mergeThemeConfig(undefined, { colors: { primary: "#f00" } }).colors).toEqual({
      primary: "#f00",
    });
    expect(mergeThemeConfig(undefined, undefined)).toEqual({});
  });
});

describe("theme tokens injected into the layout head", () => {
  const base = {
    site: { name: "店", baseUrl: "https://ex.test" },
    menus: {},
    collections: {},
  };

  it("appends the :root block to <head>, after the stylesheet link", () => {
    const html = renderComposedPage(
      [{ id: "h1", type: "hero", fields: { heading: "本文" } }],
      sections,
      { ...base, theme: { colors: { primary: "#abcdef" } } },
      { layout, sections },
    );
    expect(html).toContain("<style data-pcms-theme>:root{--primary:#abcdef}</style>");
    // the override comes after the theme's own stylesheet, so it wins
    const linkAt = html.indexOf("/assets/style.css");
    const varAt = html.indexOf("data-pcms-theme");
    expect(linkAt).toBeGreaterThan(-1);
    expect(varAt).toBeGreaterThan(linkAt);
    // and it's inside <head>
    expect(varAt).toBeLessThan(html.indexOf("</head>"));
  });

  it("injects no style tag when the theme has no tokens", () => {
    const html = renderComposedPage(
      [{ id: "h1", type: "hero", fields: { heading: "本文" } }],
      sections,
      { ...base, theme: {} },
      { layout, sections },
    );
    expect(html).not.toContain("data-pcms-theme");
  });
});
