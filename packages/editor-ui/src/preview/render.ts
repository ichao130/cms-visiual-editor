import {
  autoLinkedAssets,
  mergeRegions,
  mergeThemeConfig,
  parseTemplate,
  renderComposedPage,
  renderTemplate,
  type RenderScope,
} from "@pcms/engine";
import type {
  ContentItem,
  MediaItem,
  SiteConfig,
  SiteRegions,
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
 * `<style>` blocks for the theme's auto-linked CSS assets (same selection the
 * engine makes for the published site), inlined because the sandboxed `srcdoc`
 * can't fetch `assets/…`. `style.css` is skipped — `previewCss` already carries
 * it — and the later `inlineThemeAssets` pass resolves any `url(…)` images.
 */
function themeExtraStyles(project: ProjectData): string {
  const texts = project.themeTextAssets ?? {};
  let out = "";
  for (const path of autoLinkedAssets(project.theme.assets).css) {
    if (path === "assets/style.css") continue;
    const text = texts[path];
    if (text != null) out += `\n<style data-pcms-asset="${path}">\n${text}\n</style>`;
  }
  return out;
}

/**
 * One `<script>` with the theme's auto-linked JS concatenated. Only the theme's
 * own registered scripts run (CLAUDE.md: the operator's deliberate theme JS is
 * trusted); scripts that appear inside section HTML are stripped as untrusted.
 * Runs only in the live preview, which is sandboxed with `allow-scripts` but no
 * same-origin access, so it stays isolated from the app.
 */
function themeExtraScript(project: ProjectData): string {
  const texts = project.themeTextAssets ?? {};
  const parts: string[] = [];
  for (const path of autoLinkedAssets(project.theme.assets).js) {
    const text = texts[path];
    if (text != null) parts.push(`/* ${path} */\n${text}`);
  }
  return parts.length ? `<script data-pcms-asset>\n${parts.join("\n;\n")}\n</script>` : "";
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
  const theme = mergeThemeConfig(project.theme.config, state.settings.theme);
  const collections = buildCollections(state.content, site);
  const base = { site, theme, menus: state.menus, collections };

  // Header/footer regions are composed into the layout on every target (same
  // look as the published site, and editable in preview). A page with its own
  // override uses that header/footer; otherwise the site-wide regions apply —
  // the same per-page merge the generator does, so preview matches output.
  const layoutOptsFor = (page: { regions?: SiteRegions }) => ({
    layout: project.theme.layout,
    markEditable: true,
    regions: mergeRegions(state.settings.regions, page.regions),
    sections: project.theme.sections,
    blocks: project.theme.blocks,
  });

  let html: string;
  if (target.kind === "page") {
    const page = state.settings.pages[target.id] ?? {};
    const layoutOpts = layoutOptsFor(page);
    if (page.instances && page.instances.length > 0) {
      html = renderComposedPage(page.instances, project.theme.sections ?? {}, base, layoutOpts);
    } else {
      const scope: RenderScope = { ...base, page };
      const name = pageTemplateName(project, target.id);
      html = renderTemplate(templateHtml(project, name), scope, layoutOpts);
    }
  } else {
    const item = findItem(state, target.type, target.slug);
    const prepared: ContentItem | undefined = item && {
      ...item,
      fields: { ...item.fields, url: itemUrl(item, site) },
      bodyHtml: item.body,
    };
    const page = state.settings.pages[target.type] ?? {};
    const scope: RenderScope = { ...base, page, item: prepared };
    const name = contentTemplateName(project, target.type);
    html = renderTemplate(templateHtml(project, name), scope, layoutOptsFor(page));
  }

  // Remove any theme scripts (untrusted) before adding our trusted runtime.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // Theme CSS goes at the START of <head> so the theme-token `:root` block the
  // engine appends to the END of <head> (settings.theme overrides) wins over it.
  // The editor overlay goes last.
  const themeCss = `<style>\n${project.previewCss}\n</style>${themeExtraStyles(project)}`;
  const overlay = `<style>${EDITOR_OVERLAY_CSS}</style>`;
  html = html.includes("<head>") ? html.replace("<head>", `<head>${themeCss}`) : `${themeCss}${html}`;
  html = html.includes("</head>") ? html.replace("</head>", `${overlay}</head>`) : `${html}${overlay}`;

  const runtime = `<script>${EDITOR_RUNTIME}</script>`;
  // The editor runtime first, then the theme's own (trusted) asset scripts.
  const themeJs = themeExtraScript(project);
  html = html.includes("</body>")
    ? html.replace("</body>", `${runtime}${themeJs}</body>`)
    : `${html}${runtime}${themeJs}`;

  // The sandboxed iframe can't load site-relative `media/...` paths, so swap
  // media references to their data URLs for display.
  return inlineThemeAssets(inlineMedia(html, media), project.themeAssets ?? {});
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
  const theme = mergeThemeConfig(project.theme.config, project.settings.theme);
  const collections = buildCollections(project.content, site);
  const base = { site, theme, menus: project.menus, collections };
  const page = project.settings.pages.index ?? {};

  let html: string;
  if (page.instances && page.instances.length > 0) {
    html = renderComposedPage(page.instances, project.theme.sections ?? {}, base, {
      layout: project.theme.layout,
      blocks: project.theme.blocks,
    });
  } else {
    const scope: RenderScope = { ...base, page };
    const name = pageTemplateName(project, "index");
    html = renderTemplate(templateHtml(project, name), scope, {
      layout: project.theme.layout,
      blocks: project.theme.blocks,
    });
  }

  // Strip any theme scripts; the thumbnail iframe is sandboxed with no scripts.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  // Theme CSS at the start of <head> so the engine's theme-token :root (end of
  // <head>) overrides it.
  const head = `<style>\n${project.previewCss}\n</style>${themeExtraStyles(project)}`;
  html = html.includes("<head>") ? html.replace("<head>", `<head>${head}`) : `${head}${html}`;
  return inlineThemeAssets(inlineMedia(html, media), project.themeAssets ?? {});
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
  const theme = mergeThemeConfig(project.theme.config, state.settings.theme);
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
  const head = `<style>\n${project.previewCss}\n</style>${themeExtraStyles(project)}`;
  html = html.includes("<head>") ? html.replace("<head>", `<head>${head}`) : `${head}${html}`;
  return inlineThemeAssets(inlineMedia(html, media), project.themeAssets ?? {});
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

/**
 * The sandboxed `srcdoc` iframe can't load theme `assets/…` files, so swap
 * references to binary theme assets (images/fonts) for their data URLs. Covers
 * HTML attributes (`src="assets/bg.png"`) and CSS `url(…)` (including the
 * stylesheet-relative `url(bg.png)` form, since style.css ships under assets/).
 */
function inlineThemeAssets(html: string, assets: Record<string, string>): string {
  const entries = Object.entries(assets);
  if (entries.length === 0) return html;
  const byRef = new Map<string, string>();
  for (const [path, url] of entries) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    for (const key of [path, `/${path}`, name, `./${name}`]) byRef.set(key, url);
  }
  let out = html;
  // HTML attributes.
  for (const [path, url] of entries) {
    out = out.split(`"${path}"`).join(`"${url}"`);
    out = out.split(`"/${path}"`).join(`"${url}"`);
  }
  // CSS url(...) references (quoted or bare).
  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, quote: string, ref: string) => {
    const url = byRef.get(ref.trim());
    return url ? `url(${quote}${url}${quote})` : m;
  });
  return out;
}
