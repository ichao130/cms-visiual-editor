import { ATTR } from "./attributes.js";

/**
 * Rename a section part: on the first `<section>` element, set its
 * `data-section` id to `newId`, and update its `data-label` to `newId` only when
 * the label is still the default (equal to `oldId`) — a custom label is kept.
 *
 * Operates on the raw opening tag so the rest of the HTML (formatting, children)
 * is preserved. Used when a theme part file is renamed so its contents stay
 * consistent with the new name.
 */
export function renameSection(html: string, oldId: string, newId: string): string {
  return html.replace(/<section\b[^>]*>/i, (tag) => {
    let out = setAttr(tag, ATTR.section, newId);
    const label = getAttr(tag, ATTR.label);
    if (label === oldId) out = setAttr(out, ATTR.label, newId);
    return out;
  });
}

function getAttr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}=("|')(.*?)\\1`, "i").exec(tag);
  return m ? (m[2] ?? "") : null;
}

function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\b${name}=)("|')(.*?)\\2`, "i");
  if (re.test(tag)) return tag.replace(re, `$1$2${value}$2`);
  // Attribute absent: add it just before the closing ">".
  return tag.replace(/\s*>$/, ` ${name}="${value}">`);
}
