import { describe, expect, it } from "vitest";
import { synthesizeFseCss } from "../src/index.js";

/**
 * A block/FSE theme keeps its look in theme.json presets; WordPress turns those
 * into `--wp--preset--*` variables and `.has-*` utility classes at runtime. The
 * saved block markup references them, so the importer must synthesize that layer
 * or the theme renders unstyled. synthesizeFseCss produces a *practical* version.
 */
describe("synthesizeFseCss", () => {
  it("emits preset variables and matching utility classes for colours", () => {
    const { css } = synthesizeFseCss(
      JSON.stringify({ settings: { color: { palette: [{ slug: "primary", color: "#0a0" }] } } }),
    );
    expect(css).toContain("--wp--preset--color--primary:#0a0");
    expect(css).toContain(".has-primary-color{color:var(--wp--preset--color--primary)");
    expect(css).toContain(".has-primary-background-color{background-color:var(--wp--preset--color--primary)");
  });

  it("emits font-size and spacing presets", () => {
    const { css } = synthesizeFseCss(
      JSON.stringify({
        settings: {
          typography: { fontSizes: [{ slug: "large", size: "2rem" }] },
          spacing: { spacingSizes: [{ slug: "50", size: "1.5rem" }] },
        },
      }),
    );
    expect(css).toContain("--wp--preset--font-size--large:2rem");
    expect(css).toContain(".has-large-font-size{font-size:var(--wp--preset--font-size--large)");
    expect(css).toContain("--wp--preset--spacing--50:1.5rem");
  });

  it("includes the block layout stylesheet when presets exist", () => {
    const { css } = synthesizeFseCss(
      JSON.stringify({ settings: { color: { palette: [{ slug: "a", color: "#111" }] } } }),
    );
    expect(css).toContain(".wp-block-columns{display:flex");
    expect(css).toContain(".wp-block-column{flex:");
  });

  it("resolves theme.json var:preset refs into real var() calls", () => {
    const { css } = synthesizeFseCss(
      JSON.stringify({
        settings: { color: { palette: [{ slug: "primary", color: "#0a0" }] } },
        styles: { color: { background: "var:preset|color|primary" } },
      }),
    );
    expect(css).toContain("body{background-color:var(--wp--preset--color--primary)}");
  });

  it("uses the upper bound of a fluid font size", () => {
    const { css } = synthesizeFseCss(
      JSON.stringify({
        settings: { typography: { fontSizes: [{ slug: "xl", size: { min: "1rem", max: "3rem" } }] } },
      }),
    );
    expect(css).toContain("--wp--preset--font-size--xl:3rem");
  });

  it("returns nothing for an empty or malformed theme.json and never throws", () => {
    expect(synthesizeFseCss(undefined).css).toBe("");
    expect(synthesizeFseCss("{}").css).toBe("");
    expect(synthesizeFseCss("not json").css).toBe("");
    expect(() => synthesizeFseCss('{"settings":{"color":{"palette":"oops"}}}')).not.toThrow();
  });

  it("sanitizes a hostile preset value so it can't break out of the declaration", () => {
    const { css } = synthesizeFseCss(
      JSON.stringify({ settings: { color: { palette: [{ slug: "x", color: "red;}</style><script>" }] } } }),
    );
    expect(css).not.toContain("<script>");
    expect(css).not.toContain("</style>");
  });
});
