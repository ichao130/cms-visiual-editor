import {
  parseTemplate,
  renderComposedPage,
  renderTemplate,
  type RenderScope,
} from "@pcms/engine";
import type {
  ContentItem,
  MediaItem,
  SiteConfig,
  ThemeTemplateSchema,
} from "@pcms/shared";
import type { ProjectData } from "../api/types.js";
import {
  findItem,
  type EditorState,
  type EditorTarget,
} from "../state/editorState.js";
import { EDITOR_OVERLAY_CSS, EDITOR_RUNTIME } from "./editorRuntime.js";

function itemUrl(item: ContentItem, site: SiteConfig): string {
  const pattern = site.permalink ?? "/:type/:slug/";
  const rel = pattern.replace(/:type/g, item.type).replace(/:slug/g, item.slug);
  return "/" + rel.replace(/^\/+|\/+$/g, "") + "/";
}

function buildCollections(
  content: ContentItem[],
  site: SiteConfig,
): Record<string, ContentItem[]> {
  const byType: Record<string, ContentItem[]> = {};
  for (const item of content) {
    const prepared: ContentItem = {
      ...item,
      fields: { ...item.fields, url: itemUrl(item, site) },
      bodyHtml: item.body,
    };
    (byType[item.type] ??= []).push(prepared);
  }
  const collections: Record<string, ContentItem[]> = {};
  for (const [type, items] of Object.entries(byType)) {
    collections[type] = items;
    collections[`${type}s`] = items;
  }
  return collections;
}

function pageTemplateName(project: ProjectData, pageId: string): string {
  const page = project.settings.pages[pageId];
  return page?.template ?? pageId;
}

function templateHtml(project: ProjectData, name: string): string {
  return project.theme.templates[name] ?? project.theme.templates.page ?? "";
}

function contentTemplateName(project: ProjectData, type: string): string {
  if (project.theme.templates[type]) return type;
  if (project.theme.templates.post) return "post";
  return "page";
}

/** Editable section schema — only meaningful for page targets. */
export function schemaForPage(
  project: ProjectData,
  pageId: string,
): ThemeTemplateSchema {
  const name = pageTemplateName(project, pageId);
  return parseTemplate(name, templateHtml(project, name));
}

/**
 * Render the current target to a full HTML document for the live preview.
 * CSS is inlined so the sandboxed, script-free iframe shows theme styling.
 */
export function renderPreview(
  project: ProjectData,
  state: EditorState,
  target: EditorTarget,
  media: MediaItem[] = [],
): string {
  const site = project.site;
  const theme = state.settings.theme ?? project.theme.config;
  const collections = buildCollections(state.content, site);
  const base = { site, theme, menus: state.menus, collections };

  let html: string;
  if (target.kind === "page") {
    const page = state.settings.pages[target.id] ?? {};
    if (page.instances && page.instances.length > 0) {
      html = renderComposedPage(
        page.instances,
        project.theme.sections ?? {},
        base,
        { layout: project.theme.layout, markEditable: true },
      );
    } else {
      const scope: RenderScope = { ...base, page };
      const name = pageTemplateName(project, target.id);
      html = renderTemplate(templateHtml(project, name), scope, {
        layout: project.theme.layout,
        markEditable: true,
      });
    }
  } else {
    const item = findItem(state, target.type, target.slug);
    const prepared: ContentItem | undefined = item && {
      ...item,
      fields: { ...item.fields, url: itemUrl(item, site) },
      bodyHtml: item.body,
    };
    const scope: RenderScope = {
      ...base,
      page: state.settings.pages[target.type] ?? {},
      item: prepared,
    };
    const name = contentTemplateName(project, target.type);
    html = renderTemplate(templateHtml(project, name), scope, {
      layout: project.theme.layout,
      markEditable: true,
    });
  }

  // Remove any theme scripts (untrusted) before adding our trusted runtime.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  const head = `<style>\n${project.previewCss}\n</style><style>${EDITOR_OVERLAY_CSS}</style>`;
  html = html.includes("</head>") ? html.replace("</head>", `${head}</head>`) : `${head}${html}`;

  const runtime = `<script>${EDITOR_RUNTIME}</script>`;
  html = html.includes("</body>") ? html.replace("</body>", `${runtime}</body>`) : `${html}${runtime}`;

  // The sandboxed iframe can't load site-relative `media/...` paths, so swap
  // media references to their data URLs for display.
  return inlineMedia(html, media);
}

/**
 * Render a site's home page to a full, static HTML document for a thumbnail —
 * theme CSS only, no editor overlay or runtime script (so it's clean and inert
 * for a sandboxed, non-interactive preview in the site list).
 */
export function renderHomeThumbnail(
  project: ProjectData,
  media: MediaItem[] = [],
): string {
  const site = project.site;
  const theme = project.settings.theme ?? project.theme.config;
  const collections = buildCollections(project.content, site);
  const base = { site, theme, menus: project.menus, collections };
  const page = project.settings.pages.index ?? {};

  let html: string;
  if (page.instances && page.instances.length > 0) {
    html = renderComposedPage(page.instances, project.theme.sections ?? {}, base, {
      layout: project.theme.layout,
    });
  } else {
    const scope: RenderScope = { ...base, page };
    const name = pageTemplateName(project, "index");
    html = renderTemplate(templateHtml(project, name), scope, {
      layout: project.theme.layout,
    });
  }

  // Strip any theme scripts; the thumbnail iframe is sandboxed with no scripts.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const head = `<style>\n${project.previewCss}\n</style>`;
  html = html.includes("</head>") ? html.replace("</head>", `${head}</head>`) : `${head}${html}`;
  return inlineMedia(html, media);
}

/**
 * Render one content item to a full, static HTML document showing how its
 * published page will look — theme CSS and media inlined, scripts stripped, and
 * NO editor overlay or runtime (unlike renderPreview). Used by the content
 * editor's「プレビュー」so the operator sees the real page, draft included.
 */
export function renderItemPreview(
  project: ProjectData,
  state: EditorState,
  type: string,
  slug: string,
  media: MediaItem[] = [],
): string {
  const site = project.site;
  const theme = state.settings.theme ?? project.theme.config;
  const collections = buildCollections(state.content, site);
  const base = { site, theme, menus: state.menus, collections };
  const item = findItem(state, type, slug);
  const prepared: ContentItem | undefined = item && {
    ...item,
    fields: { ...item.fields, url: itemUrl(item, site) },
    bodyHtml: item.body,
  };
  const scope: RenderScope = {
    ...base,
    page: state.settings.pages[type] ?? {},
    item: prepared,
  };
  const name = contentTemplateName(project, type);
  let html = renderTemplate(templateHtml(project, name), scope, {
    layout: project.theme.layout,
  });
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const head = `<style>\n${project.previewCss}\n</style>`;
  html = html.includes("</head>") ? html.replace("</head>", `${head}</head>`) : `${head}${html}`;
  return inlineMedia(html, media);
}

function inlineMedia(html: string, media: MediaItem[]): string {
  let out = html;
  for (const m of media) {
    if (!m.dataUrl) continue;
    out = out.split(`"${m.path}"`).join(`"${m.dataUrl}"`);
    out = out.split(`"/${m.path}"`).join(`"${m.dataUrl}"`);
  }
  return out;
}
