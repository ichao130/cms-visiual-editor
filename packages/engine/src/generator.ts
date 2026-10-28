import type {
  ContentItem,
  ContentTypeDef,
  FieldValue,
  MenuItem,
  PageSettings,
  SiteConfig,
  SiteSettings,
  TaxonomyDef,
  ThemeConfig,
} from "@pcms/shared";
import { renderComposedPage, renderTemplate, RESPONSIVE_CSS } from "./renderer.js";
import type { RenderScope, TermContext } from "./context.js";
import { archivePagePath, archivePageUrl, paginate } from "./pagination.js";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  injectHeadMeta,
  injectHeadStyle,
  injectJsonLd,
  siteJsonLd,
  type Crumb,
} from "./jsonld.js";

/** A parsed theme ready to render (templates as strings, no I/O). */
export interface ThemeBundle {
  config: ThemeConfig;
  /** Shared layout.html, if the theme has one. */
  layout?: string;
  /** Template name (without extension) → HTML. */
  templates: Record<string, string>;
  /** Reusable section type → HTML (theme `sections/`), for composed pages. */
  sections?: Record<string, string>;
  /** Relative asset paths the caller should copy into the output. */
  assets?: string[];
}

/** The whole site as plain data. The engine never touches the filesystem. */
export interface SiteInput {
  site: SiteConfig;
  settings: SiteSettings;
  contentTypes: ContentTypeDef[];
  content: ContentItem[];
  theme: ThemeBundle;
  menus?: Record<string, MenuItem[]>;
  taxonomies?: TaxonomyDef[];
}

export interface GeneratedSite {
  /** Output path (relative, e.g. "about/index.html") → HTML/XML/text. */
  files: Record<string, string>;
  /** Relative asset paths to copy verbatim from the theme. */
  assets: string[];
}

/**
 * Generate a complete static site from site data + a theme.
 *
 * Always emits sitemap.xml, robots.txt, feed.xml and 404.html in addition to
 * the pages (CLAUDE.md: 毎回出力するもの).
 */
