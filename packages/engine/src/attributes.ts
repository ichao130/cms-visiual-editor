/**
 * The `data-*` vocabulary that defines a pcms theme (see CLAUDE.md テーマ仕様).
 * A theme is "ordinary HTML + these attributes", so the engine only ever reads
 * them — it never requires them.
 */

export const ATTR = {
  section: "data-section",
  field: "data-field",
  type: "data-type",
  label: "data-label",
  loop: "data-loop",
  limit: "data-limit",
  repeat: "data-repeat",
  if: "data-if",
  slot: "data-slot",
} as const;

/**
 * Editor-only attributes that must be stripped from generated HTML so the
 * published output is clean markup.
 */
export const EDITOR_ATTRS: readonly string[] = [
  ATTR.section,
  ATTR.field,
  ATTR.type,
  ATTR.label,
  ATTR.loop,
  ATTR.limit,
  ATTR.repeat,
  ATTR.if,
  ATTR.slot,
];
