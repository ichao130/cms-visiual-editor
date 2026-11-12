import { describe, expect, it } from "vitest";
import {
  collectThemeModDefaults,
  mapTemplateTags,
  importWpTheme,
  type WpImportFile,
} from "../src/index.js";

/**
 * Theme-mod default pre-fill. A WordPress theme ZIP carries DESIGN, not the
 * site's DB content — so a top page whose hero text comes from the Customizer
 * (`get_theme_mod` / an `*_mod()` wrapper) imports BLANK. But the text a fresh
 * install shows lives in the theme's OWN defaults, which are in the ZIP. These
 * tests prove we mine those defaults and pre-fill the editable fields, modelled
 * on the real agi-ocean theme (an _s-based client theme).
 */

describe("collectThemeModDefaults", () => {
  it("mines get_theme_mod() inline defaults and marks the getter a wrapper", () => {
    const files: WpImportFile[] = [
      {
        path: "theme/inc/customizer.php",
        text: `<?php
          function my_mod( $key ) { return get_theme_mod( $key, '' ); }
          $x = get_theme_mod( 'accent', '#0a7' );
          $y = get_theme_mod( 'tagline', "海を、次の世代へ" );
        `,
      },
    ];
    const defs = collectThemeModDefaults(files);
    expect(defs.values.get("accent")).toBe("#0a7");
    expect(defs.values.get("tagline")).toBe("海を、次の世代へ");
    expect(defs.wrappers.has("my_mod")).toBe(true);
    expect(defs.wrappers.has("get_theme_mod")).toBe(true);
  });

  it("mines add_setting('key', ['default' => …]) defaults", () => {
    const files: WpImportFile[] = [
      {
        path: "theme/inc/customizer.php",
        text: `<?php
          $wp_customize->add_setting( 'hero_title', array( 'default' => 'ようこそ', 'transport' => 'refresh' ) );
        `,
      },
    ];
    const defs = collectThemeModDefaults(files);
    expect(defs.values.get("hero_title")).toBe("ようこそ");
  });

  it("mines an _s-style field table: 'key' => array( __('label'), '<default>', 'type' )", () => {
    const files: WpImportFile[] = [
      {
        path: "theme/inc/customizer.php",
        text: `<?php
          function agi_ocean_customizer_fields() {
            return array(
              'hero' => array(
                'fields' => array(
                  'hero_title' => array( __( '見出し', 'agi-ocean' ), "遺伝情報の適正な\\n取扱いを推進", 'textarea' ),
                  'hero_btn1'  => array( __( 'ボタン', 'agi-ocean' ), '協会について', 'text' ),
                ),
              ),
            );
          }
          function agi_ocean_mod( $key ) { return get_theme_mod( $key, '' ); }
        `,
      },
    ];
    const defs = collectThemeModDefaults(files);
    expect(defs.values.get("hero_title")).toBe("遺伝情報の適正な\n取扱いを推進");
    expect(defs.values.get("hero_btn1")).toBe("協会について");
    expect(defs.wrappers.has("agi_ocean_mod")).toBe(true);
  });

  it("ignores files that do not configure the Customizer (no false positives)", () => {
    const files: WpImportFile[] = [
      { path: "theme/data.php", text: `<?php $menu = array( 'home' => array( 'Home', '/', 'x' ) );` },
    ];
    expect(collectThemeModDefaults(files).values.size).toBe(0);
  });

  it("mines Kirki field defaults ('settings' + 'default' in one config)", () => {
    const files: WpImportFile[] = [
      {
        path: "theme/inc/kirki.php",
        text: `<?php
          Kirki::add_field( 'theme_config', array(
            'type'     => 'text',
            'settings' => 'footer_copy',
            'label'    => 'Footer',
            'default'  => '© 2026 海洋協会',
          ) );
          new \\Kirki\\Field\\Text( array( 'settings' => 'phone', 'default' => '03-0000-0000' ) );
        `,
      },
    ];
    const defs = collectThemeModDefaults(files);
    expect(defs.values.get("footer_copy")).toBe("© 2026 海洋協会");
    expect(defs.values.get("phone")).toBe("03-0000-0000");
  });

  it("mines get_option() defaults and marks get_option a wrapper", () => {
    const defs = collectThemeModDefaults([
      { path: "theme/inc/options.php", text: `<?php $c = get_option( 'company_name', '海洋協会' );` },
    ]);
    expect(defs.values.get("company_name")).toBe("海洋協会");
    expect(defs.wrappers.has("get_option")).toBe(true);
  });

  it("mines ACF default_value from acf-json and from PHP registration", () => {
    const defs = collectThemeModDefaults([
      {
        path: "theme/acf-json/group_1.json",
        text: JSON.stringify({
          key: "group_1",
          fields: [
            { key: "field_1", name: "cta_heading", type: "text", default_value: "お問い合わせはこちら" },
            { key: "field_2", name: "no_default", type: "text" },
          ],
        }),
      },
      {
        path: "theme/inc/acf.php",
        text: `<?php acf_add_local_field_group( array( 'fields' => array(
          array( 'name' => 'lead_text', 'type' => 'textarea', 'default_value' => '私たちの使命です。' ),
        ) ) );`,
      },
    ]);
    expect(defs.values.get("cta_heading")).toBe("お問い合わせはこちら");
    expect(defs.values.get("lead_text")).toBe("私たちの使命です。");
    expect(defs.values.has("no_default")).toBe(false);
  });
});

