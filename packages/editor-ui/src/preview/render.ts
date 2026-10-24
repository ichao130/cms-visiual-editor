import { parseTemplate, renderTemplate, type RenderScope } from "@pcms/engine";
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
  state: EditorState,
  site: SiteConfig,
): Record<string, ContentItem[]> {
  const byType: Record<string, ContentItem[]> = {};
  for (const item of state.content) {
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
  const collections = buildCollections(state, site);
  const base = { site, theme, menus: state.menus, collections };

  let html: string;
  if (target.kind === "page") {
    const scope: RenderScope = {
      ...base,
      page: state.settings.pages[target.id] ?? {},
    };
    const name = pageTemplateName(project, target.id);
    html = renderTemplate(templateHtml(project, name), scope, {
      layout: project.theme.layout,
      markEditable: true,
    });
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

function inlineMedia(html: string, media: MediaItem[]): string {
  let out = html;
  for (const m of media) {
    if (!m.dataUrl) continue;
    out = out.split(`"${m.path}"`).join(`"${m.dataUrl}"`);
    out = out.split(`"/${m.path}"`).join(`"${m.dataUrl}"`);
  }
  return out;
}
