import { describe, expect, it } from "vitest";
import { importWpTheme, type WpImportFile } from "../src/index.js";

/**
 * Custom page templates are the third pillar of a buildable site (home + posts +
 * 固定ページ). A classic theme ships one PHP file per designed page — `page-<slug>.php`
 * or a file with a `Template Name:` header — and the importer must surface each as
 * its own template PLUS a preset page entry, or the Service/About/Project pages
 * collapse into the generic `page` template and lose their layout. Shapes below
 * are reproduced from the branberyheag theme.
 */

function parsePreset(preset?: string): {
  pages: Record<string, { template: string; title?: string }>;
  regions: unknown;
} {
  expect(preset).toBeTypeOf("string");
  return JSON.parse(preset!) as never;
}

const header = { path: "header.php", text: `<header class="site">H</header>` };
const footer = { path: "footer.php", text: `<footer class="site">F</footer>` };
const style = { path: "style.css", text: `/*\nTheme Name: Demo\n*/` };
const index = {
  path: "index.php",
  text: `<?php get_header(); ?><main><h1>Home</h1></main><?php get_footer(); ?>`,
};

describe("importWpTheme — custom 固定ページ templates", () => {
  it("imports a page-<slug>.php as its own template and preset page", () => {
    const files: WpImportFile[] = [
      header,
      footer,
      style,
      index,
      {
        path: "page-service.php",
        text: `<?php get_header(); ?>\n<section class="svc"><h1 class="hdl">Service</h1><p>提供内容</p></section>\n<?php get_footer(); ?>`,
      },
    ];
    const r = importWpTheme(files);
    expect(r.files.templates["page-service"]).toBeDefined();
    expect(r.files.templates["page-service"]).toContain('data-field="sec-1.f1"'); // editable
    const { pages } = parsePreset(r.files.preset);
    expect(pages.service).toEqual({ template: "page-service", title: "Service" });
    expect(pages.index).toEqual({ template: "index" });
  });

  it("uses the Template Name header as the page title", () => {
    const files: WpImportFile[] = [
      header,
      footer,
      style,
      index,
      {
        path: "page-about.php",
        text: `<?php\n/**\n * Template Name: アバウト\n */\nget_header(); ?>\n<section><h1>About</h1></section>\n<?php get_footer(); ?>`,
      },
    ];
    const { pages } = parsePreset(importWpTheme(files).files.preset);
    expect(pages.about).toEqual({ template: "page-about", title: "アバウト" });
  });

  it("treats a Template Name file with no page- prefix as a page", () => {
    const files: WpImportFile[] = [
      header,
      footer,
      style,
      index,
      {
        path: "landing.php",
        text: `<?php\n/* Template Name: ランディング */\nget_header(); ?>\n<section><h1>LP</h1></section>\n<?php get_footer(); ?>`,
      },
    ];
    const r = importWpTheme(files);
    expect(r.files.templates["landing"]).toBeDefined();
    expect(parsePreset(r.files.preset).pages.landing).toEqual({
      template: "landing",
      title: "ランディング",
    });
  });

  it("excludes hierarchy/plumbing stems, even with a Template Name (home = blog index)", () => {
    const files: WpImportFile[] = [
      header,
      footer,
      style,
      index,
      { path: "single.php", text: `<?php get_header(); ?><article><h1>Post</h1></article><?php get_footer(); ?>` },
      { path: "page.php", text: `<?php get_header(); ?><article><?php the_content(); ?></article><?php get_footer(); ?>` },
      { path: "404.php", text: `<?php get_header(); ?><h1>Not found</h1><?php get_footer(); ?>` },
      { path: "home.php", text: `<?php\n/* Template Name: ホーム */\nget_header(); ?><main>blog</main><?php get_footer(); ?>` },
    ];
    const { pages } = parsePreset(importWpTheme(files).files.preset);
    expect(Object.keys(pages).sort()).toEqual(["index"]); // no home/single/page/404 page
  });

  it("ignores a plain .php with neither page- prefix nor Template Name", () => {
    const files: WpImportFile[] = [
      header,
      footer,
      style,
      index,
      { path: "contact.php", text: `<?php get_header(); ?><div>form include</div><?php get_footer(); ?>` },
    ];
    const r = importWpTheme(files);
    expect(r.files.templates["contact"]).toBeUndefined();
    expect(Object.keys(parsePreset(r.files.preset).pages)).toEqual(["index"]);
  });

  it("always emits a preset with at least the home page", () => {
    const { pages } = parsePreset(importWpTheme([header, footer, style, index]).files.preset);
    expect(pages.index).toEqual({ template: "index" });
  });
});
