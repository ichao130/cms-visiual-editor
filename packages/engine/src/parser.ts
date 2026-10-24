import { parse, type HTMLElement } from "node-html-parser";
import type {
  FieldSchema,
  LoopSchema,
  RepeatSchema,
  SectionSchema,
  ThemeTemplateSchema,
} from "@pcms/shared";
import { ATTR } from "./attributes.js";
import { detectFieldType } from "./field-type.js";

/**
 * Parse a theme template (ordinary HTML + data-* attributes) into a schema
 * describing what the editor can change: sections, their editable fields,
 * loops and operator-managed repeats.
 *
 * This is pure: it reads an HTML string and returns plain data. It does not
 * mutate anything and has no I/O, so it runs identically in Node and the browser.
 */
export function parseTemplate(name: string, html: string): ThemeTemplateSchema {
  const root = parse(html, { comment: false });

  const sectionEls = root.querySelectorAll(`[${ATTR.section}]`);

  // Fields/loops/repeats that live outside any explicit section are collected
  // into an implicit default section so nothing editable is lost.
  const sections: SectionSchema[] = [];
  const claimed = new Set<HTMLElement>();

  for (const el of sectionEls) {
    const id = el.getAttribute(ATTR.section) || "";
    sections.push(readSection(id, el.getAttribute(ATTR.label), el, claimed));
  }

  const orphanFields = collectFields(root, claimed);
  const orphanLoops = collectLoops(root, claimed);
  const orphanRepeats = collectRepeats(root, claimed);
  if (
    orphanFields.length ||
    orphanLoops.length ||
    orphanRepeats.length
  ) {
    sections.unshift({
      id: "_default",
      fields: orphanFields,
      loops: orphanLoops,
      repeats: orphanRepeats,
    });
  }

  return { name, sections };
}

function readSection(
  id: string,
  label: string | undefined,
  el: HTMLElement,
  claimed: Set<HTMLElement>,
): SectionSchema {
  const section: SectionSchema = {
    id,
    fields: collectFields(el, claimed),
    loops: collectLoops(el, claimed),
    repeats: collectRepeats(el, claimed),
  };
  if (label) section.label = label;
  return section;
}

function collectFields(
  scope: HTMLElement,
  claimed: Set<HTMLElement>,
): FieldSchema[] {
  const fields: FieldSchema[] = [];
  for (const el of scope.querySelectorAll(`[${ATTR.field}]`)) {
    if (isInsideRepeatOrLoop(el, scope) || claimed.has(el)) continue;
    claimed.add(el);
    const path = el.getAttribute(ATTR.field) || "";
    const schema: FieldSchema = { path, type: detectFieldType(el) };
    const label = el.getAttribute(ATTR.label);
    if (label) schema.label = label;
    fields.push(schema);
  }
  return fields;
}

function collectLoops(
  scope: HTMLElement,
  claimed: Set<HTMLElement>,
): LoopSchema[] {
  const loops: LoopSchema[] = [];
  for (const el of scope.querySelectorAll(`[${ATTR.loop}]`)) {
    if (claimed.has(el)) continue;
    claimed.add(el);
    const source = el.getAttribute(ATTR.loop) || "";
    const limitRaw = el.getAttribute(ATTR.limit);
    const loop: LoopSchema = { source };
    if (limitRaw && !Number.isNaN(Number(limitRaw))) loop.limit = Number(limitRaw);
    loops.push(loop);
  }
  return loops;
}

function collectRepeats(
  scope: HTMLElement,
  claimed: Set<HTMLElement>,
): RepeatSchema[] {
  const repeats: RepeatSchema[] = [];
  for (const el of scope.querySelectorAll(`[${ATTR.repeat}]`)) {
    if (claimed.has(el)) continue;
    claimed.add(el);
    const name = el.getAttribute(ATTR.repeat) || "";
    const inner = new Set<HTMLElement>();
    repeats.push({ name, fields: collectFields(el, inner) });
  }
  return repeats;
}

/**
 * A field nested inside a loop/repeat template is described by that
 * loop/repeat, not as a standalone section field.
 */
function isInsideRepeatOrLoop(el: HTMLElement, stopAt: HTMLElement): boolean {
  let parent = el.parentNode as HTMLElement | null;
  while (parent && parent !== stopAt) {
    if (
      parent.getAttribute?.(ATTR.loop) != null ||
      parent.getAttribute?.(ATTR.repeat) != null
    ) {
      return true;
    }
    parent = parent.parentNode as HTMLElement | null;
  }
  return false;
}
