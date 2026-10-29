import type {
  ContentItem,
  ContentTypeDef,
  FieldValue,
  MediaItem,
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
  /** Stored media, used to supply default `alt` text for image fields. */
  media?: MediaItem[];
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

  // Draft items are kept in the editor but never generated (CLAUDE.md: AIは下書き
  // …; drafts stay out of the published site). Filter them before anything else,
  // so they are absent from pages, loops, archives, the feed and the sitemap.
  const live = input.content.filter((item) => item.status !== "draft");

  // Content bodies are stored as HTML (authored in the rich text editor), so
  // they pass through as-is. Attach each item's own permalink up front, so loops
  // can bind `data-field="post.url"` to a real URL.
  const content: ContentItem[] = live.map((item) => ({
    ...item,
    fields: { ...item.fields, url: "/" + itemPath(item, input.site).replace(/index\.html$/, "") },
    bodyHtml: item.body,
  }));

  const collections = buildCollections(content);
  const menus = input.menus ?? {};
  const layout = input.theme.layout;
  const pageSize = input.site.archivePageSize ?? 10;

  const mediaByPath: Record<string, MediaItem> = {};
  for (const m of input.media ?? []) mediaByPath[m.path] = m;

  const baseScope = {
    site: input.site,
    theme: input.settings.theme ?? input.theme.config,
    menus,
    collections,
    media: mediaByPath,
  };

  // Output paths that asked not to be indexed (noindex). They are still written
  // as pages but kept out of sitemap.xml so search engines are not pointed at
  // them.
  const noindexPaths = new Set<string>();

  const siteLd = siteJsonLd(input.site);
  const siteMeta = siteHeadMeta(input.site);
  const home: Crumb = { name: input.site.name, url: "/" };
  // `path` is the page's own output path (for its canonical URL). `opts` carries
  // per-page head overrides (description, og:type) applied to this page only.
  const finish = (path: string, html: string, extra: object[], opts?: PageMetaOpts): string =>
    injectHeadMeta(
      injectHeadStyle(injectJsonLd(html, [...siteLd, ...extra]), RESPONSIVE_CSS),
      (opts ? siteHeadMeta(input.site, opts) : siteMeta) + pageHeadMeta(path, input.site),
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
      const outPath = archivePagePath(opts.baseUrl, n);
      files[outPath] = finish(outPath, html, [breadcrumbJsonLd(opts.crumbs, input.site)]);
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
    const outPath = pagePathForId(id);
    files[outPath] = finish(outPath, html, []);
  }

  // 2. A page per content item (with Article + breadcrumb structured data).
  for (const item of content) {
    const template = pickTemplate(input.theme, [item.type, "post", "page"]);
    if (template == null) continue;
    const page: PageSettings = input.settings.pages[item.type] ?? {};
    const scope: RenderScope = { ...baseScope, page, item };
    const html = renderTemplate(template, scope, { layout });
    const url = itemUrl(item, input.site);
    const outPath = itemPath(item, input.site);
    if (item.noindex) noindexPaths.add(outPath);
    files[outPath] = finish(
      outPath,
      html,
      [
        articleJsonLd(item, input.site, url),
        breadcrumbJsonLd(
        [
          home,
          { name: typeLabel(item.type), url: `/${item.type}/` },
          { name: String(item.fields.title ?? item.slug), url },
        ],
        input.site,
      ),
      ],
      { description: itemDescription(item), ogType: "article", noindex: item.noindex },
    );
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
  files["sitemap.xml"] = buildSitemap(files, input.site, noindexPaths);
  files["robots.txt"] = buildRobots(input.site);
  files["feed.xml"] = buildFeed(
    content.filter((item) => !item.noindex),
    input.site,
    input.taxonomies ?? [],
  );
  if (!files["404.html"]) files["404.html"] = build404(input.site);

  return { files, assets: input.theme.assets ?? [] };
}

function itemUrl(item: ContentItem, site: SiteConfig): string {
  return "/" + itemPath(item, site).replace(/index\.html$/, "");
}

/** A content item's own meta description, from a description/excerpt field. */
function itemDescription(item: ContentItem): string | undefined {
  const value = item.fields.description ?? item.fields.excerpt;
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
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
    const sorted = [...items].sort(byOrderThenDate);
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

/**
 * Sort by the operator's manual order when present, else by date (newest
 * first). Within one type `order` is all-or-nothing, but items missing it sort
 * after ordered ones so a partial order still behaves predictably.
 */
function byOrderThenDate(a: ContentItem, b: ContentItem): number {
  if (a.order != null || b.order != null) {
    const oa = a.order ?? Number.POSITIVE_INFINITY;
    const ob = b.order ?? Number.POSITIVE_INFINITY;
    if (oa !== ob) return oa - ob;
  }
  return byDateDesc(a, b);
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

function buildSitemap(
  files: Record<string, string>,
  site: SiteConfig,
  noindexPaths: Set<string>,
): string {
  const base = site.baseUrl ?? "";
  const urls = Object.keys(files)
    .filter((p) => p.endsWith("index.html") && !noindexPaths.has(p))
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

function buildFeed(
  content: ContentItem[],
  site: SiteConfig,
  taxonomies: TaxonomyDef[],
): string {
  const base = (site.baseUrl ?? "").replace(/\/+$/, "");
  const sorted = [...content].sort(byDateDesc).slice(0, 20);
  const items = sorted
    .map((item) => {
      const title = escapeXml(String(item.fields.title ?? item.slug));
      const link = escapeXml(urlForPath(itemPath(item, site), base));
      const lines = [
        `    <item>`,
        `      <title>${title}</title>`,
        `      <link>${link}</link>`,
        `      <guid isPermaLink="true">${link}</guid>`,
      ];
      const pub = rfc822(item.fields.date);
      if (pub) lines.push(`      <pubDate>${pub}</pubDate>`);
      const desc = itemDescription(item);
      if (desc) lines.push(`      <description>${escapeXml(desc)}</description>`);
      for (const term of feedCategories(item, taxonomies)) {
        lines.push(`      <category>${escapeXml(term)}</category>`);
      }
      lines.push(`    </item>`);
      return lines.join("\n");
    })
    .join("\n");
  // Newest item's date drives lastBuildDate; fall back to nothing when undated.
  const lastBuild = sorted.length > 0 ? rfc822(sorted[0]!.fields.date) : undefined;
  const channelDesc = escapeXml(site.ogpDefault?.description ?? site.name);
  const selfLink = base ? `${base}/feed.xml` : "feed.xml";
  const channel = [
    `    <title>${escapeXml(site.name)}</title>`,
    `    <link>${escapeXml(base)}</link>`,
    `    <description>${channelDesc}</description>`,
    `    <language>ja</language>`,
    `    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml"/>`,
  ];
  if (lastBuild) channel.push(`    <lastBuildDate>${lastBuild}</lastBuildDate>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
${channel.join("\n")}
${items}
  </channel>
</rss>
`;
}

/** The taxonomy terms assigned to an item, for <category> tags in the feed. */
function feedCategories(item: ContentItem, taxonomies: TaxonomyDef[]): string[] {
  const terms: string[] = [];
  for (const tax of taxonomies) {
    if (!tax.types.includes(item.type)) continue;
    for (const term of toTerms(item.fields[tax.name])) terms.push(term);
  }
  return terms;
}

/** Format a stored date ("2026-02-01", "2026/02/01") as an RFC 822 date. */
function rfc822(value: FieldValue | undefined): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const ms = Date.parse(value.replace(/\//g, "-"));
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toUTCString();
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
 * Per-page `<head>` meta: the canonical URL (and matching og:url) for this
 * output path. Needs an absolute base URL, so it is omitted until site.baseUrl
 * is set (a relative canonical would be worse than none).
 */
function pageHeadMeta(path: string, site: SiteConfig): string {
  const base = (site.baseUrl ?? "").replace(/\/+$/, "");
  if (!base) return "";
  const url = escapeXml(urlForPath(path, base));
  return `<link rel="canonical" href="${url}"><meta property="og:url" content="${url}">`;
}

/** Per-page overrides for the `<head>` meta (content pages supply these). */
interface PageMetaOpts {
  description?: string;
  /** Open Graph object type; defaults to "website". */
  ogType?: string;
  /** Ask search engines not to index this page. */
  noindex?: boolean;
}

/**
 * Site-wide `<head>` meta: Open Graph defaults (site.json ogpDefault) and
 * search-engine verification tags. Emitted on every page; `opts` overrides the
 * description and og:type for content pages.
 */
function siteHeadMeta(site: SiteConfig, opts?: PageMetaOpts): string {
  const tags: string[] = [
    `<meta property="og:site_name" content="${escapeXml(site.name)}">`,
    `<meta property="og:type" content="${escapeXml(opts?.ogType ?? "website")}">`,
  ];
  // Published but hidden from search: keep following links, just don't index.
  if (opts?.noindex) {
    tags.push(`<meta name="robots" content="noindex, follow">`);
  }
  const og = site.ogpDefault;
  const description = opts?.description ?? og?.description;
  if (description) {
    const desc = escapeXml(description);
    tags.push(`<meta name="description" content="${desc}">`);
    tags.push(`<meta property="og:description" content="${desc}">`);
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
  // Twitter uses a large image card when an OGP image is available, else a
  // plain summary. Pairs with the og:* tags above.
  tags.push(
    `<meta name="twitter:card" content="${og?.image ? "summary_large_image" : "summary"}">`,
  );
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
