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
  const image = item.fields.image;
  if (typeof image === "string" && image) obj.image = absUrl(image, b);
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
