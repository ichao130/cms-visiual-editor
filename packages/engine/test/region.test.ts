import { describe, expect, it } from "vitest";
import type { SiteInput } from "../src/index.js";
import { generateSite, mergeRegions, renderComposedPage } from "../src/index.js";

const sections = {
  header: '<div class="hdr"><a data-field="site.name">Site</a></div>',
  footer: '<div class="ftr"><small data-field="site.name">Site</small></div>',
  altHeader: '<div class="hdr-alt">このページ専用ヘッダー</div>',
  altFooter: '<div class="ftr-alt">このページ専用フッター</div>',
  hero: '<section><h1 data-field="heading">H</h1></section>',
};

// A layout that opts into header/footer regions via named slots.
const layoutWithSlots =
  '<html><head><title data-field="site.name"></title></head><body>' +
  '<header data-slot="header"></header>' +
  '<main data-slot="content"></main>' +
  '<footer data-slot="footer"></footer>' +
  "</body></html>";

// A layout with its own fixed header, no region slots.
const layoutFixed =
  '<html><head></head><body>' +
  '<header class="fixed-head">固定ヘッダー</header>' +
  '<main data-slot="content"></main>' +
  "</body></html>";

function baseInput(layout: string, regions?: SiteInput["settings"]["regions"]): SiteInput {
  return {
    site: { name: "店", baseUrl: "https://ex.test" },
    settings: {
      regions,
      pages: {
        index: { instances: [{ id: "h1", type: "hero", fields: { heading: "ようこそ" } }] },
        about: { template: "page" },
      },
    },
    contentTypes: [],
    content: [],
    theme: {
      config: {},
      layout,
      templates: { page: "<main><h1>About</h1></main>" },
      sections,
    },
  };
}

describe("site-wide header/footer regions", () => {
  it("composes regions into the layout slots on every page", () => {
    const regions = {
      header: [{ id: "hd1", type: "header" }],
      footer: [{ id: "ft1", type: "footer" }],
    };
    const { files } = generateSite(baseInput(layoutWithSlots, regions));
    for (const path of ["index.html", "about/index.html"]) {
      const html = files[path]!;
      expect(html, path).toContain('class="hdr"');
      expect(html, path).toContain('class="ftr"');
      // region content binds the layout-level data-field (site.name)
      expect(html, path).toContain(">店<");
    }
  });

  it("keeps the layout's own header when the theme has no region slots", () => {
    const regions = { header: [{ id: "hd1", type: "header" }] };
    const { files } = generateSite(baseInput(layoutFixed, regions));
    const home = files["index.html"]!;
    expect(home).toContain("固定ヘッダー"); // fallback: fixed header untouched
    expect(home).not.toContain('class="hdr"'); // region not injected (no slot)
  });

  it("leaves region slots empty with no markers in published output", () => {
    // Region present but empty → no sections, and no editor insert markers.
    const { files } = generateSite(baseInput(layoutWithSlots, { header: [] }));
    const home = files["index.html"]!;
    expect(home).not.toContain("pcms-insert");
    expect(home).not.toContain('class="hdr"');
  });

  it("lets one page override its header/footer while others stay site-wide", () => {
    const input = baseInput(layoutWithSlots, {
      header: [{ id: "hd1", type: "header" }],
      footer: [{ id: "ft1", type: "footer" }],
    });
    // `about` gets its own header + footer; `index` keeps the site-wide ones.
    input.settings.pages.about!.regions = {
      header: [{ id: "a-hd", type: "altHeader" }],
      footer: [{ id: "a-ft", type: "altFooter" }],
    };
    const { files } = generateSite(input);

    const about = files["about/index.html"]!;
    expect(about).toContain('class="hdr-alt"'); // page-specific header
    expect(about).toContain('class="ftr-alt"'); // page-specific footer
    expect(about).not.toContain('class="hdr"'); // site header replaced
    expect(about).not.toContain('class="ftr"');

    const home = files["index.html"]!;
    expect(home).toContain('class="hdr"'); // unaffected, still site-wide
    expect(home).toContain('class="ftr"');
    expect(home).not.toContain('class="hdr-alt"');
  });

  it("merges a partial page override with the site-wide regions", () => {
    const input = baseInput(layoutWithSlots, {
      header: [{ id: "hd1", type: "header" }],
      footer: [{ id: "ft1", type: "footer" }],
    });
    // Override only the header; the footer falls back to the site-wide one.
    input.settings.pages.about!.regions = { header: [{ id: "a-hd", type: "altHeader" }] };
    const about = generateSite(input).files["about/index.html"]!;
    expect(about).toContain('class="hdr-alt"'); // overridden header
    expect(about).toContain('class="ftr"'); // site-wide footer kept
    expect(about).not.toContain('class="hdr"');
  });

  it("marks region sections editable in preview mode", () => {
    const html = renderComposedPage(
      [{ id: "h1", type: "hero", fields: { heading: "本文" } }],
      sections,
      { site: { name: "店", baseUrl: "https://ex.test" }, theme: {}, menus: {}, collections: {} },
      {
        layout: layoutWithSlots,
        markEditable: true,
        regions: { header: [{ id: "hd1", type: "header" }], footer: [] },
        sections,
      },
    );
    // header region: selectable section + region wrapper + insert markers
    expect(html).toContain('data-pcms-region="header"');
    expect(html).toContain('data-pcms-section="hd1"');
    expect(html).toContain("pcms-insert");
    // empty footer region in the editor shows the add hint + a marker
    expect(html).toContain('data-pcms-region="footer"');
    expect(html).toContain("フッターにはセクションがありません");
    // body is wrapped as its own region
    expect(html).toContain('data-pcms-region="body"');
  });
});

describe("mergeRegions", () => {
  const site = { header: [{ id: "h", type: "header" }], footer: [{ id: "f", type: "footer" }] };

  it("returns the site-wide regions unchanged when there is no override", () => {
    expect(mergeRegions(site, undefined)).toBe(site);
    expect(mergeRegions(undefined, undefined)).toBeUndefined();
  });

  it("lets the page value win per region", () => {
    const page = { header: [{ id: "ph", type: "altHeader" }] };
    expect(mergeRegions(site, page)).toEqual({
      header: [{ id: "ph", type: "altHeader" }],
      footer: [{ id: "f", type: "footer" }],
    });
  });

  it("treats an empty override region as an explicit (empty) override", () => {
    expect(mergeRegions(site, { header: [] })).toEqual({ header: [], footer: site.footer });
  });

  it("keeps a region absent when neither side defines it", () => {
    expect(mergeRegions({ header: site.header }, {})).toEqual({ header: site.header });
    expect(mergeRegions(undefined, {})).toEqual({});
  });
});
