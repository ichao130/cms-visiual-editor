import { parse, type HTMLElement, type Node } from "node-html-parser";
import type {
  ContentItem,
  FieldValue,
  MenuItem,
  RegionName,
  SectionInstance,
  SiteRegions,
} from "@pcms/shared";
import { ATTR, EDITOR_ATTRS } from "./attributes.js";
import { cssColor } from "./css.js";
import { detectFieldType } from "./field-type.js";
import { escapeHtml } from "./markdown.js";
import { themeStyleTag } from "./theme-style.js";
import {
  isEmpty,
  resolveField,
  type RenderScope,
} from "./context.js";

export interface RenderOptions {
  /** Optional layout.html whose `data-slot="content"` receives the template. */
  layout?: string;
  /**
   * Keep `data-pcms-section` / `data-pcms-field` markers on the template so the
   * live editor can map clicks to sections/fields. For preview only.
   */
  markEditable?: boolean;
  /**
   * Site-wide header / footer section instances. When the layout has a
   * `data-slot="header"` / `data-slot="footer"` and the matching region has
   * instances, they are composed from `sections` and placed in that slot;
   * otherwise the layout's own header/footer markup is left untouched.
   */
  regions?: SiteRegions;
  /** Theme sections (`sections/<type>`), needed to compose the regions. */
  sections?: Record<string, string>;
  /**
   * Theme block templates (`blocks/<type>`), used to render a section
   * instance's nested blocks into its `data-blocks` container.
   */
  blocks?: Record<string, string>;
}

/**
 * Render a theme template against a scope, producing clean HTML.
 *
 * Processing per element, in order: `data-if` (drop when empty) → `data-loop`
 * / `data-repeat` (expand) → hidden `data-section` (drop) → `data-field`
 * (bind value) → recurse → strip editor-only attributes.
 *
 * Pure and isomorphic: string in, string out, no I/O.
 */
export function renderTemplate(
  html: string,
  scope: RenderScope,
  options: RenderOptions = {},
): string {
  const fragScope = options.markEditable ? { ...scope, editable: true } : scope;
  const body = renderFragment(html, fragScope);

  if (options.layout == null) return body;
  return fillLayout(options.layout, body, scope, options);
}

/**
 * Fill a layout: drop `body` into the content slot, and compose any site-wide
 * header / footer regions into their `data-slot="header"` / `data-slot="footer"`
 * slots. A slot with no region instances (or absent from `options`) keeps the
 * layout's own markup, so themes without regions render exactly as before.
 * The whole layout is then processed so its own `data-field` / `data-loop`
 * bindings (logo, menu) resolve.
 */
function fillLayout(
  layout: string,
  body: string,
  scope: ComposedScope,
  options: RenderOptions,
): string {
  const editable = options.markEditable === true;
  const layoutRoot = parse(layout, { comment: false });
  const slots = layoutRoot.querySelectorAll(`[${ATTR.slot}]`);
  for (const slot of slots) {
    const kind = slot.getAttribute(ATTR.slot) ?? "";
    if (kind === "header" || kind === "footer") {
      const region = kind as RegionName;
      const instances = options.regions?.[region];
      // Region not managed for this site (older data / imported theme): keep the
      // layout's own header/footer markup untouched.
      if (instances === undefined) continue;
      const inner = renderInstances(instances, options.sections ?? {}, scope, {
        editable,
        region,
        blockTemplates: options.blocks,
        emptyLabel: editable
          ? `この${region === "header" ? "ヘッダー" : "フッター"}にはセクションがありません。<br>「＋」から追加できます。`
          : undefined,
      });
      slot.set_content(editable ? wrapRegion(region, inner) : inner);
    } else {
      // "content" (or an unnamed slot): the page body.
      slot.set_content(body);
    }
  }
  processTree(layoutRoot, { ...scope, page: {} } as RenderScope);
  // Emit the theme's style tokens (colors / fonts / spacing) as a `:root` block
  // at the end of <head>, after the theme's own stylesheet, so operator
  // overrides (settings.theme) win over the theme defaults. Themes without
  // tokens get nothing (their stylesheet's own :root applies).
  const styleTag = themeStyleTag(scope.theme);
  if (styleTag) {
    const head = layoutRoot.querySelector("head");
    if (head) head.insertAdjacentHTML("beforeend", styleTag);
  }
  return layoutRoot.toString();
}

/** Editor-only wrapper tagging a region so preview clicks resolve their group. */
function wrapRegion(region: RegionName | "body", inner: string): string {
  return `<div data-pcms-region="${region}">${inner}</div>`;
}