export function generateSite(input: SiteInput): GeneratedSite {
  const files: Record<string, string> = {};

  // Content bodies are stored as HTML (authored in the rich text editor), so
  // they pass through as-is. Attach each item's own permalink up front, so loops
  // can bind `data-field="post.url"` to a real URL.
  const content: ContentItem[] = input.content.map((item) => ({
    ...item,
    fields: { ...item.fields, url: "/" + itemPath(item, input.site).replace(/index\.html$/, "") },
    bodyHtml: item.body,
  }));

  const collections = buildCollections(content);
  const menus = input.menus ?? {};
  const layout = input.theme.layout;
  const pageSize = input.site.archivePageSize ?? 10;

  const baseScope = {
    site: input.site,
    theme: input.settings.theme ?? input.theme.config,
    menus,
    collections,
  };

  const siteLd = siteJsonLd(input.site);
  const siteMeta = siteHeadMeta(input.site);
  const home: Crumb = { name: input.site.name, url: "/" };
  const finish = (html: string, extra: object[]): string =>
    injectHeadMeta(
      injectHeadStyle(injectJsonLd(html, [...siteLd, ...extra]), RESPONSIVE_CSS),
      siteMeta,
    );
  const typeLabel = (type: string): string =>
    input.contentTypes.find((t) => t.name === type)?.label ?? type;

  // Render one archive across its pages, with pagination + optional term.
  const renderArchive = (opts: {
    template: string;
    items: ContentItem[];
    baseUrl: string;
    crumbs: Crumb[];
    term?: TermContext;
  }): void => {
    const pages = paginate(opts.items, pageSize);
    for (let i = 0; i < pages.length; i++) {
      const n = i + 1;
      const scope: RenderScope = {
        ...baseScope,
        page: {},
        collections: { ...collections, items: pages[i] as ContentItem[] },
        pagination: {
          current: n,
          total: pages.length,
          baseUrl: opts.baseUrl,
          prevUrl: n > 1 ? archivePageUrl(opts.baseUrl, n - 1) : undefined,
          nextUrl: n < pages.length ? archivePageUrl(opts.baseUrl, n + 1) : undefined,
        },
        ...(opts.term ? { term: opts.term } : {}),
      };
      const html = renderTemplate(opts.template, scope, { layout });
      files[archivePagePath(opts.baseUrl, n)] = finish(html, [
        breadcrumbJsonLd(opts.crumbs, input.site),
      ]);
    }
  };

  // 1. Explicit pages from settings.json (composed instances, or a template).
  for (const [id, page] of Object.entries(input.settings.pages)) {
    let html: string;
    if (page.instances && page.instances.length > 0) {
      html = renderComposedPage(page.instances, input.theme.sections ?? {}, baseScope, {
        layout,
      });
    } else {
      const templateName = page.template ?? id;
      const template = pickTemplate(input.theme, [templateName, "page"]);
      if (template == null) continue;
      const scope: RenderScope = { ...baseScope, page };
      html = renderTemplate(template, scope, { layout });
    }
    files[pagePathForId(id)] = finish(html, []);
  }

  // 2. A page per content item (with Article + breadcrumb structured data).
  for (const item of content) {
    const template = pickTemplate(input.theme, [item.type, "post", "page"]);
    if (template == null) continue;
    const page: PageSettings = input.settings.pages[item.type] ?? {};
    const scope: RenderScope = { ...baseScope, page, item };
    const html = renderTemplate(template, scope, { layout });
    const url = itemUrl(item, input.site);
    files[itemPath(item, input.site)] = finish(html, [
      articleJsonLd(item, input.site, url),
      breadcrumbJsonLd(
        [
          home,
          { name: typeLabel(item.type), url: `/${item.type}/` },
          { name: String(item.fields.title ?? item.slug), url },
        ],
        input.site,
      ),
    ]);
  }

  // 3. Type archives (article listings), paginated.
  for (const type of new Set(content.map((i) => i.type))) {
    const template = pickTemplate(input.theme, [`${type}-archive`, "archive"]);
    if (template == null) continue;
    const base = `/${type}/`;
    renderArchive({
      template,
      items: collections[type] ?? [],
      baseUrl: base,
      crumbs: [home, { name: typeLabel(type), url: base }],
    });
  }

  // 4. Taxonomy term archives, paginated.
  for (const tax of input.taxonomies ?? []) {
    const template = pickTemplate(input.theme, [
      `${tax.name}-archive`,
      "taxonomy",
      "archive",
    ]);
    if (template == null) continue;
    for (const [term, items] of termBuckets(content, tax)) {
      const base = `/${tax.name}/${taxoSlug(term)}/`;
      renderArchive({
        template,
        items: [...items].sort(byDateDesc),
        baseUrl: base,
        term: { taxonomy: tax.name, label: tax.label, value: term, url: base },
        crumbs: [home, { name: `${tax.label}: ${term}`, url: base }],
      });
    }
  }

  // 5. Always-on outputs.
  files["sitemap.xml"] = buildSitemap(files, input.site);
  files["robots.txt"] = buildRobots(input.site);
  files["feed.xml"] = buildFeed(content, input.site);
  if (!files["404.html"]) files["404.html"] = build404(input.site);

  return { files, assets: input.theme.assets ?? [] };
}

function itemUrl(item: ContentItem, site: SiteConfig): string {
  return "/" + itemPath(item, site).replace(/index\.html$/, "");
}

function termBuckets(
  content: ContentItem[],
  tax: TaxonomyDef,
): Map<string, ContentItem[]> {
  const buckets = new Map<string, ContentItem[]>();
  for (const item of content) {
    if (!tax.types.includes(item.type)) continue;
    for (const term of toTerms(item.fields[tax.name])) {
      const arr = buckets.get(term) ?? [];
      arr.push(item);
      buckets.set(term, arr);
    }
  }
  return buckets;
}

