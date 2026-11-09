import { describe, expect, it } from "vitest";
import { importWpTheme, composeClassicTemplate, type WpImportFile } from "../src/index.js";

/**
 * Underscores (_s) based themes wrap the content include in the main loop:
 *
 *   <?php while ( have_posts() ) : the_post();
 *     get_template_part( 'template-parts/content-page', 'page' );
 *   endwhile; ?>
 *
 * A tag-anchored match (`<?php get_template_part … ?>`) misses that call, so the
 * whole loop is lost to PHP stripping and page/single fall back to a bare generic
 * template. The include must be inlined wherever it appears, and the second arg
 * may be a non-literal (e.g. get_post_type()) that resolves to the base part.
 */

const HEADER = `<!doctype html><html <?php language_attributes(); ?>><head><?php wp_head(); ?></head><body <?php body_class(); ?>><header class="site-header"></header>`;
const FOOTER = `<footer class="site-footer"><?php wp_footer(); ?></footer></body></html>`;
const INDEX = `<?php get_header(); ?><main><h1>Home</h1></main><?php get_footer();`;

// page.php — the include lives inside the have_posts() loop, with a two-arg
// get_template_part whose part file is the base name (content-page.php).
const PAGE = `<?php get_header(); ?>
<?php while ( have_posts() ) : the_post();
  get_template_part( 'template-parts/content-page', 'page' );
endwhile; ?>
<?php get_footer();`;

const CONTENT_PAGE = `<div id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
<div id="Pagetitle" class="layout-wrap pagetitle-area">
<?php the_title( '<h1 class="hdl">', '</h1>' ); ?>
</div>
<div id="Contents" class="layout-wrap">
<div class="richtext"><?php the_content(); ?></div>
</div>
</div>`;

// single.php — the second arg is a function call (get_post_type()), not a string,
// so only the base part (content.php) resolves.
const SINGLE = `<?php get_header(); ?>
<?php while ( have_posts() ) : the_post();
  get_template_part( 'template-parts/content', get_post_type() );
endwhile; ?>
<?php get_footer();`;

const CONTENT = `<div id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
<div id="Single" class="layout-wrap">
<?php the_title( '<h1>', '</h1>' ); ?>
<div class="richtext"><?php the_content(); ?></div>
</div>
</div>`;

const FILES: WpImportFile[] = [
  { path: "style.css", text: "/*\nTheme Name: Parts Cafe\n*/\nbody{}" },
  { path: "header.php", text: HEADER },
  { path: "footer.php", text: FOOTER },
  { path: "index.php", text: INDEX },
  { path: "page.php", text: PAGE },
  { path: "single.php", text: SINGLE },
  { path: "template-parts/content-page.php", text: CONTENT_PAGE },
  { path: "template-parts/content.php", text: CONTENT },
];

describe("importWpTheme — loop-wrapped get_template_part", () => {
  const r = importWpTheme(FILES);
  const page = r.files.templates.page ?? "";
  const post = r.files.templates.post ?? "";

  it("page inlines the part from inside the have_posts() loop", () => {
    expect(page).toContain("Pagetitle"); // the part's own wrapper survived
    expect(page).toContain("layout-wrap");
    expect(page).toContain('data-field="post.title"');
    expect(page).toContain('data-slot="content"');
    expect(page).not.toContain("<?"); // no leaked PHP
  });

  it("single resolves a non-literal second arg to the base part", () => {
    expect(post).toContain("Single"); // content.php (not content-<type>.php) was used
    expect(post).toContain('data-field="post.title"');
    expect(post).toContain('data-slot="content"');
  });

  it("does NOT fall back to the generic template (no note)", () => {
    expect(r.notes.some((n) => n.includes("汎用テンプレート"))).toBe(false);
  });
});

describe("composeClassicTemplate — loop-wrapped include", () => {
  it("inlines a get_template_part that is not its own <?php tag", () => {
    const files = new Map<string, string>([
      ["index.php", `<?php get_header(); ?><main><?php while(have_posts()):the_post(); get_template_part('parts/content'); endwhile; ?></main><?php get_footer(); ?>`],
      ["header.php", `<header>HEAD</header>`],
      ["footer.php", `<footer>FOOT</footer>`],
      ["parts/content.php", `<article>BODY</article>`],
    ]);
    const out = composeClassicTemplate("index", files);
    expect(out).toContain("<article>BODY</article>");
  });
});