function renderFragment(html: string, scope: RenderScope): string {
  const root = parse(html, { comment: false });
  reorderSections(root, scope.page.sectionOrder);
  processTree(root, scope);
  return root.toString();
}

/** Scope for a composed page — like RenderScope but the page is per-instance. */
export type ComposedScope = Omit<RenderScope, "page" | "editable">;

/**
 * Render a composed page: each section instance is rendered from the theme's
 * `sections/<type>` with its own field/repeat values, wrapped in a container,
 * then placed in the layout slot. In editable mode each wrapper carries
 * `data-pcms-section="<instance id>"` so the editor can select it.
 */
export function renderComposedPage(
  instances: SectionInstance[],
  sections: Record<string, string>,
  scope: ComposedScope,
  options: RenderOptions = {},
): string {
  const editable = options.markEditable === true;
  const emptyLabel =
    "このページにはまだセクションがありません。<br>下の「＋」からセクションを追加できます。";
  const body = renderInstances(instances, sections, scope, {
    editable,
    blockTemplates: options.blocks,
    emptyLabel,
  });

  if (options.layout == null) {
    return editable ? wrapRegion("body", body) : body;
  }
  return fillLayout(options.layout, editable ? wrapRegion("body", body) : body, scope, options);
}

/** Options for composing a list of section instances. */
interface InstancesOptions {
  editable?: boolean;
  /** Which group these instances belong to — only used to label insert slots. */
  region?: RegionName | "body";
  /** Editor-only message shown when the list is empty. */
  emptyLabel?: string;
  /** Block templates (`blocks/<type>`), for sections that have nested blocks. */
  blockTemplates?: Record<string, string>;
}

/**
 * Compose an ordered list of section instances into HTML. Each instance is
 * rendered from `sections[type]` with its own field / repeat values, wrapped in
 * a `.pcms-section` container with its style overrides. In editable mode every
 * wrapper carries `data-pcms-section="<id>"` plus per-section tools, with "+"
 * insert markers between them, so the live editor can select / reorder / add.
 * Shared by the page body and the header / footer regions.
 */
function renderInstances(
  instances: SectionInstance[],
  sections: Record<string, string>,
  scope: ComposedScope,
  options: InstancesOptions = {},
): string {
  const editable = options.editable === true;
  const parts: string[] = [];
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i] as SectionInstance;
    // In the editor, hidden sections are still shown (dimmed) so indices line
    // up and they can be re-enabled. Published output omits them.
    if (inst.hidden && !editable) continue;
    const tpl = sections[inst.type];
    if (tpl == null) continue;
    const instScope: RenderScope = {
      ...scope,
      page: {
        fields: inst.fields,
        sections: inst.repeats ? [{ id: inst.id, repeats: inst.repeats }] : [],
      },
      editable: editable ? true : undefined,
      blocks: inst.blocks,
      blockTemplates: options.blockTemplates,
      blockSectionId: inst.id,
    };
    const inner = renderFragment(tpl, instScope);
    const styleAttr = sectionStyleAttr(inst.style);
    const deviceCls = deviceHideClass(inst.style);
    if (editable) {
      parts.push(insertMarker(i));
      const hiddenCls = inst.hidden ? " pcms-section--hidden" : "";
      parts.push(
        `<div class="pcms-section pcms-section--${inst.type}${hiddenCls}${deviceCls}"${styleAttr} data-pcms-section="${inst.id}">${sectionTools(inst.id)}${inner}</div>`,
      );
    } else {
      parts.push(
        `<div class="pcms-section pcms-section--${inst.type}${deviceCls}"${styleAttr}>${inner}</div>`,
      );
    }
  }
  if (editable && instances.length === 0 && options.emptyLabel) {
    parts.push(`<div class="pcms-empty-canvas">${options.emptyLabel}</div>`);
  }
  if (editable) parts.push(insertMarker(instances.length));
  return parts.join("\n");
}

/**
 * Reorder top-level `data-section` elements per the operator's order. Sections
 * absent from the list keep their template order after the listed ones.
 */
function reorderSections(root: HTMLElement, order: string[] | undefined): void {
  if (!order || order.length === 0) return;

  const sections = root.childNodes.filter(
    (n): n is HTMLElement =>
      isElement(n) && n.getAttribute(ATTR.section) != null,
  );
  if (sections.length < 2) return;

  const byId = new Map(sections.map((el) => [el.getAttribute(ATTR.section), el]));
  const seen = new Set<string>();
  const ordered: HTMLElement[] = [];
  for (const id of order) {
    const el = byId.get(id);
    if (el && !seen.has(id)) {
      ordered.push(el);
      seen.add(id);
    }
  }
  for (const el of sections) {
    const id = el.getAttribute(ATTR.section) ?? "";
    if (!seen.has(id)) ordered.push(el);
  }

  for (const el of sections) root.removeChild(el);
  for (const el of ordered) root.appendChild(el);
}