function toTerms(value: FieldValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

/** URL-safe slug for a taxonomy term (ASCII slug, else percent-encoded). */
function taxoSlug(term: string): string {
  const ascii = term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || encodeURIComponent(term);
}

function buildCollections(content: ContentItem[]): Record<string, ContentItem[]> {
  const byType: Record<string, ContentItem[]> = {};
  for (const item of content) {
    (byType[item.type] ??= []).push(item);
  }
  const collections: Record<string, ContentItem[]> = {};
  for (const [type, items] of Object.entries(byType)) {
    const sorted = [...items].sort(byDateDesc);
    collections[type] = sorted;
    collections[`${type}s`] = sorted; // allow data-loop="posts"
  }
  return collections;
}

function byDateDesc(a: ContentItem, b: ContentItem): number {
  const da = String(a.fields.date ?? "");
  const db = String(b.fields.date ?? "");
  return db.localeCompare(da);
}

function pickTemplate(
  theme: ThemeBundle,
  candidates: string[],
): string | undefined {
  for (const name of candidates) {
    const tpl = theme.templates[name];
    if (tpl != null) return tpl;
  }
  return undefined;
}

function pagePathForId(id: string): string {
  if (id === "index" || id === "home") return "index.html";
  return `${trimSlashes(id)}/index.html`;
}

function itemPath(item: ContentItem, site: SiteConfig): string {
  const pattern = site.permalink ?? "/:type/:slug/";
  const rel = pattern
    .replace(/:type/g, item.type)
    .replace(/:slug/g, item.slug);
  return `${trimSlashes(rel)}/index.html`;
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, "");
}

function urlForPath(path: string, baseUrl: string): string {
  const clean = path.replace(/index\.html$/, "");
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/${clean}`;
}

function buildSitemap(files: Record<string, string>, site: SiteConfig): string {
  const base = site.baseUrl ?? "";
  const urls = Object.keys(files)
    .filter((p) => p.endsWith("index.html"))
    .map((p) => `  <url><loc>${escapeXml(urlForPath(p, base))}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function buildRobots(site: SiteConfig): string {
  const lines = ["User-agent: *", "Allow: /"];
  if (site.baseUrl) {
    lines.push(`Sitemap: ${site.baseUrl.replace(/\/+$/, "")}/sitemap.xml`);
  }
  return lines.join("\n") + "\n";
}

function buildFeed(content: ContentItem[], site: SiteConfig): string {
  const base = site.baseUrl ?? "";
  const items = [...content]
    .sort(byDateDesc)
    .slice(0, 20)
    .map((item) => {
      const title = escapeXml(String(item.fields.title ?? item.slug));
      const link = escapeXml(urlForPath(itemPath(item, site), base));
      return `    <item><title>${title}</title><link>${link}</link></item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(site.name)}</title>
    <link>${escapeXml(base)}</link>
${items}
  </channel>
</rss>
`;
}

function build404(site: SiteConfig): string {
  return `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>404 - ${escapeXml(site.name)}</title></head>
<body><h1>ページが見つかりません</h1><p><a href="/">トップへ戻る</a></p></body>
</html>
`;
}

/** Meta-tag name for a verification provider key (CLAUDE.md: SEO auto output). */
function verificationMetaName(provider: string): string {
  if (provider === "google") return "google-site-verification";
  if (provider === "bing") return "msvalidate.01";
  return provider;
}

/**
 * Site-wide `<head>` meta: Open Graph defaults (site.json ogpDefault) and
 * search-engine verification tags. Emitted on every page; per-page overrides
 * would come from the content's own SEO fields (not yet wired).
 */
function siteHeadMeta(site: SiteConfig): string {
  const tags: string[] = [
    `<meta property="og:site_name" content="${escapeXml(site.name)}">`,
    `<meta property="og:type" content="website">`,
  ];
  const og = site.ogpDefault;
  if (og?.description) {
    tags.push(`<meta property="og:description" content="${escapeXml(og.description)}">`);
  }
  if (og?.image) {
    const baseUrl = (site.baseUrl ?? "").replace(/\/+$/, "");
    const img = /^https?:/i.test(og.image)
      ? og.image
      : baseUrl === ""
        ? og.image
        : baseUrl + (og.image.startsWith("/") ? og.image : `/${og.image}`);
    tags.push(`<meta property="og:image" content="${escapeXml(img)}">`);
  }
  for (const [provider, token] of Object.entries(site.verificationTags ?? {})) {
    if (token) {
      tags.push(
        `<meta name="${escapeXml(verificationMetaName(provider))}" content="${escapeXml(token)}">`,
      );
    }
  }
  return tags.join("");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
