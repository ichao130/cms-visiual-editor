import type {
  ContentItem,
  ContentTypeDef,
  MenuItem,
  PageSettings,
  SiteConfig,
  SiteSettings,
  ThemeConfig,
} from "@pcms/shared";
import { renderTemplate } from "./renderer.js";
import type { RenderScope } from "./context.js";

/** A parsed theme ready to render (templates as strings, no I/O). */
export interface ThemeBundle {
  config: ThemeConfig;
  /** Shared layout.html, if the theme has one. */
  layout?: string;
  /** Template name (without extension) → HTML. */
  templates: Record<string, string>;
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
  const content = input.content.map((item) => ({
    ...item,
    fields: { ...item.fields, url: "/" + itemPath(item, input.site).replace(/index\.html$/, "") },
    bodyHtml: item.body,
  }));

  const collections = buildCollections(content);
  const menus = input.menus ?? {};

  const baseScope = {
    site: input.site,
    theme: input.settings.theme ?? input.theme.config,
    menus,
    collections,
  };

  // 1. Explicit pages from settings.json.
  for (const [id, page] of Object.entries(input.settings.pages)) {
    const templateName = page.template ?? id;
    const template = pickTemplate(input.theme, [templateName, "page"]);
    if (template == null) continue;
    const scope: RenderScope = { ...baseScope, page };
    const html = renderTemplate(template, scope, { layout: input.theme.layout });
    files[pagePathForId(id)] = html;
  }

  // 2. A page per content item.
  for (const item of content) {
    const template = pickTemplate(input.theme, [item.type, "post", "page"]);
    if (template == null) continue;
    const page: PageSettings = input.settings.pages[item.type] ?? {};
    const scope: RenderScope = { ...baseScope, page, item };
    const html = renderTemplate(template, scope, { layout: input.theme.layout });
    files[itemPath(item, input.site)] = html;
  }

  // 3. Always-on outputs.
  files["sitemap.xml"] = buildSitemap(files, input.site);
  files["robots.txt"] = buildRobots(input.site);
  files["feed.xml"] = buildFeed(content, input.site);
  if (!files["404.html"]) files["404.html"] = build404(input.site);

  return { files, assets: input.theme.assets ?? [] };
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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
