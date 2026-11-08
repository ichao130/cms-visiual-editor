import { describe, expect, it } from "vitest";
import { importWpTheme, collectEnqueuedScripts, type WpImportFile } from "../src/index.js";

/**
 * Script-set fidelity for classic WordPress imports. A WP theme ships a whole
 * vendor folder (a dozen `anime.*.js` versions, both `jquery.js` and a CDN copy,
 * `slick.js` + `slick.min.js`); the first implementation linked EVERY file,
 * loading conflicting globals and breaking the page. Only the scripts the theme
 * actually loads — inline in header/footer, or enqueued in functions.php — must
 * end up in the layout; the rest are carried but never linked. Also: a page/post
 * template that composes to nothing falls back to a generic title+body template.
 */

const FUNCTIONS = `<?php
function theme_scripts() {
  wp_enqueue_script('jquery'); // handle only — WP's bundled copy, no URL
  wp_enqueue_script('slick', get_template_directory_uri() . '/assets/slick.min.js', array('jquery'), '1.0', true);
  wp_register_script('rellax', get_theme_file_uri('/js/rellax.min.js'), array(), null, true);
  wp_enqueue_script('rellax');
  wp_enqueue_script('maps', 'https://cdn.example.com/maps.js', array(), null, true);
}
add_action('wp_enqueue_scripts', 'theme_scripts');`;

const HEADER = `<!doctype html><html <?php language_attributes(); ?>><head><?php wp_head(); ?></head><body>
<header><div class="logo"><a href="<?php echo home_url(); ?>"><img src="/img/logo.png"></a></div></header>
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>`;

const FOOTER = `<footer><p>(c) Example</p></footer><?php wp_footer(); ?>
<script src="/js/app.js"></script>
</body></html>`;

const INDEX = `<?php get_header(); ?><main><h1>ホーム</h1><p>ようこそ。</p></main><?php
get_footer();`;

// A page.php whose content lives in a template-part that is NOT in the archive,
// so composition yields an empty body → the generic fallback must kick in.
const PAGE = `<?php get_header(); get_template_part('template-parts/content', 'page'); get_footer();`;

const FILES: WpImportFile[] = [
  { path: "style.css", text: "/*\nTheme Name: ScriptCafe\n*/\nbody{}" },
  { path: "functions.php", text: FUNCTIONS },
  { path: "header.php", text: HEADER },
  { path: "footer.php", text: FOOTER },
  { path: "index.php", text: INDEX },
  { path: "page.php", text: PAGE },
];

describe("collectEnqueuedScripts", () => {
  const got = collectEnqueuedScripts(FILES);
  const urls = got.map((s) => s.url);

  it("collects enqueued local scripts as /assets/<basename>", () => {
    expect(urls).toContain("/assets/slick.min.js");
    expect(urls).toContain("/assets/rellax.min.js");
  });

  it("keeps enqueued external (CDN) scripts verbatim", () => {
    const maps = got.find((s) => s.url.includes("maps.js"));
    expect(maps?.external).toBe(true);
    expect(maps?.url).toBe("https://cdn.example.com/maps.js");
  });

  it("ignores a handle-only enqueue (no URL argument)", () => {
    // `wp_enqueue_script('jquery')` registers nothing to load from the theme.
    expect(urls.some((u) => /jquery/i.test(u))).toBe(false);
  });
});

describe("importWpTheme — layout loads only the real script set", () => {
  const r = importWpTheme(FILES);
  const layout = r.files["layout.html"] ?? "";

  it("keeps the header/footer inline scripts (external kept, local localized)", () => {
    expect(layout).toContain("code.jquery.com"); // inline CDN in header
    expect(layout).toContain("/assets/app.js"); // footer inline, localized
  });

  it("appends functions.php-enqueued scripts not already inline", () => {
    expect(layout).toContain("/assets/slick.min.js");
    expect(layout).toContain("/assets/rellax.min.js");
    expect(layout).toContain("https://cdn.example.com/maps.js");
  });

  it("does NOT dump a <script> for every file — only the real set", () => {
    const count = (layout.match(/<script\b[^>]*\bsrc=/gi) ?? []).length;
    // jquery(inline) + app.js(inline) + slick + rellax + maps = 5
    expect(count).toBeLessThanOrEqual(5);
  });

  it("leaves no PHP in the layout", () => {
    expect(layout).not.toContain("<?");
  });
});

describe("importWpTheme — empty page/post falls back to a generic template", () => {
  const r = importWpTheme(FILES);
  const page = r.files.templates.page ?? "";
  const post = r.files.templates.post ?? "";

  it("a page whose template-part is absent still renders title + body", () => {
    expect(page).toContain('data-field="post.title"');
    expect(page).toContain('data-field="post.body"');
    expect(page).toContain('data-slot="content"');
  });

  it("a post template exists even though the theme shipped no single.php", () => {
    expect(post).toContain('data-field="post.body"');
    expect(post).toContain('data-slot="content"');
  });

  it("records a note explaining the fallback", () => {
    expect(r.notes.some((n) => n.includes("汎用テンプレート"))).toBe(true);
  });
});
