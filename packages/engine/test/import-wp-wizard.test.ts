import { describe, expect, it } from "vitest";
import { importWpTheme, type WpImportFile } from "../src/index.js";

/**
 * The import wizard data (WpImportResult.wizard): the operator confirms the
 * import's shape before it becomes a theme — which template is the top page, which
 * 固定ページ to create, and what the theme fills dynamically (so they know the
 * hero/logo/news will be empty until filled in).
 */

describe("importWpTheme — wizard: top-page candidates", () => {
  it("offers front-page and index, defaulting to front-page", () => {
    const files: WpImportFile[] = [
      { path: "style.css", text: "/*\nTheme Name: T\n*/" },
      { path: "header.php", text: `<header>H</header>` },
      { path: "footer.php", text: `<footer>F</footer>` },
      { path: "front-page.php", text: `<?php get_header(); ?><main><h1>Top</h1></main><?php get_footer(); ?>` },
      { path: "index.php", text: `<?php get_header(); ?><main><h2>Blog</h2></main><?php get_footer(); ?>` },
    ];
    const { wizard } = importWpTheme(files);
    expect(wizard.home.chosen).toBe("front-page");
    expect(wizard.home.candidates.map((c) => c.stem)).toEqual(["front-page", "index"]);
    // Each candidate carries a composed, editable template the UI can swap in.
    const top = wizard.home.candidates.find((c) => c.stem === "front-page");
    expect(top?.html).toContain("Top");
  });

  it("falls back to index when there is no front-page/home", () => {
    const files: WpImportFile[] = [
      { path: "style.css", text: "/*\nTheme Name: T\n*/" },
      { path: "index.php", text: `<?php get_header(); ?><main><h2>Blog</h2></main><?php get_footer(); ?>` },
      { path: "header.php", text: `<header>H</header>` },
      { path: "footer.php", text: `<footer>F</footer>` },
    ];
    const { wizard } = importWpTheme(files);
    expect(wizard.home.chosen).toBe("index");
  });
});

describe("importWpTheme — wizard: pages and unresolved content", () => {
  it("lists the importable 固定ページ with their titles", () => {
    const files: WpImportFile[] = [
      { path: "style.css", text: "/*\nTheme Name: T\n*/" },
      { path: "index.php", text: `<?php get_header(); ?><main></main><?php get_footer(); ?>` },
      { path: "header.php", text: `<header>H</header>` },
      { path: "footer.php", text: `<footer>F</footer>` },
      {
        path: "page-service.php",
        text: `<?php /* Template Name: サービス */ get_header(); ?><h1>Service</h1><?php get_footer(); ?>`,
      },
    ];
    const { wizard } = importWpTheme(files);
    expect(wizard.pages).toEqual([{ id: "service", template: "page-service", title: "サービス" }]);
  });

  it("flags Customizer theme-mods, a custom logo and post loops as unresolved", () => {
    const files: WpImportFile[] = [
      { path: "style.css", text: "/*\nTheme Name: T\n*/" },
      { path: "header.php", text: `<header><?php acme_logo(); ?></header>` },
      { path: "footer.php", text: `<footer>F</footer>` },
      {
        path: "front-page.php",
        text:
          `<?php get_header(); ?>` +
          `<h1><?php echo get_theme_mod('hero_title'); ?></h1>` +
          `<?php if (have_posts()) : while (have_posts()) : the_post(); endwhile; endif; ?>` +
          `<?php get_footer(); ?>`,
      },
    ];
    const { wizard } = importWpTheme(files);
    const joined = wizard.unresolved.join("｜");
    expect(joined).toContain("カスタマイザー");
    expect(joined).toContain("ロゴ");
    expect(joined).toContain("記事");
  });

  it("does not flag unresolved content for a static theme", () => {
    const files: WpImportFile[] = [
      { path: "theme.json", text: JSON.stringify({ title: "Blocky" }) },
      { path: "templates/index.html", text: `<!-- wp:heading --><h2>Hi</h2><!-- /wp:heading -->` },
      { path: "parts/header.html", text: `<!-- wp:site-title /-->` },
      { path: "parts/footer.html", text: `<!-- wp:paragraph --><p>F</p><!-- /wp:paragraph -->` },
    ];
    const { wizard } = importWpTheme(files);
    expect(wizard.unresolved).toEqual([]);
  });
});
