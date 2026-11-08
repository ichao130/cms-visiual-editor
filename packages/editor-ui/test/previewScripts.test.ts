import { describe, expect, it } from "vitest";
import { resolveThemeScripts } from "../src/preview/render.js";

/**
 * The live preview resolves the theme's <script> tags IN PLACE so dependencies
 * load in document order (jQuery before the plugins that need it). External
 * scripts are kept, local ones inlined from the theme's text assets, and inline
 * code blocks dropped as untrusted. This replaced a sorted-concat approach that
 * broke every jQuery theme and, under the app CSP, never ran at all.
 */
describe("resolveThemeScripts", () => {
  const texts = {
    "assets/cmn.js": "window.__cmn = 1;",
    "assets/slick.min.js": "window.__slick = 1;",
  };

  it("keeps external scripts, inlines local ones, drops inline code — in order", () => {
    const html = [
      `<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>`,
      `<script src="/assets/cmn.js"></script>`,
      `<script>window.__inline = 1;</script>`,
      `<script src="assets/slick.min.js?v=2" defer></script>`,
    ].join("\n");
    const { html: out, referenced } = resolveThemeScripts(html, texts);

    // External kept verbatim.
    expect(out).toContain('src="https://code.jquery.com/jquery-3.7.1.min.js"');
    // Local inlined (no more src=, body present).
    expect(out).toContain("window.__cmn = 1;");
    expect(out).toContain("window.__slick = 1;");
    expect(out).not.toContain('src="/assets/cmn.js"');
    expect(out).not.toContain("assets/slick.min.js");
    // Inline untrusted code dropped.
    expect(out).not.toContain("window.__inline");
    // Order preserved: jQuery CDN before cmn before slick.
    expect(out.indexOf("jquery-3.7.1")).toBeLessThan(out.indexOf("window.__cmn"));
    expect(out.indexOf("window.__cmn")).toBeLessThan(out.indexOf("window.__slick"));
    // Referenced basenames reported for de-duping auto-linked extras.
    expect(referenced.has("cmn.js")).toBe(true);
    expect(referenced.has("slick.min.js")).toBe(true);
  });

  it("drops a local script with no matching asset text", () => {
    const { html: out } = resolveThemeScripts(`<script src="/assets/missing.js"></script>`, texts);
    expect(out).not.toContain("missing.js");
    expect(out.trim()).toBe("");
  });

  it("leaves data: and protocol-relative scripts as external", () => {
    const html = `<script src="//cdn.example.com/x.js"></script><script src="data:text/javascript,1"></script>`;
    const { html: out } = resolveThemeScripts(html, texts);
    expect(out).toContain("//cdn.example.com/x.js");
    expect(out).toContain("data:text/javascript,1");
  });
});
