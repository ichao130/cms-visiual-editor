import { describe, expect, it } from "vitest";
import { importWpTheme, mapTemplateTags, type WpImportFile } from "../src/index.js";

/**
 * Fidelity regression for real-world classic WordPress themes (the `_s` /
 * underscores family), which broke the first implementation: PHP inside
 * attributes corrupted the parse so the whole <!doctype>/<head> leaked into a
 * layout slot; scripts were stripped; asset paths weren't normalized; templates
 * weren't split into editable parts. These assert the four requirements.
 */

const HEADER_PHP = `<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" type="text/css" href="/common/css/styles.css">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XX" height="0" width="0"></iframe></noscript>
<header id="Header" class="site-header">
<div class="logo"><a href="<?php echo home_url(); ?>" rel="home"><img src="/common/img/logo_black.png" alt="<?php bloginfo('name'); ?>"></a></div>
<nav class="main-nav"><?php wp_nav_menu(array('theme_location'=>'primary')); ?></nav>
</header>
<script src="/common/js/header.js"></script>`;

const FOOTER_PHP = `<footer id="Footer" class="site-footer">
<div class="logo"><img src="/common/img/logo_text.png" alt="Logo" width="220"></div>
<p class="copyright">(c) Example</p>
</footer>
<?php wp_footer(); ?>
<script src="/common/js/app.js"></script>
</body>
</html>`;

const INDEX_PHP = `<?php get_header(); ?>
<main id="primary" class="site-main">
<section class="intro">
<h1>ようこそ</h1>
<p>当店のサイトへようこそ。こだわりの一杯をどうぞ。</p>
<img src="/common/img/hero.jpg" alt="店内">
</section>
<section class="news">
<h2>お知らせ</h2>
<?php while (have_posts()) : the_post(); ?>
<article class="card"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></article>
<?php endwhile; ?>
</section>
</main>
<?php get_footer(); ?>`;

const SINGLE_PHP = `<?php get_header(); ?>
<main class="site-main">
<article class="post">
<h1 class="entry-title"><?php the_title(); ?></h1>
<div class="entry-content"><?php the_content(); ?></div>
</article>
</main>
<?php get_footer(); ?>`;

const FILES: WpImportFile[] = [
  { path: "style.css", text: "/*\nTheme Name: Real Cafe\n*/\nbody{color:#222}" },
  { path: "header.php", text: HEADER_PHP },
  { path: "footer.php", text: FOOTER_PHP },
  { path: "index.php", text: INDEX_PHP },
  { path: "single.php", text: SINGLE_PHP },
];

describe("mapTemplateTags — attribute safety", () => {
  it("never injects an element into an attribute value", () => {
    const { html } = mapTemplateTags(
      `<meta charset="<?php bloginfo('charset'); ?>"><img alt="<?php bloginfo('name'); ?>" src="/img/a.png">`,
    );
    expect(html).not.toContain('charset="<span');
    expect(html).not.toContain('alt="<span');
    expect(html).toContain('charset="utf-8"');
    // alt is left as a literal (emptied), not an element.
    expect(html).toMatch(/alt="\s*"/);
    expect(html).not.toContain("<?php");
  });
});

describe("importWpTheme — real classic theme fidelity", () => {
  const r = importWpTheme(FILES);
  const layout = r.files["layout.html"] ?? "";
  const index = r.files.templates.index ?? "";
  const post = r.files.templates.post ?? "";
  const all = JSON.stringify(r.files);

  it("detects classic and leaves no PHP", () => {
    expect(r.kind).toBe("classic");
    expect(all).not.toContain("<?php");
  });

  it("the layout is a single valid document (no nested doctype/head in a slot)", () => {
    // Exactly one doctype, and no <html>/<head> smuggled into a slot.
    expect((layout.match(/<!doctype/gi) ?? []).length).toBe(1);
    const header = /<div data-slot="header">([\s\S]*?)<\/div>\s*\n\s*<main/.exec(layout)?.[1] ?? layout;
    expect(header).not.toContain("<!doctype");
    expect(header).not.toMatch(/<head[\s>]/); // the <head> element, not <header>
    expect(header).not.toContain("<html");
    expect(layout).toContain('data-slot="content"');
    expect(layout).toContain('href="/assets/style.css"');
  });

  it("keeps the theme's JS (scripts are not stripped)", () => {
    expect(all).toContain("<script");
    // header/footer scripts localized into assets/
    expect(all).toContain("assets/header.js");
    expect(all).toContain("assets/app.js");
  });

  it("normalizes every local image path to assets/<file>", () => {
    expect(all).not.toContain("/common/img/");
    expect(all).toContain("assets/logo_black.png");
    expect(all).toContain("assets/hero.jpg");
  });

  it("splits the index template into editable sections and fields", () => {
    expect((index.match(/data-section=/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // heading / paragraph / image each become a field
    expect(index).toContain('data-type="text"'); // heading
    expect(index).toContain('data-type="image"'); // image
    expect(index).toMatch(/data-type="richtext"|data-type="text"/); // paragraph/heading
  });

  it("maps the single template's title/body to post fields", () => {
    expect(post).toContain('data-field="post.title"');
    expect(post).toContain('data-field="post.body"');
  });

  it("produces no error-level issues", () => {
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
  });
});