describe("mapTemplateTags with ACF / option getters", () => {
  const defs = collectThemeModDefaults([
    {
      path: "theme/acf-json/g.json",
      text: JSON.stringify({ fields: [{ name: "cta_heading", default_value: "まずはご相談ください" }] }),
    },
    { path: "theme/inc/options.php", text: `<?php $x = get_option( 'company_name', '海洋協会' );` },
  ]);

  it("fills a the_field('k') direct-print tag (no echo) with the ACF default", () => {
    const html = `<h2><?php the_field( 'cta_heading' ); ?></h2>`;
    expect(mapTemplateTags(html, defs).html).toContain("<h2>まずはご相談ください</h2>");
  });

  it("fills a get_option echo with the option default", () => {
    const html = `<span><?php echo esc_html( get_option( 'company_name' ) ); ?></span>`;
    expect(mapTemplateTags(html, defs).html).toContain("海洋協会");
  });
});

describe("mapTemplateTags with theme-mod defaults", () => {
  const defs = collectThemeModDefaults([
    {
      path: "inc/customizer.php",
      text: `<?php
        function agi_ocean_customizer_fields() {
          return array( 'hero' => array( 'fields' => array(
            'hero_title' => array( __( '見出し' ), "海を守る\\n次の一歩", 'textarea' ),
            'hero_lede'  => array( __( 'リード' ), '私たちは海洋環境を守ります。', 'textarea' ),
          ) ) );
        }
        function agi_ocean_mod( $key ) { return get_theme_mod( $key, '' ); }
      `,
    },
  ]);

  it("fills a direct wrapper echo with the default text", () => {
    const html = `<p class="lede"><?php echo esc_html( agi_ocean_mod( 'hero_lede' ) ); ?></p>`;
    const r = mapTemplateTags(html, defs);
    expect(r.html).toContain("私たちは海洋環境を守ります。");
    expect(r.html).not.toContain("<?php");
    expect(r.notes.some((n) => n.includes("初期値"))).toBe(true);
  });

  it("fills a `$var = wrapper('key')` echo and turns nl2br into <br>", () => {
    const html = `<?php $hero_title = agi_ocean_mod( 'hero_title' ); ?>
      <h1><?php echo wp_kses_post( nl2br( esc_html( $hero_title ) ) ); ?></h1>`;
    const r = mapTemplateTags(html, defs);
    expect(r.html).toContain("海を守る<br>次の一歩");
  });

  it("leaves echoes with no known default untouched", () => {
    const html = `<span><?php echo esc_html( agi_ocean_mod( 'unknown_key' ) ); ?></span>`;
    // No default for unknown_key → the tag stays (stripped later by the normal path).
    expect(mapTemplateTags(html, defs).html).toContain("<?php");
  });

  it("does nothing without defaults (back-compat single-arg call)", () => {
    const html = `<h1><?php echo esc_html( $x ); ?></h1>`;
    expect(mapTemplateTags(html).html).toBe(mapTemplateTags(html, undefined).html);
  });
});

