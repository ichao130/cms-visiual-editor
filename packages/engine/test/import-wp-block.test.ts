import { describe, expect, it } from "vitest";
import {
  detectWpThemeKind,
  gutenbergToHtml,
  parseGutenberg,
  importWpTheme,
  type WpImportFile,
} from "../src/index.js";

/**
 * Block/FSE theme import. A block theme ships `theme.json` + `templates/*.html`
 * made of Gutenberg markup (`<!-- wp:… -->`), its chrome in `parts/*.html`, and
 * registers patterns as PHP under `patterns/`. The importer must:
 *   A. classify it as `block` even though `patterns/footer.php` *looks* classic;
 *   B. turn navigation/site-logo/site-title/template-part/query blocks into the
 *      same editable markup their classic equivalents produce (not drop them);
 *   C. import `templates/page-<slug>.html` as its own 固定ページ + preset entry;
 *   D. never leak `<?php` or `<!-- wp:` into the output.
 */

describe("detectWpThemeKind — pattern PHP never looks classic", () => {
  it("classifies a block theme with patterns/footer.php as block (not mixed)", () => {
    const files: WpImportFile[] = [
      { path: "theme.json", text: JSON.stringify({ title: "Blocky" }) },
      { path: "templates/index.html", text: `<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->` },
      { path: "parts/footer.php", text: `<?php /* a registered pattern */ ?>` },
      { path: "patterns/page-home.php", text: `<!-- wp:heading --><h2>Home</h2><!-- /wp:heading -->` },
    ];
    expect(detectWpThemeKind(files)).toBe("block");
  });

  it("still reports mixed when a real root-level PHP hierarchy sits beside block templates", () => {
    const files: WpImportFile[] = [
      { path: "theme.json", text: "{}" },
      { path: "templates/index.html", text: `<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->` },
      { path: "index.php", text: `<?php get_header(); ?>` },
      { path: "single.php", text: `<?php the_content(); ?>` },
    ];
    expect(detectWpThemeKind(files)).toBe("mixed");
  });
});

describe("gutenbergToHtml — chrome blocks become editable markup", () => {
  it("navigation → a data-loop menu list", () => {
    const html = gutenbergToHtml(parseGutenberg(`<!-- wp:navigation /-->`));
    expect(html).toContain('data-loop="menu"');
    expect(html).toContain('data-field="item.url"');
  });

  it("site-logo and site-title → editable site fields", () => {
    const html = gutenbergToHtml(parseGutenberg(`<!-- wp:site-logo /--><!-- wp:site-title /-->`));
    expect(html).toContain('data-field="site.logo"');
    expect(html).toContain('data-field="site.name"');
  });

  it("template-part is inlined from the parts map", () => {
    const parts = new Map([["banner", `<!-- wp:heading --><h2>Promo</h2><!-- /wp:heading -->`]]);
    const html = gutenbergToHtml(parseGutenberg(`<!-- wp:template-part {"slug":"banner"} /-->`), {
      parts,
      skipChromeParts: false,
      seen: new Set(),
    });
    expect(html).toContain("Promo");
    expect(html).toContain("data-field"); // the heading became editable
  });

  it("drops header/footer template-parts in a body when the layout owns the chrome", () => {
    const parts = new Map([["header", `<!-- wp:site-title /-->`]]);
    const body =
      `<!-- wp:template-part {"slug":"header"} /-->` +
      `<!-- wp:paragraph --><p>BODY</p><!-- /wp:paragraph -->`;
    const html = gutenbergToHtml(parseGutenberg(body), { parts, skipChromeParts: true, seen: new Set() });
    expect(html).toContain("BODY");
    expect(html).not.toContain('data-field="site.name"'); // header skipped
  });

  it("query/post-template → a data-loop=posts list with post fields", () => {
    const markup =
      `<!-- wp:query --><!-- wp:post-template -->` +
      `<!-- wp:post-title /--><!-- wp:post-excerpt /-->` +
      `<!-- /wp:post-template --><!-- /wp:query -->`;
    const html = gutenbergToHtml(parseGutenberg(markup));
    expect(html).toContain('data-loop="posts"');
    expect(html).toContain('data-field="post.title"');
    expect(html).toContain('data-field="post.excerpt"');
  });

  it("a self-referential template-part does not recurse forever", () => {
    const parts = new Map([
      ["loop", `<!-- wp:template-part {"slug":"loop"} /--><!-- wp:heading --><h2>X</h2><!-- /wp:heading -->`],
    ]);
    const html = gutenbergToHtml(parseGutenberg(`<!-- wp:template-part {"slug":"loop"} /-->`), {
      parts,
      skipChromeParts: false,
      seen: new Set(),
    });
    expect(html).toContain("X"); // inlined once, then the guard stops it
  });
});

