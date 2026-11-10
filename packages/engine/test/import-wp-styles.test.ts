import { describe, expect, it } from "vitest";
import { collectEnqueuedStyles, importWpTheme, type WpImportFile } from "../src/index.js";

/**
 * Stylesheet selection is the single biggest WordPress-import fidelity lever. A
 * theme archive ships far more CSS than it loads — vendor libraries it never
 * enqueues (bootstrap, slick, rellax), a JS library's own documentation-site CSS,
 * and the RTL mirror (style-rtl.css) — and folding ALL of it into one stylesheet
 * lets that dead CSS override the real design (the branberyheag import regression).
 * collectEnqueuedStyles takes ONLY the CSS the theme references, as the live site
 * would load it. Shapes below are reproduced from the branberyheag theme.
 */

describe("collectEnqueuedStyles", () => {
  it("captures a <link> whose href wraps a PHP asset-path helper", () => {
    // The `?>` inside the href used to truncate the tag at its `>`, losing the URL.
    const files: WpImportFile[] = [
      {
        path: "header.php",
        text: `<head>\n<link rel="stylesheet" type="text/css" href="<?php echo get_template_directory_uri() ?>/common/css/styles.css">\n<?php wp_head(); ?>\n</head>`,
      },
    ];
    const got = collectEnqueuedStyles(files);
    expect(got).toEqual([{ external: false, base: "styles.css", url: "styles.css" }]);
  });

  it("resolves get_stylesheet_uri() to the theme's style.css", () => {
    const files: WpImportFile[] = [
      {
        path: "functions.php",
        text: `wp_enqueue_style( 'theme-style', get_stylesheet_uri(), array(), _S_VERSION );`,
      },
    ];
    expect(collectEnqueuedStyles(files)).toEqual([
      { external: false, base: "style.css", url: "style.css" },
    ]);
  });

  it("reads a local .css literal from wp_enqueue_style's src", () => {
    const files: WpImportFile[] = [
      {
        path: "functions.php",
        text: `wp_enqueue_style( 'slick', get_template_directory_uri() . '/common/vendors/slick/slick.css', array(), '1.0' );`,
      },
    ];
    expect(collectEnqueuedStyles(files).map((s) => s.base)).toEqual(["slick.css"]);
  });

  it("ignores stylesheets referenced only by bundled vendor demo HTML", () => {
    // anime.js / rellax ship documentation pages that <link> their own CSS; those
    // are not the theme's templates and must not be pulled in.
    const files: WpImportFile[] = [
      {
        path: "header.php",
        text: `<link rel="stylesheet" href="<?php echo get_template_directory_uri() ?>/common/css/styles.css">`,
      },
      {
        path: "common/vendors/anime/documentation/index.html",
        text: `<link rel="stylesheet" href="assets/css/documentation.css"><link rel="stylesheet" href="assets/css/website.css">`,
      },
      {
        path: "common/vendors/rellax/index.html",
        text: `<link rel="stylesheet" href="css/bootstrap.min.css">`,
      },
    ];
    expect(collectEnqueuedStyles(files).map((s) => s.base)).toEqual(["styles.css"]);
  });

  it("excludes the RTL mirror (loaded only for RTL locales)", () => {
    const files: WpImportFile[] = [
      { path: "header.php", text: `<link rel="stylesheet" href="/css/main.css"><link rel="stylesheet" href="/css/main-rtl.css">` },
    ];
    expect(collectEnqueuedStyles(files).map((s) => s.base)).toEqual(["main.css"]);
  });

  it("keeps an external (CDN) stylesheet verbatim as external", () => {
    const files: WpImportFile[] = [
      {
        path: "header.php",
        text: `<link rel="stylesheet" href="https://cdn.example.com/x/reset.css"><link rel="stylesheet" href="/css/theme.css">`,
      },
    ];
    expect(collectEnqueuedStyles(files)).toEqual([
      { external: true, base: "reset.css", url: "https://cdn.example.com/x/reset.css" },
      { external: false, base: "theme.css", url: "theme.css" },
    ]);
  });

  it("de-duplicates by basename, first occurrence wins", () => {
    const files: WpImportFile[] = [
      { path: "header.php", text: `<link rel="stylesheet" href="/a/main.css">` },
      { path: "footer.php", text: `<link rel="stylesheet" href="/b/main.css">` },
    ];
    expect(collectEnqueuedStyles(files).map((s) => s.base)).toEqual(["main.css"]);
  });
});

describe("importWpTheme — only referenced CSS is surfaced", () => {
  const files: WpImportFile[] = [
    {
      path: "style.css",
      text: `/*\nTheme Name: Demo\n*/`,
    },
    {
      path: "header.php",
      text: `<!doctype html><html><head>\n<link rel="stylesheet" href="https://fonts.example.com/f.css">\n<link rel="stylesheet" href="<?php echo get_template_directory_uri() ?>/common/css/styles.css">\n<?php wp_head(); ?>\n</head><body><header class="site">Header</header>`,
    },
    { path: "footer.php", text: `<footer class="site">Footer</footer><?php wp_footer(); ?></body></html>` },
    { path: "functions.php", text: `wp_enqueue_style('demo', get_stylesheet_uri());` },
    { path: "index.php", text: `<?php get_header(); ?><main><h1>Hi</h1></main><?php get_footer(); ?>` },
    // Dead vendor CSS + a vendor demo page that links it — must be excluded.
    { path: "common/vendors/bootstrap/bootstrap.min.css", text: `body{all:unset}` },
    { path: "common/vendors/bootstrap/demo.html", text: `<link rel="stylesheet" href="bootstrap.min.css">` },
  ];

  it("lists the theme's own stylesheets in load order, not the vendor CSS", () => {
    const r = importWpTheme(files);
    expect(r.files.styles).toEqual(["styles.css", "style.css"]);
    expect(r.files.styles).not.toContain("bootstrap.min.css");
  });

  it("links an external stylesheet from the layout head", () => {
    const r = importWpTheme(files);
    expect(r.files["layout.html"]).toContain(
      '<link rel="stylesheet" href="https://fonts.example.com/f.css" />',
    );
  });
});
