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
  /**
   * Marks a container inside a section template where nested blocks go
   * (Shopify-style). Its value is a space-separated allow-list of block types;
   * empty = any block type the theme provides.
   */
  blocks: "data-blocks",
  /** Optional marker on a block template's root (symmetry with data-section). */
  block: "data-block",
  /**
   * Marks a layout block's root as a column container. The engine generates one
   * column per entry in the block instance's `columns`, each holding its own
   * child blocks, with widths from the instance's `ratio` field.
   */
  columns: "data-columns",
  /**
   * Choices for a `select` field, as a comma- or `|`-separated list
   * (e.g. `data-options="S,M,L"`). A `<select>` element's `<option>` children
   * are read instead when this attribute is absent.
   */
  options: "data-options",
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
  ATTR.blocks,
  ATTR.block,
  ATTR.columns,
  ATTR.options,
];