describe("importWpTheme — block end to end", () => {
  const files: WpImportFile[] = [
    { path: "style.css", text: "/*\nTheme Name: FSE Cafe\n*/" },
    {
      path: "theme.json",
      text: JSON.stringify({
        title: "FSE Cafe",
        settings: { color: { palette: [{ slug: "primary", color: "#0a0" }] } },
        customTemplates: [{ name: "page-about", title: "会社概要", postTypes: ["page"] }],
      }),
    },
    { path: "parts/header.html", text: `<!-- wp:site-logo /--><!-- wp:navigation /-->` },
    { path: "parts/footer.html", text: `<!-- wp:paragraph --><p>© Cafe</p><!-- /wp:paragraph -->` },
    {
      path: "templates/index.html",
      text:
        `<!-- wp:template-part {"slug":"header"} /-->` +
        `<!-- wp:heading --><h2>Welcome</h2><!-- /wp:heading -->` +
        `<!-- wp:template-part {"slug":"footer"} /-->`,
    },
    { path: "templates/single.html", text: `<!-- wp:post-title /--><!-- wp:post-content /-->` },
    {
      path: "templates/page-about.html",
      text: `<!-- wp:heading --><h1>About us</h1><!-- /wp:heading -->` +
        `<!-- wp:paragraph --><p>Our story</p><!-- /wp:paragraph -->`,
    },
    // A registered pattern as PHP — must not be imported as a page.
    { path: "patterns/cta.php", text: `<!-- wp:heading --><h2>CTA</h2><!-- /wp:heading -->` },
  ];

  const r = importWpTheme(files);

  it("is a block import with no php/wp-comment leaks", () => {
    expect(r.kind).toBe("block");
    const all = JSON.stringify(r.files);
    expect(all).not.toContain("<?php");
    expect(all).not.toContain("<!-- wp:");
  });

  it("the layout carries the logo, a working menu, and a content slot", () => {
    const layout = r.files["layout.html"] ?? "";
    expect(layout).toContain('data-field="site.logo"');
    expect(layout).toContain('data-loop="menu"');
    expect(layout).toContain('data-slot="content"');
  });

  it("the index body does not repeat the header/footer chrome", () => {
    // header/footer come from the layout; the body template-parts are skipped.
    const index = r.files.templates.index ?? "";
    expect(index).toContain("Welcome");
    expect(index).not.toContain('data-field="site.logo"');
  });

  it("imports templates/page-about.html as its own 固定ページ with the theme.json title", () => {
    expect(r.files.templates["page-about"]).toBeTruthy();
    const preset = JSON.parse(r.files.preset ?? "{}") as {
      pages: Record<string, { template: string; title?: string }>;
    };
    expect(preset.pages.about).toEqual({ template: "page-about", title: "会社概要" });
  });

  it("does not turn the patterns/*.php pattern into a page", () => {
    const preset = JSON.parse(r.files.preset ?? "{}") as { pages: Record<string, unknown> };
    expect(preset.pages.cta).toBeUndefined();
  });

  it("the post template exposes title and body as editable fields", () => {
    const post = r.files.templates.post ?? "";
    expect(post).toContain('data-field="post.title"');
    expect(post).toContain('data-field="post.body"');
  });

  it("every produced template passes theme validation with no errors", () => {
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
  });
});