const PADDING_Y: Record<string, string> = {
  none: "0",
  sm: "1.5rem",
  md: "3rem",
  lg: "5rem",
};

/** Inline style attribute for a section's visual overrides (sanitized). */
function sectionStyleAttr(style: SectionInstance["style"]): string {
  if (!style) return "";
  const css: string[] = [];
  if (style.background) css.push(`background-color:${cssColor(style.background)}`);
  if (style.textColor) css.push(`color:${cssColor(style.textColor)}`);
  const pad = style.paddingY ? PADDING_Y[style.paddingY] : undefined;
  if (pad != null) css.push(`padding-top:${pad}`, `padding-bottom:${pad}`);
  return css.length > 0 ? ` style="${css.join(";")}"` : "";
}

/** Device-visibility class for a section ("" when shown on all devices). */
function deviceHideClass(style: SectionInstance["style"]): string {
  if (style?.hideOn === "mobile") return " pcms-hide-mobile";
  if (style?.hideOn === "desktop") return " pcms-hide-desktop";
  return "";
}

/**
 * Utility CSS for per-section device visibility, injected into the published
 * output (the editor shows these sections dimmed instead — see the preview CSS).
 * The 640px breakpoint matches the editor's mobile preview width.
 */
export const RESPONSIVE_CSS =
  "@media(max-width:640px){.pcms-hide-mobile{display:none!important}}" +
  "@media(min-width:641px){.pcms-hide-desktop{display:none!important}}" +
  // Keep width/height attributes (added for CLS) from distorting a responsive
  // image. `:where()` has zero specificity, so any theme rule still wins.
  "img:where([width][height]){height:auto}";

/** Editor-only "+" marker inserted at a gap between composed sections. */
function insertMarker(index: number): string {
  return `<div class="pcms-insert" data-pcms-insert="${index}"><button type="button" class="pcms-insert__btn" title="ここにセクションを追加">＋</button></div>`;
}

/** Editor-only per-section toolbar (drag handle + up/down/delete). */
function sectionTools(id: string): string {
  return (
    `<div class="pcms-sec-tools" contenteditable="false">` +
    `<span class="pcms-sec-handle" draggable="true" data-pcms-drag="${id}" title="ドラッグで並べ替え">⠿</span>` +
    `<button type="button" class="pcms-sec-op" data-pcms-op="up" data-pcms-id="${id}" title="上へ">↑</button>` +
    `<button type="button" class="pcms-sec-op" data-pcms-op="down" data-pcms-id="${id}" title="下へ">↓</button>` +
    `<button type="button" class="pcms-sec-op" data-pcms-op="dup" data-pcms-id="${id}" title="複製">⧉</button>` +
    `<button type="button" class="pcms-sec-op" data-pcms-op="del" data-pcms-id="${id}" title="削除">×</button>` +
    `</div>`
  );
}

/**
 * Fill a section's `data-blocks` container with the current instance's nested
 * blocks. Each block is rendered from `blocks/<type>` against its own fields.
 * Published output is clean (block fragments only); editable preview wraps each
 * block with `data-pcms-block` + tools and "+" insert markers so the editor can
 * select / reorder / add. The container's own template children are replaced.
 */
function expandBlocks(el: HTMLElement, scope: RenderScope): void {
  const blocks = scope.blocks ?? [];
  const templates = scope.blockTemplates ?? {};
  const editable = scope.editable === true;
  const sectionId = scope.blockSectionId ?? "";
  const parts: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b) continue;
    const tpl = templates[b.type];
    if (tpl == null) continue;
    // A block binds its own fields; it never inherits the section's blocks,
    // loop item, or repeats, so reset those on the child scope.
    const blockScope: RenderScope = {
      ...scope,
      page: { fields: b.fields },
      item: undefined,
      blocks: undefined,
      blockTemplates: undefined,
      blockSectionId: undefined,
    };
    const inner = renderFragment(tpl, blockScope);
    if (editable) {
      parts.push(blockInsertMarker(sectionId, i));
      parts.push(
        `<div class="pcms-block pcms-block--${b.type}" data-pcms-block="${b.id}" data-pcms-blocksection="${sectionId}">${blockTools(sectionId, b.id)}${inner}</div>`,
      );
    } else {
      parts.push(inner);
    }
  }
  if (editable) {
    if (blocks.length === 0) {
      parts.push(
        `<div class="pcms-empty-blocks">ブロックがありません。<br>「＋」から追加できます。</div>`,
      );
    }
    parts.push(blockInsertMarker(sectionId, blocks.length));
  }
  el.set_content(parts.join("\n"));
  // The container keeps its own tag/classes; drop the block markers from it.
  el.removeAttribute(ATTR.blocks);
  el.removeAttribute(ATTR.block);
}

