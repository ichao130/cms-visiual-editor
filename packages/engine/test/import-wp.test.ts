import { describe, expect, it } from "vitest";
import {
  detectWpThemeKind,
  importWpTheme,
  parseGutenberg,
  gutenbergToHtml,
  wpThemeJsonToKumito,
  parseStyleCssName,
  mapTemplateTags,
  composeClassicTemplate,
  type WpImportFile,
} from "../src/index.js";

describe("parseGutenberg", () => {
  it("parses nested group/columns and self-closing image without throwing", () => {
    const html = `
      <!-- wp:group {"tagName":"section"} -->
      <div class="wp-block-group">
        <!-- wp:heading {"level":2} --><h2>Title</h2><!-- /wp:heading -->
        <!-- wp:columns -->
          <!-- wp:column --><!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph --><!-- /wp:column -->
        <!-- /wp:columns -->
        <!-- wp:image {"id":5} /-->
      </div>
      <!-- /wp:group -->`;
    const blocks = parseGutenberg(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.name).toBe("core/group");
    expect(blocks[0]?.attrs).toMatchObject({ tagName: "section" });
    // group → heading + columns + self-closing image
    const names = blocks[0]!.inner.map((b) => b.name);
    expect(names).toContain("core/heading");
    expect(names).toContain("core/columns");
    expect(names).toContain("core/image");
  });

  it("defaults invalid attrs JSON to {} without throwing", () => {
    const html = `<!-- wp:paragraph {oops:1} --><p>x</p><!-- /wp:paragraph -->`;
    const blocks = parseGutenberg(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.attrs).toEqual({});
    expect(blocks[0]?.innerHtml).toContain("<p>x</p>");
  });

  it("flushes an unclosed block", () => {
    const blocks = parseGutenberg(`<!-- wp:group --><p>y</p>`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.name).toBe("core/group");
  });
});

describe("gutenbergToHtml", () => {
  it("annotates core blocks and preserves unknown blocks verbatim", () => {
    const blocks = parseGutenberg(
      `<!-- wp:heading --><h2>News</h2><!-- /wp:heading -->` +
        `<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->` +
        `<!-- wp:image --><img src="a.jpg" alt=""/><!-- /wp:image -->` +
        `<!-- wp:acme/widget --><div class="acme">keep me</div><!-- /wp:acme/widget -->`,
    );
    const html = gutenbergToHtml(blocks);
    expect(html).toContain('data-field="heading1"');
    expect(html).toContain('data-type="richtext"');
    expect(html).toContain('data-type="image"');
    expect(html).toContain("keep me"); // unknown block preserved
    expect(html).not.toContain("<!-- wp:");
  });
});

describe("wpThemeJsonToKumito", () => {
  it("maps palette, fonts and spacing; keeps unknown slugs", () => {
    const raw = JSON.stringify({
      title: "Acme",
      settings: {
        color: {
          palette: [
            { slug: "primary", color: "#111" },
            { slug: "background", color: "#fff" },
            { slug: "foreground", color: "#222" },
            { slug: "brandish", color: "#abc" },
          ],
        },
        typography: {
          fontFamilies: [
            { slug: "heading", fontFamily: "Georgia, serif" },
            { slug: "body", fontFamily: "Arial, sans-serif" },
          ],
        },
        spacing: { spacingSizes: [{ size: "1rem" }, { size: "5rem" }] },
      },
    });
    const { config } = wpThemeJsonToKumito(raw);
    expect(config.name).toBe("Acme");
    expect(config.colors?.primary).toBe("#111");
    expect(config.colors?.bg).toBe("#fff");
    expect(config.colors?.text).toBe("#222");
    expect(config.colors?.brandish).toBe("#abc"); // unknown slug preserved
    expect(config.fonts?.heading).toBe("Georgia, serif");
    expect(config.fonts?.body).toBe("Arial, sans-serif");
    expect(config.spacing?.section).toBe("5rem");
  });

  it("never throws on invalid json", () => {
    expect(() => wpThemeJsonToKumito("{not json")).not.toThrow();
    expect(wpThemeJsonToKumito("{not json").config).toEqual({});
  });
});

describe("parseStyleCssName", () => {
  it("reads the Theme Name header", () => {
    expect(parseStyleCssName("/*\nTheme Name: My Cafe\nAuthor: x\n*/")).toBe("My Cafe");
  });
});

describe("mapTemplateTags", () => {
  it("maps the common WordPress template tags to data-field, leaving no php", () => {
    const html =
      `<h1><?php the_title(); ?></h1>` +
      `<?php the_content(); ?>` +
      `<img src="<?php echo get_template_directory_uri(); ?>/img/logo.png">` +
      `<a href="<?php the_permalink(); ?>">read</a>` +
      `<title><?php bloginfo('name'); ?></title>` +
      `<body class="<?php body_class(); ?>">`;
    const { html: out } = mapTemplateTags(html);
    expect(out).toContain('data-field="post.title"');
    expect(out).toContain('data-slot="content"');
    expect(out).toContain('data-field="post.body"');
    expect(out).toContain('src="/img/logo.png"'); // helper collapsed to a relative path
    expect(out).toContain('href="#">read</a>'); // permalink collapsed
    expect(out).toContain('data-field="site.name"');
    expect(out).not.toContain("<?php");
  });
});

