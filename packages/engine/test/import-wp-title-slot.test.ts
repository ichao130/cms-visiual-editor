import { describe, expect, it } from "vitest";
import { importWpTheme, mapTemplateTags, type WpImportFile } from "../src/index.js";

/**
 * Two fidelity guarantees for Underscores(_s)-style classic imports, reproduced
 * from the branberyheag theme's own shape:
 *
 *  A. `the_title( '<h1 class="hdl">', '</h1>' )` keeps its heading wrapper (the
 *     class carries the styling) with the editable field on that element, instead
 *     of collapsing to a bare <span> and dropping the <h1>.
 *  B. A content part that builds the body container but omits `the_content()`
 *     (ships an empty `<div class="richtext">`) still gets an editable body slot,
 *     so single posts are never left without `data-slot="content"`.
 */

describe("mapTemplateTags — the_title wrapper", () => {
  it("puts the field on the heading wrapper and keeps its class", () => {
    const { html } = mapTemplateTags(`<?php the_title( '<h1 class="hdl -pagetitle">', '</h1>' ); ?>`);
    expect(html).toContain('<h1 class="hdl -pagetitle" data-field="post.title"');
    expect(html).toContain("</h1>");
    expect(html).not.toContain('<span data-field="post.title"'); // not flattened
  });

  it("nests the field inside multi-element wrappers", () => {
    const { html } = mapTemplateTags(`<?php the_title( '<h1><span class="ttl">', '</span></h1>' ); ?>`);
    expect(html).toContain('<h1><span class="ttl"><span data-field="post.title"');
    expect(html).toContain("</span></span></h1>");
  });

  it("still maps a bare the_title() to a span", () => {
    const { html } = mapTemplateTags(`<?php the_title(); ?>`);
    expect(html).toContain('<span data-field="post.title"');
  });
});

const HEADER = `<!doctype html><html <?php language_attributes(); ?>><head><?php wp_head(); ?></head><body <?php body_class(); ?>><header class="site-header"></header>`;
const FOOTER = `<footer class="site-footer"><?php wp_footer(); ?></footer></body></html>`;
const INDEX = `<?php get_header(); ?><main><h1>Home</h1></main><?php get_footer();`;

const SINGLE = `<?php get_header(); ?>
<?php while ( have_posts() ) : the_post();
  get_template_part( 'template-parts/content', get_post_type() );
endwhile; ?>
<?php get_footer();`;

// content.php as the branberyheag theme ships it: a Pagetitle heading with an
// h1 wrapper, then an empty richtext container — no the_content() anywhere.
const CONTENT = `<div id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
<div id="Pagetitle" class="layout-wrap pagetitle-area">
<?php the_title( '<h1 class="hdl -pagetitle">', '</h1>' ); ?>
</div>
<div id="Contents" class="layout-wrap">
<div class="richtext"></div>
</div>
</div>`;

const FILES: WpImportFile[] = [
  { path: "style.css", text: "/*\nTheme Name: Fidelity Cafe\n*/\nbody{}" },
  { path: "header.php", text: HEADER },
  { path: "footer.php", text: FOOTER },
  { path: "index.php", text: INDEX },
  { path: "single.php", text: SINGLE },
  { path: "template-parts/content.php", text: CONTENT },
];

describe("importWpTheme — body slot guaranteed when the_content is absent", () => {
  const r = importWpTheme(FILES);
  const post = r.files.templates.post ?? "";

  it("keeps the real part structure (no generic fallback)", () => {
    expect(post).toContain("Pagetitle");
    expect(post).toContain('data-field="post.title"');
    expect(r.notes.some((n) => n.includes("汎用テンプレート"))).toBe(false);
  });

  it("injects an editable body slot into the empty richtext container", () => {
    expect(post).toContain('data-slot="content"');
    expect(r.notes.some((n) => n.includes("本文スロット"))).toBe(true);
  });

  it("leaves no leaked PHP", () => {
    expect(post).not.toContain("<?");
  });
});
