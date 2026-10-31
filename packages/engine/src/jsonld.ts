import type { ContentItem, SiteConfig } from "@pcms/shared";

export interface Crumb {
  name: string;
  url: string;
}

function base(site: SiteConfig): string {
  return (site.baseUrl ?? "").replace(/\/+$/, "");
}

function absUrl(url: string, baseUrl: string): string {
  if (/^https?:/i.test(url)) return url;
  if (baseUrl === "") return url;
  return baseUrl + (url.startsWith("/") ? url : `/${url}`);
}

/** WebSite + Organization — included on every page. */
export function siteJsonLd(site: SiteConfig): object[] {
  const b = base(site);
  const website: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
  };
  const org: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
  };
  if (b) {
    website.url = b;
    org.url = b;
  }
  if (site.logo) org.logo = absUrl(site.logo, b);
  return [website, org];
}

/** Article structured data for a content item page. */
export function articleJsonLd(
  item: ContentItem,
  site: SiteConfig,
  url: string,
): object {
  const b = base(site);
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: String(item.fields.title ?? item.slug),
    url: absUrl(url, b),
  };
  if (item.fields.date != null) obj.datePublished = String(item.fields.date);
  const modified = item.fields.updated ?? item.fields.modified ?? item.fields.date;
  if (modified != null) obj.dateModified = String(modified);
  const image = item.fields.image;
  if (typeof image === "string" && image) obj.image = absUrl(image, b);
  // The URL this structured data describes (Google's recommended property).
  obj.mainEntityOfPage = { "@type": "WebPage", "@id": absUrl(url, b) };
  // Publisher: the site as an Organization, with its logo as an ImageObject
  // when one is set (required shape for the Article rich result).
  const publisher: Record<string, unknown> = { "@type": "Organization", name: site.name };
  if (site.logo) publisher.logo = { "@type": "ImageObject", url: absUrl(site.logo, b) };
  obj.publisher = publisher;
  // Author: a Person from the item's `author` field when present.
  const author = item.fields.author;
  if (typeof author === "string" && author.trim() !== "") {
    obj.author = { "@type": "Person", name: author.trim() };
  }
  return obj;
}

/** BreadcrumbList from a trail of crumbs. */
export function breadcrumbJsonLd(crumbs: Crumb[], site: SiteConfig): object {
  const b = base(site);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absUrl(c.url, b),
    })),
  };
}

/** Insert JSON-LD <script> tags into a page's <head> (or end of document). */
/** Add a `<style>` block to the document head (or prepend when there is none). */
export function injectHeadStyle(html: string, css: string): string {
  if (!css) return html;
  const tag = `<style>${css}</style>`;
  return html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : `${tag}${html}`;
}

/** Add site-level `<meta>` tags (OGP defaults, verification) to the head. */
export function injectHeadMeta(html: string, meta: string): string {
  if (!meta) return html;
  return html.includes("</head>") ? html.replace("</head>", `${meta}</head>`) : `${meta}${html}`;
}

function escapeTitle(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Set the page's `<title>`. Replaces the theme's existing title (the layout's
 * `<title data-field="site.name">` would otherwise repeat on every page), or
 * inserts one when the document has none.
 */
export function injectHeadTitle(html: string, title: string): string {
  if (!title) return html;
  const tag = `<title>${escapeTitle(title)}</title>`;
  const existing = /<title\b[^>]*>[\s\S]*?<\/title>/i;
  if (existing.test(html)) return html.replace(existing, tag);
  if (html.includes("</head>")) return html.replace("</head>", `${tag}</head>`);
  return `${tag}${html}`;
}

/**
 * Ensure the document's `<html>` element carries a `lang` attribute. When the
 * tag already has a `lang`, it is replaced with `lang`; when it has none, one is
 * added. A document with no `<html>` tag is returned unchanged (the renderer
 * always produces one, but imported fragments may not). Keeps `lang` correct
 * for screen readers and search engines regardless of what the theme wrote.
 */
export function injectHtmlLang(html: string, lang: string): string {
  if (!lang) return html;
  const safe = lang.replace(/"/g, "");
  return html.replace(/<html\b([^>]*)>/i, (_m, attrs: string) => {
    const without = attrs.replace(/\s+lang\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "");
    return `<html${without} lang="${safe}">`;
  });
}

export function injectJsonLd(html: string, objects: object[]): string {
  if (objects.length === 0) return html;
  const scripts = objects
    .map(
      (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`,
    )
    .join("\n");
  return html.includes("</head>")
    ? html.replace("</head>", `${scripts}</head>`)
    : `${html}${scripts}`;
}
