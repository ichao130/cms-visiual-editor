import { describe, expect, it } from "vitest";
import { collapsePhpConditionals, mapTemplateTags, importWpTheme, type WpImportFile } from "../src/index.js";

/**
 * Header fidelity for classic imports, reproduced from the branberyheag header:
 *
 *  A. A logo rendered in BOTH branches of `if (…) : … else : … endif;` must appear
 *     ONCE — stripping PHP naively left every branch, so the logo showed twice.
 *  B. `wp_nav_menu(container=>'ul', container_class=>'gnav', menu_id=>'headernav')`
 *     must become the `<ul class="gnav" id="headernav"><li data-loop="menu">` the
 *     theme's CSS and nav toggle expect — not a bare <nav><a> that nothing styles.
 */

describe("collapsePhpConditionals — keep the first branch", () => {
  it("keeps the if branch and drops the else branch", () => {
    const html = `<?php if ( is_front_page() ) : ?>A<?php else : ?>B<?php endif; ?>`;
    expect(collapsePhpConditionals(html)).toBe("A");
  });

  it("collapses identical branches to a single copy (the duplicate-logo case)", () => {
    const logo = `<div class="logo"><img src="l.png"></div>`;
    const html = `<?php if ( is_front_page() && is_home() ) : ?>${logo}<?php else: ?>${logo}<?php endif; ?>`;
    const out = collapsePhpConditionals(html);
    expect(out.match(/class="logo"/g)?.length).toBe(1);
  });

  it("keeps an if with no else (content survives)", () => {
    expect(collapsePhpConditionals(`<?php if ( x ) : ?>KEEP<?php endif; ?>`)).toBe("KEEP");
  });

  it("keeps the first of an if/elseif/else chain", () => {
    const html = `<?php if (a) : ?>1<?php elseif (b) : ?>2<?php else : ?>3<?php endif; ?>`;
    expect(collapsePhpConditionals(html)).toBe("1");
  });

  it("handles nested conditionals (first branch all the way down)", () => {
    const html = `<?php if (a) : ?>X<?php if (b) : ?>Y<?php else : ?>Z<?php endif; ?>W<?php else : ?>OUT<?php endif; ?>`;
    expect(collapsePhpConditionals(html)).toBe("XYW");
  });

  it("leaves non-conditional PHP and plain markup untouched", () => {
    const html = `<p><?php the_content(); ?></p>`;
    expect(collapsePhpConditionals(html)).toBe(html);
  });
});

describe("mapTemplateTags — wp_nav_menu honours container args", () => {
  it("emits <ul class=container_class id=menu_id> with a data-loop <li>", () => {
    const { html } = mapTemplateTags(
      `<?php wp_nav_menu( array( 'theme_location' => 'navigation', 'menu_id' => 'headernav', 'container' => 'ul', 'container_class' => 'gnav' ) ); ?>`,
    );
    expect(html).toContain('<ul class="gnav" id="headernav">');
    expect(html).toContain('<li data-loop="menu">');
    expect(html).toContain('data-field="item.url"');
    expect(html).not.toContain("<nav>");
  });

  it("wraps the <ul> in the named container when it is not 'ul'", () => {
    const { html } = mapTemplateTags(
      `<?php wp_nav_menu( array( 'container' => 'nav', 'container_class' => 'gnav' ) ); ?>`,
    );
    expect(html).toMatch(/<nav><ul class="gnav"><li data-loop="menu">/);
  });
});

describe("importWpTheme — header integration", () => {
  const files: WpImportFile[] = [
    { path: "style.css", text: `/*\nTheme Name: Demo\n*/` },
    { path: "index.php", text: `<?php get_header(); ?><main><h1>Home</h1></main><?php get_footer(); ?>` },
    { path: "footer.php", text: `<footer>F</footer>` },
    {
      path: "header.php",
      text:
        `<!doctype html><html><head>\n` +
        `<link rel="stylesheet" href="<?php echo get_template_directory_uri() ?>/common/css/styles.css">\n` +
        `<?php wp_head(); ?></head><body>\n` +
        `<div class="nav"><?php wp_nav_menu( array( 'container' => 'ul', 'container_class' => 'gnav', 'menu_id' => 'headernav' ) ); ?></div>\n` +
        `<?php if ( is_front_page() && is_home() ) : ?>\n` +
        `<div class="logo"><a href="<?php echo home_url() ?>" rel="home"><img src="<?php echo get_template_directory_uri() ?>/common/img/logo.png" alt="<?php bloginfo('name'); ?>"></a></div>\n` +
        `<?php else: ?>\n` +
        `<div class="logo"><a href="<?php echo home_url() ?>" rel="home"><img src="<?php echo get_template_directory_uri() ?>/common/img/logo.png" alt="<?php bloginfo('name'); ?>"></a></div>\n` +
        `<?php endif; ?>`,
    },
  ];

  it("renders the logo once and a styled menu list in the layout", () => {
    const layout = importWpTheme(files).files["layout.html"] ?? "";
    expect(layout.match(/class="logo"/g)?.length).toBe(1);
    expect(layout).toContain('<ul class="gnav" id="headernav">');
    expect(layout).toContain('<li data-loop="menu">');
  });
});

describe("importWpTheme — Gutenberg block delimiters never leak", () => {
  it("strips <!-- wp:… --> from a classic/mixed import, keeping the inner HTML", () => {
    // Block patterns (PHP) and FSE templates carry `<!-- wp: -->` markup; the classic
    // path doesn't parse it, so it must at least be stripped (CLAUDE.md: テンプレ記法を除去).
    const files: WpImportFile[] = [
      { path: "style.css", text: `/*\nTheme Name: Demo\n*/` },
      {
        path: "index.php",
        text: `<?php get_header(); ?><main><!-- wp:paragraph {"x":1} --><p>Hello</p><!-- /wp:paragraph --></main><?php get_footer(); ?>`,
      },
      { path: "header.php", text: `<header>H</header>` },
      { path: "footer.php", text: `<footer>F</footer>` },
    ];
    const r = importWpTheme(files);
    const all = Object.values(r.files.templates).join("") + (r.files["layout.html"] ?? "");
    expect(all).not.toContain("<!-- wp:");
    expect(all).not.toContain("wp:paragraph");
    expect(all).toContain("Hello"); // the real content survives
  });
});