/** Editor-only "+" marker inserted at a gap between nested blocks. */
function blockInsertMarker(sectionId: string, index: number): string {
  return `<div class="pcms-insert pcms-blockinsert" data-pcms-blockinsert="${index}" data-pcms-blocksection="${sectionId}"><button type="button" class="pcms-insert__btn" title="ここにブロックを追加">＋</button></div>`;
}

/** Editor-only per-block toolbar (drag handle + up/down/duplicate/delete). */
function blockTools(sectionId: string, id: string): string {
  return (
    `<div class="pcms-block-tools" contenteditable="false">` +
    `<span class="pcms-block-handle" draggable="true" data-pcms-blockdrag="${id}" data-pcms-blocksection="${sectionId}" title="ドラッグで並べ替え">⠿</span>` +
    `<button type="button" class="pcms-sec-op" data-pcms-blockop="up" data-pcms-blockid="${id}" data-pcms-blocksection="${sectionId}" title="上へ">↑</button>` +
    `<button type="button" class="pcms-sec-op" data-pcms-blockop="down" data-pcms-blockid="${id}" data-pcms-blocksection="${sectionId}" title="下へ">↓</button>` +
    `<button type="button" class="pcms-sec-op" data-pcms-blockop="dup" data-pcms-blockid="${id}" data-pcms-blocksection="${sectionId}" title="複製">⧉</button>` +
    `<button type="button" class="pcms-sec-op" data-pcms-blockop="del" data-pcms-blockid="${id}" data-pcms-blocksection="${sectionId}" title="削除">×</button>` +
    `</div>`
  );
}

function processTree(root: HTMLElement, scope: RenderScope): void {
  for (const child of [...root.childNodes]) {
    if (isElement(child)) processElement(child, scope);
  }
}

function processElement(el: HTMLElement, scope: RenderScope): void {
  // 1. data-if — drop the element when the value is empty (or, with a leading
  //    "!", when it is non-empty).
  const ifExpr = el.getAttribute(ATTR.if);
  if (ifExpr != null) {
    const negate = ifExpr.startsWith("!");
    const empty = isEmpty(resolveField(negate ? ifExpr.slice(1) : ifExpr, scope));
    if (negate ? !empty : empty) {
      el.remove();
      return;
    }
  }

  // 2. data-loop — repeat for each item in a collection/menu.
  if (el.getAttribute(ATTR.loop) != null) {
    expandLoop(el, scope);
    return;
  }

  // 3. data-repeat — repeat for each operator-added item.
  if (el.getAttribute(ATTR.repeat) != null) {
    expandRepeat(el, scope);
    return;
  }

  // 3.5 data-blocks — fill the container with the section instance's nested
  //     blocks (Shopify-style), then stop (children are the rendered blocks).
  if (el.getAttribute(ATTR.blocks) != null) {
    expandBlocks(el, scope);
    return;
  }

  // 4. hidden section — drop when the operator hid it.
  const sectionId = el.getAttribute(ATTR.section);
  if (sectionId != null && isSectionHidden(sectionId, scope)) {
    el.remove();
    return;
  }

  // 5. data-field — bind a value (keeps theme default when unset).
  const fieldPath = el.getAttribute(ATTR.field);
  let replacedContent = false;
  if (fieldPath != null) {
    replacedContent = applyField(el, scope);
  }

  // 6. recurse into children (skip when we replaced the content wholesale).
  if (!replacedContent) {
    for (const child of [...el.childNodes]) {
      if (isElement(child)) processElement(child, scope);
    }
  }

  // 7. In editable (preview) mode, leave markers the editor can click-map.
  if (scope.editable) {
    if (sectionId != null) el.setAttribute("data-pcms-section", sectionId);
    if (fieldPath != null) {
      el.setAttribute("data-pcms-field", fieldPath);
      // The field type lets inline editing read the right value (text vs HTML).
      el.setAttribute("data-pcms-fieldtype", detectFieldType(el));
    }
  }

  // 8. strip editor-only attributes from the published output.
  stripEditorAttrs(el);
}