describe("importWpTheme end-to-end: top page imports populated", () => {
  // A miniature agi-ocean: front-page includes a hero template-part whose text
  // comes entirely from the Customizer; the defaults live in inc/customizer.php.
  const files: WpImportFile[] = [
    { path: "agi/style.css", text: "/*\nTheme Name: AGI Ocean\n*/\nbody{color:#123}" },
    { path: "agi/header.php", text: "<!doctype html><html><head><?php wp_head(); ?></head><body>" },
    { path: "agi/footer.php", text: "<footer>© AGI</footer><?php wp_footer(); ?></body></html>" },
    {
      path: "agi/front-page.php",
      text: `<?php get_header(); ?>
        <?php get_template_part( 'template-parts/hero' ); ?>
        <?php get_footer(); ?>`,
    },
    {
      path: "agi/template-parts/hero.php",
      text: `<?php
        $hero_title = agi_ocean_mod( 'hero_title' );
        $hero_lede  = agi_ocean_mod( 'hero_lede' );
        ?>
        <section class="hero"><div class="wrap">
          <?php if ( $hero_title ) : ?>
            <h1><?php echo wp_kses_post( nl2br( esc_html( $hero_title ) ) ); ?></h1>
          <?php endif; ?>
          <?php if ( $hero_lede ) : ?>
            <p class="lede"><?php echo wp_kses_post( $hero_lede ); ?></p>
          <?php endif; ?>
        </div></section>`,
    },
    { path: "agi/index.php", text: `<?php get_header(); ?><main><h1>Blog</h1></main><?php get_footer(); ?>` },
    {
      path: "agi/inc/customizer.php",
      text: `<?php
        function agi_ocean_customizer_fields() {
          return array( 'hero' => array( 'fields' => array(
            'hero_title' => array( __( '見出し', 'agi-ocean' ), "遺伝情報の適正な\\n取扱いを推進", 'textarea' ),
            'hero_lede'  => array( __( 'リード', 'agi-ocean' ), '遺伝情報の適正な取扱いを推進します。', 'textarea' ),
          ) ) );
        }
        function agi_ocean_mod( $key ) {
          static $d = null;
          if ( null === $d ) { $d = array(); foreach ( agi_ocean_customizer_fields() as $s ) { foreach ( $s['fields'] as $k => $f ) { $d[ $k ] = $f[1]; } } }
          return get_theme_mod( $key, isset( $d[ $key ] ) ? $d[ $key ] : '' );
        }`,
    },
  ];

  const result = importWpTheme(files);
  const home = result.wizard.home.candidates.find((c) => c.stem === "front-page");

  it("classifies as a classic theme", () => {
    expect(result.kind).toBe("classic");
  });

  it("pre-fills the hero heading and lede from the theme's own defaults", () => {
    expect(home).toBeDefined();
    expect(home!.html).toContain("遺伝情報の適正な<br>取扱いを推進");
    expect(home!.html).toContain("遺伝情報の適正な取扱いを推進します。");
  });

  it("leaves no PHP or raw wrapper calls in the output", () => {
    expect(home!.html).not.toContain("<?php");
    expect(home!.html).not.toContain("agi_ocean_mod");
  });

  it("records a note that defaults were imported", () => {
    expect(result.notes.some((n) => n.includes("初期値"))).toBe(true);
  });
});
