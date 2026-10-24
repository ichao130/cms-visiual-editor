import { parseTemplate, renderTemplate, type RenderScope } from "@pcms/engine";
import type {
  ContentItem,
  SiteConfig,
  SiteSettings,
  ThemeTemplateSchema,
} from "@pcms/shared";
import type { ProjectData } from "../api/types.js";

function templateNameFor(project: ProjectData, settings: SiteSettings, pageId: string): string {
  const page = settings.pages[pageId];
  return page?.template ?? pageId;
}

function templateFor(project: ProjectData, settings: SiteSettings, pageId: string): string {
  const name = templateNameFor(project, settings, pageId);
  return project.theme.templates[name] ?? project.theme.templates.page ?? "";
}

/** Editable schema for the page currently open in the editor. */
export function schemaFor(
  project: ProjectData,
  settings: SiteSettings,
  pageId: string,
): ThemeTemplateSchema {
  const name = templateNameFor(project, settings, pageId);
  return parseTemplate(name, templateFor(project, settings, pageId));
}

function itemUrl(item: ContentItem, site: SiteConfig): string {
  const pattern = site.permalink ?? "/:type/:slug/";
  const rel = pattern.replace(/:type/g, item.type).replace(/:slug/g, item.slug);
  return "/" + rel.replace(/^\/+|\/+$/g, "") + "/";
}

function buildCollections(project: ProjectData): Record<string, ContentItem[]> {
  const byType: Record<string, ContentItem[]> = {};
  for (const item of project.content) {
    const withUrl: ContentItem = {
      ...item,
      fields: { ...item.fields, url: itemUrl(item, project.site) },
    };
    (byType[item.type] ??= []).push(withUrl);
  }
  const collections: Record<string, ContentItem[]> = {};
  for (const [type, items] of Object.entries(byType)) {
    collections[type] = items;
    collections[`${type}s`] = items;
  }
  return collections;
}

/**
 * Render the current page to a full HTML document for the live preview.
 *
 * CSS is inlined so the sandboxed iframe (which cannot load `/assets/...`)
 * still shows the theme's styling. The iframe itself is script-free, so the
 * theme HTML is treated as untrusted content (CLAUDE.md セキュリティ).
 */
export function renderPreview(
  project: ProjectData,
  settings: SiteSettings,
  pageId: string,
): string {
  const page = settings.pages[pageId] ?? {};
  const scope: RenderScope = {
    site: project.site,
    theme: settings.theme ?? project.theme.config,
    page,
    menus: project.menus,
    collections: buildCollections(project),
  };
  const html = renderTemplate(templateFor(project, settings, pageId), scope, {
    layout: project.theme.layout,
  });
  const style = `<style>\n${project.previewCss}\n</style>`;
  return html.includes("</head>")
    ? html.replace("</head>", `${style}</head>`)
    : `${style}${html}`;
}