/** Returns true when the element's content was replaced (don't recurse). */
function applyField(el: HTMLElement, scope: RenderScope): boolean {
  const path = el.getAttribute(ATTR.field) ?? "";
  const value = resolveField(path, scope);
  if (value === undefined) return false; // keep theme default content

  const type = detectFieldType(el);
  switch (type) {
    case "image": {
      const src = stringify(value);
      el.setAttribute("src", src);
      const record = scope.media?.[src];
      // Fill alt from the media record when the theme's <img> has none of its
      // own, so published images are not left without alternative text.
      const hasAlt = (el.getAttribute("alt") ?? "").trim() !== "";
      if (!hasAlt && record?.alt != null && record.alt !== "") {
        el.setAttribute("alt", record.alt);
      }
      // Supply intrinsic width/height from the media record (when the theme
      // gave neither) so the browser can reserve space before load — this is
      // the main defence against layout shift (CLS). A zero-specificity
      // `height:auto` rule (IMG_CSS) keeps responsive themes undistorted.
      if (el.getAttribute("width") == null && el.getAttribute("height") == null) {
        if (record?.width && record?.height) {
          el.setAttribute("width", String(record.width));
          el.setAttribute("height", String(record.height));
        }
      }
      // Performance hints, overridable by the theme: lazy-load and decode off
      // the main thread. A theme can set loading="eager" on an above-the-fold
      // image (e.g. the hero) to opt out.
      if (el.getAttribute("loading") == null) el.setAttribute("loading", "lazy");
      if (el.getAttribute("decoding") == null) el.setAttribute("decoding", "async");
      return false;
    }
    case "link":
      el.setAttribute("href", stringify(value));
      return false;
    case "richtext":
      el.set_content(stringify(value));
      return true;
    case "text":
    case "color":
    case "number":
    case "select":
    default:
      el.set_content(escapeHtml(stringify(value)));
      return true;
  }
}

function expandLoop(el: HTMLElement, scope: RenderScope): void {
  const source = el.getAttribute(ATTR.loop) ?? "";
  const limitRaw = el.getAttribute(ATTR.limit);
  const limit = limitRaw && !Number.isNaN(Number(limitRaw)) ? Number(limitRaw) : undefined;

  const items = loopItems(source, scope);
  const limited = limit != null ? items.slice(0, limit) : items;

  const htmls = limited.map((item) => {
    const clone = el.clone() as HTMLElement;
    clone.removeAttribute(ATTR.loop);
    clone.removeAttribute(ATTR.limit);
    const childScope: RenderScope = { ...scope, item, editable: false };
    processElement(clone, childScope);
    return clone.toString();
  });

  if (htmls.length) el.insertAdjacentHTML("afterend", htmls.join(""));
  el.remove();
}

function expandRepeat(el: HTMLElement, scope: RenderScope): void {
  const name = el.getAttribute(ATTR.repeat) ?? "";
  const rows = repeatRows(name, scope);

  const htmls = rows.map((row) => {
    const clone = el.clone() as HTMLElement;
    clone.removeAttribute(ATTR.repeat);
    // A repeat row binds against an ad-hoc item whose fields are the row.
    const item: ContentItem = { type: "item", slug: "", fields: row, body: "" };
    const childScope: RenderScope = { ...scope, item, editable: false };
    processElement(clone, childScope);
    return clone.toString();
  });

  if (htmls.length) el.insertAdjacentHTML("afterend", htmls.join(""));
  el.remove();
}

function loopItems(source: string, scope: RenderScope): ContentItem[] {
  if (scope.collections[source]) return scope.collections[source];
  const menu = scope.menus[source];
  if (menu) return menu.map(menuToItem);
  return [];
}

function menuToItem(mi: MenuItem): ContentItem {
  return {
    type: "menu",
    slug: "",
    fields: { label: mi.label, url: mi.url },
    body: "",
  };
}

function repeatRows(
  name: string,
  scope: RenderScope,
): Array<Record<string, FieldValue>> {
  const sections = scope.page.sections ?? [];
  for (const s of sections) {
    const rows = s.repeats?.[name];
    if (rows) return rows;
  }
  return [];
}

function isSectionHidden(id: string, scope: RenderScope): boolean {
  const sections = scope.page.sections ?? [];
  return sections.some((s) => s.id === id && s.hidden === true);
}

function stripEditorAttrs(el: HTMLElement): void {
  for (const attr of EDITOR_ATTRS) {
    if (el.getAttribute(attr) != null) el.removeAttribute(attr);
  }
}

function isElement(node: Node): node is HTMLElement {
  return (node as HTMLElement).tagName != null;
}

function stringify(value: FieldValue): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(stringify).join(", ");
  return String(value);
}