describe("composeClassicTemplate", () => {
  it("inlines get_header/get_footer/get_template_part with a recursion guard", () => {
    const files = new Map<string, string>([
      ["index.php", `<?php get_header(); ?><main><?php get_template_part('parts/content'); ?></main><?php get_footer(); ?>`],
      ["header.php", `<header>HEAD<?php get_header(); ?></header>`], // self-reference → guard
      ["footer.php", `<footer>FOOT</footer>`],
      ["parts/content.php", `<article>BODY</article>`],
    ]);
    const out = composeClassicTemplate("index", files);
    expect(out).toContain("<header>HEAD");
    expect(out).toContain("<footer>FOOT");
    expect(out).toContain("<article>BODY</article>");
  });
});

describe("importWpTheme — classic", () => {
  const files: WpImportFile[] = [
    { path: "style.css", text: "/*\nTheme Name: Classic Cafe\n*/\nbody{color:#111}" },
    {
      path: "header.php",
      text: `<!doctype html><html <?php language_attributes(); ?>><head><?php wp_head(); ?></head><body <?php body_class(); ?>><header class="site-header"><a href="<?php echo home_url(); ?>"><?php bloginfo('name'); ?></a></header>`,
    },
    { path: "footer.php", text: `<footer class="site-footer"><?php wp_footer(); ?>© Cafe</footer></body></html>` },
    {
      path: "index.php",
      text: `<?php get_header(); ?><main><h2>News</h2><ul><?php while(have_posts()): the_post(); ?><li><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></li><?php endwhile; ?></ul></main><?php get_footer(); ?>`,
    },
    {
      path: "single.php",
      text: `<?php get_header(); ?><article><h1><?php the_title(); ?></h1><div><?php the_content(); ?></div></article><?php get_footer(); ?>`,
    },
  ];

  it("detects a classic theme and produces php-free templates + layout", () => {
    expect(detectWpThemeKind(files)).toBe("classic");
    const r = importWpTheme(files);
    expect(r.kind).toBe("classic");
    const all = JSON.stringify(r.files);
    expect(all).not.toContain("<?php");
    expect(all).not.toContain("<!-- wp:");
    expect(r.files.templates.index).toBeTruthy();
    expect(r.files.templates.post).toBeTruthy();
    expect(r.files["layout.html"]).toContain('data-slot="content"');
    expect(r.files["layout.html"]).toContain('href="/assets/style.css"');
    expect(r.files["theme.json"]).toContain("Classic Cafe");
    // the post template exposes the title/body as editable fields
    expect(r.files.templates.post).toContain('data-field="post.title"');
    expect(r.files.templates.post).toContain('data-field="post.body"');
  });

  it("every produced template passes theme validation with no errors", () => {
    const r = importWpTheme(files);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("importWpTheme — block", () => {
  const files: WpImportFile[] = [
    { path: "style.css", text: "/*\nTheme Name: Block Cafe\n*/" },
    { path: "theme.json", text: JSON.stringify({ title: "Block Cafe", settings: { color: { palette: [{ slug: "primary", color: "#0a0" }] } } }) },
    { path: "parts/header.html", text: `<!-- wp:site-title /--><!-- wp:navigation /-->` },
    { path: "parts/footer.html", text: `<!-- wp:paragraph --><p>© Cafe</p><!-- /wp:paragraph -->` },
    {
      path: "templates/index.html",
      text:
        `<!-- wp:heading --><h2>Welcome</h2><!-- /wp:heading -->` +
        `<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->` +
        `<!-- wp:image --><img src="hero.jpg" alt=""/><!-- /wp:image -->`,
    },
    {
      path: "templates/single.html",
      text: `<!-- wp:post-title /--><!-- wp:post-content /-->`,
    },
  ];

  it("detects a block theme and converts blocks to editable fields", () => {
    expect(detectWpThemeKind(files)).toBe("block");
    const r = importWpTheme(files);
    expect(r.kind).toBe("block");
    const all = JSON.stringify(r.files);
    expect(all).not.toContain("<!-- wp:");
    expect(r.files.templates.index).toContain('data-type="image"');
    expect(r.files.templates.post).toContain('data-field="post.title"');
    expect(r.files.templates.post).toContain('data-field="post.body"');
    expect(r.files["theme.json"]).toContain("#0a0");
    expect(r.files["layout.html"]).toContain('data-slot="content"');
    expect(r.files.assets).toContain("hero.jpg");
  });
});
