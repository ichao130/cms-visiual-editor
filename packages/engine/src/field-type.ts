import type { HTMLElement } from "node-html-parser";
import type { InlineFieldType } from "@pcms/shared";
import { ATTR } from "./attributes.js";

const EXPLICIT: readonly InlineFieldType[] = [
  "text",
  "richtext",
  "image",
  "link",
  "color",
  "number",
  "select",
];

/**
 * Determine the editable type of a `data-field` element.
 *
 * `data-type` wins when present; otherwise it is inferred from the tag
 * (CLAUDE.md: h1〜p=text, img=image, a=link, a div with child elements=richtext).
 */
export function detectFieldType(el: HTMLElement): InlineFieldType {
  const explicit = el.getAttribute(ATTR.type);
  if (explicit && (EXPLICIT as readonly string[]).includes(explicit)) {
    return explicit as InlineFieldType;
  }

  const tag = el.tagName?.toLowerCase() ?? "";
  if (tag === "img") return "image";
  if (tag === "a") return "link";
  if (/^h[1-6]$/.test(tag) || tag === "p" || tag === "span") return "text";

  const hasChildElements = el.childNodes.some(
    (n) => (n as HTMLElement).tagName != null,
  );
  if (hasChildElements) return "richtext";

  return "text";
}

/**
 * The choices offered by a `select` field, or undefined when none are declared.
 * Read from `data-options` (comma- or `|`-separated) first, else from the
 * `<option>` children of a `<select>` element (their value, else their text).
 */
export function fieldOptions(el: HTMLElement): string[] | undefined {
  const attr = el.getAttribute(ATTR.options);
  if (attr != null) {
    const list = attr
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return list.length > 0 ? list : undefined;
  }
  if ((el.tagName?.toLowerCase() ?? "") === "select") {
    const list = el
      .querySelectorAll("option")
      .map((o) => (o.getAttribute("value") ?? o.text ?? "").trim())
      .filter((s) => s.length > 0);
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}
