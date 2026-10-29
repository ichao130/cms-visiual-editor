import { parse, type HTMLElement, type Node } from "node-html-parser";
import type {
  ContentItem,
  FieldValue,
  MenuItem,
  SectionInstance,
} from "@pcms/shared";
import { ATTR, EDITOR_ATTRS } from "./attributes.js";
import { detectFieldType } from "./field-type.js";
import { escapeHtml } from "./markdown.js";
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

  // The layout (header/footer) is not section-editable, so render it normally.
  const layoutRoot = parse(options.layout, { comment: false });
  const slot = layoutRoot.querySelector(`[${ATTR.slot}]`);
  if (slot) slot.set_content(body);
  processTree(layoutRoot, scope);
  return layoutRoot.toString();
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
  if (editable && instances.length === 0) {
    parts.push(
      `<div class="pcms-empty-canvas">このページにはまだセクションがありません。<br>下の「＋」からセクションを追加できます。</div>`,
    );
  }
  if (editable) parts.push(insertMarker(instances.length));
  const body = parts.join("\n");

  if (options.layout == null) return body;

  const layoutRoot = parse(options.layout, { comment: false });
  const slot = layoutRoot.querySelector(`[${ATTR.slot}]`);
  if (slot) slot.set_content(body);
  processTree(layoutRoot, { ...scope, page: {} } as RenderScope);
  return layoutRoot.toString();
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

/** Keep only characters valid in a CSS color so the value can't break out. */
function cssColor(value: string): string {
  return value.replace(/[^#a-zA-Z0-9(),.%\s-]/g, "").trim();
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
  "@media(min-width:641px){.pcms-hide-desktop{display:none!important}}";

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
      // Fill alt from the media record when the theme's <img> has none of its
      // own, so published images are not left without alternative text.
      const hasAlt = (el.getAttribute("alt") ?? "").trim() !== "";
      const alt = scope.media?.[src]?.alt;
      if (!hasAlt && alt != null && alt !== "") el.setAttribute("alt", alt);
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
