import type {
  BlockInstance,
  FieldValue,
  PageSettings,
  RegionName,
  SectionInstance,
  SectionState,
  SectionStyle,
  SiteSettings,
  ThemeConfig,
} from "@pcms/shared";

/** Read a page's settings, or an empty object when the page has none yet. */
export function getPage(settings: SiteSettings, pageId: string): PageSettings {
  return settings.pages[pageId] ?? {};
}

function withPage(
  settings: SiteSettings,
  pageId: string,
  update: (page: PageSettings) => PageSettings,
): SiteSettings {
  const page = getPage(settings, pageId);
  return {
    ...settings,
    pages: { ...settings.pages, [pageId]: update(page) },
  };
}

export function setField(
  settings: SiteSettings,
  pageId: string,
  path: string,
  value: FieldValue,
): SiteSettings {
  return withPage(settings, pageId, (page) => ({
    ...page,
    fields: { ...page.fields, [path]: value },
  }));
}

function withSection(
  page: PageSettings,
  id: string,
  update: (s: SectionState) => SectionState,
): SectionState[] {
  const sections = page.sections ?? [];
  const existing = sections.find((s) => s.id === id);
  if (!existing) return [...sections, update({ id })];
  return sections.map((s) => (s.id === id ? update(s) : s));
}

export function toggleSectionHidden(
  settings: SiteSettings,
  pageId: string,
  id: string,
): SiteSettings {
  return withPage(settings, pageId, (page) => ({
    ...page,
    sections: withSection(page, id, (s) => ({ ...s, hidden: !s.hidden })),
  }));
}

export function setSectionOrder(
  settings: SiteSettings,
  pageId: string,
  order: string[],
): SiteSettings {
  return withPage(settings, pageId, (page) => ({ ...page, sectionOrder: order }));
}

export function setRepeatRows(
  settings: SiteSettings,
  pageId: string,
  sectionId: string,
  name: string,
  rows: Array<Record<string, FieldValue>>,
): SiteSettings {
  return withPage(settings, pageId, (page) => ({
    ...page,
    sections: withSection(page, sectionId, (s) => ({
      ...s,
      repeats: { ...s.repeats, [name]: rows },
    })),
  }));
}

// --- Composed-page section instances ---------------------------------------

function withInstances(
  settings: SiteSettings,
  pageId: string,
  update: (list: SectionInstance[]) => SectionInstance[],
): SiteSettings {
  return withPage(settings, pageId, (page) => ({
    ...page,
    instances: update(page.instances ?? []),
  }));
}

export function newInstanceId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

export function addInstance(
  settings: SiteSettings,
  pageId: string,
  type: string,
  at?: number,
): SiteSettings {
  const instance: SectionInstance = { id: newInstanceId(type), type };
  return withInstances(settings, pageId, (list) => {
    const next = [...list];
    next.splice(at ?? next.length, 0, instance);
    return next;
  });
}

export function removeInstance(
  settings: SiteSettings,
  pageId: string,
  id: string,
): SiteSettings {
  return withInstances(settings, pageId, (list) => list.filter((i) => i.id !== id));
}

/** Insert a fresh instance from a copied snapshot (new id, deep-copied data). */
export function pasteInstance(
  settings: SiteSettings,
  pageId: string,
  snapshot: SectionInstance,
  at?: number,
): SiteSettings {
  const instance: SectionInstance = {
    ...snapshot,
    id: newInstanceId(snapshot.type),
    fields: snapshot.fields ? { ...snapshot.fields } : undefined,
    repeats: snapshot.repeats
      ? (JSON.parse(JSON.stringify(snapshot.repeats)) as SectionInstance["repeats"])
      : undefined,
    style: snapshot.style ? { ...snapshot.style } : undefined,
  };
  return withInstances(settings, pageId, (list) => {
    const next = [...list];
    next.splice(at ?? next.length, 0, instance);
    return next;
  });
}

/** Duplicate an instance, inserting the copy right after the original. */
export function duplicateInstance(
  settings: SiteSettings,
  pageId: string,
  id: string,
): SiteSettings {
  return withInstances(settings, pageId, (list) => {
    const idx = list.findIndex((i) => i.id === id);
    const src = list[idx];
    if (idx < 0 || !src) return list;
    const copy: SectionInstance = {
      ...src,
      id: newInstanceId(src.type),
      fields: src.fields ? { ...src.fields } : undefined,
      repeats: src.repeats
        ? (JSON.parse(JSON.stringify(src.repeats)) as SectionInstance["repeats"])
        : undefined,
    };
    const next = [...list];
    next.splice(idx + 1, 0, copy);
    return next;
  });
}

export function moveInstance(
  settings: SiteSettings,
  pageId: string,
  from: number,
  to: number,
): SiteSettings {
  return withInstances(settings, pageId, (list) => {
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved as SectionInstance);
    return next;
  });
}

function withInstance(
  settings: SiteSettings,
  pageId: string,
  id: string,
  update: (inst: SectionInstance) => SectionInstance,
): SiteSettings {
  return withInstances(settings, pageId, (list) =>
    list.map((inst) => (inst.id === id ? update(inst) : inst)),
  );
}

export function toggleInstanceHidden(
  settings: SiteSettings,
  pageId: string,
  id: string,
): SiteSettings {
  return withInstance(settings, pageId, id, (inst) => ({
    ...inst,
    hidden: !inst.hidden,
  }));
}

export function setInstanceField(
  settings: SiteSettings,
  pageId: string,
  id: string,
  path: string,
  value: FieldValue,
): SiteSettings {
  return withInstance(settings, pageId, id, (inst) => ({
    ...inst,
    fields: { ...inst.fields, [path]: value },
  }));
}

export function setInstanceRepeat(
  settings: SiteSettings,
  pageId: string,
  id: string,
  name: string,
  rows: Array<Record<string, FieldValue>>,
): SiteSettings {
  return withInstance(settings, pageId, id, (inst) => ({
    ...inst,
    repeats: { ...inst.repeats, [name]: rows },
  }));
}

export function setInstanceStyle(
  settings: SiteSettings,
  pageId: string,
  id: string,
  patch: Partial<SectionStyle>,
): SiteSettings {
  return withInstance(settings, pageId, id, (inst) => applyStylePatch(inst, patch));
}

/** Merge a style patch, dropping keys set back to empty (fall back to theme). */
function applyStylePatch(inst: SectionInstance, patch: Partial<SectionStyle>): SectionInstance {
  const style: SectionStyle = { ...inst.style, ...patch };
  for (const k of Object.keys(style) as (keyof SectionStyle)[]) {
    if (style[k] === "" || style[k] == null) delete style[k];
  }
  return { ...inst, style };
}

/** Deep-copy an instance under a fresh id (for duplicate / paste). */
function cloneInstance(src: SectionInstance): SectionInstance {
  return {
    ...src,
    id: newInstanceId(src.type),
    fields: src.fields ? { ...src.fields } : undefined,
    repeats: src.repeats
      ? (JSON.parse(JSON.stringify(src.repeats)) as SectionInstance["repeats"])
      : undefined,
    style: src.style ? { ...src.style } : undefined,
  };
}

// --- Site-wide header / footer regions --------------------------------------
// The regions reuse the exact composed-instance model as a page body; only the
// storage differs (settings.regions[region] instead of a page's instances), so
// one SiteSettings carries the body and the shared header/footer. CLAUDE.md:
// edit the header/footer once, applies to every page (Shopify-style).

function withRegion(
  settings: SiteSettings,
  region: RegionName,
  update: (list: SectionInstance[]) => SectionInstance[],
): SiteSettings {
  const regions = settings.regions ?? {};
  return {
    ...settings,
    regions: { ...regions, [region]: update(regions[region] ?? []) },
  };
}

function withRegionInstance(
  settings: SiteSettings,
  region: RegionName,
  id: string,
  update: (inst: SectionInstance) => SectionInstance,
): SiteSettings {
  return withRegion(settings, region, (list) =>
    list.map((inst) => (inst.id === id ? update(inst) : inst)),
  );
}

export function addRegionInstance(
  settings: SiteSettings,
  region: RegionName,
  type: string,
  at?: number,
): SiteSettings {
  const instance: SectionInstance = { id: newInstanceId(type), type };
  return withRegion(settings, region, (list) => {
    const next = [...list];
    next.splice(at ?? next.length, 0, instance);
    return next;
  });
}

export function removeRegionInstance(
  settings: SiteSettings,
  region: RegionName,
  id: string,
): SiteSettings {
  return withRegion(settings, region, (list) => list.filter((i) => i.id !== id));
}

export function moveRegionInstance(
  settings: SiteSettings,
  region: RegionName,
  from: number,
  to: number,
): SiteSettings {
  return withRegion(settings, region, (list) => {
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved as SectionInstance);
    return next;
  });
}

export function duplicateRegionInstance(
  settings: SiteSettings,
  region: RegionName,
  id: string,
): SiteSettings {
  return withRegion(settings, region, (list) => {
    const idx = list.findIndex((i) => i.id === id);
    const src = list[idx];
    if (idx < 0 || !src) return list;
    const next = [...list];
    next.splice(idx + 1, 0, cloneInstance(src));
    return next;
  });
}

export function pasteRegionInstance(
  settings: SiteSettings,
  region: RegionName,
  snapshot: SectionInstance,
  at?: number,
): SiteSettings {
  return withRegion(settings, region, (list) => {
    const next = [...list];
    next.splice(at ?? next.length, 0, cloneInstance(snapshot));
    return next;
  });
}

export function toggleRegionInstanceHidden(
  settings: SiteSettings,
  region: RegionName,
  id: string,
): SiteSettings {
  return withRegionInstance(settings, region, id, (inst) => ({ ...inst, hidden: !inst.hidden }));
}

export function setRegionInstanceField(
  settings: SiteSettings,
  region: RegionName,
  id: string,
  path: string,
  value: FieldValue,
): SiteSettings {
  return withRegionInstance(settings, region, id, (inst) => ({
    ...inst,
    fields: { ...inst.fields, [path]: value },
  }));
}

export function setRegionInstanceRepeat(
  settings: SiteSettings,
  region: RegionName,
  id: string,
  name: string,
  rows: Array<Record<string, FieldValue>>,
): SiteSettings {
  return withRegionInstance(settings, region, id, (inst) => ({
    ...inst,
    repeats: { ...inst.repeats, [name]: rows },
  }));
}

export function setRegionInstanceStyle(
  settings: SiteSettings,
  region: RegionName,
  id: string,
  patch: Partial<SectionStyle>,
): SiteSettings {
  return withRegionInstance(settings, region, id, (inst) => applyStylePatch(inst, patch));
}

// --- Nested blocks inside a section instance --------------------------------
// A block operation targets one section instance, which lives either in a page
// body or in a site-wide region. `InstanceLoc` names where, so one set of block
// mutations serves both (no body/region duplication). Blocks mirror the section
// instance model but carry only id/type/fields.

/** Where a section instance lives: a page body, or a site-wide region. */
export type InstanceLoc =
  | { kind: "body"; pageId: string }
  | { kind: "region"; region: RegionName };

function withInstanceAt(
  settings: SiteSettings,
  loc: InstanceLoc,
  sectionId: string,
  update: (inst: SectionInstance) => SectionInstance,
): SiteSettings {
  return loc.kind === "body"
    ? withInstance(settings, loc.pageId, sectionId, update)
    : withRegionInstance(settings, loc.region, sectionId, update);
}

function withBlocks(
  settings: SiteSettings,
  loc: InstanceLoc,
  sectionId: string,
  update: (blocks: BlockInstance[]) => BlockInstance[],
): SiteSettings {
  return withInstanceAt(settings, loc, sectionId, (inst) => ({
    ...inst,
    blocks: update(inst.blocks ?? []),
  }));
}

export function newBlockId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

export function addBlock(
  settings: SiteSettings,
  loc: InstanceLoc,
  sectionId: string,
  type: string,
  at?: number,
): SiteSettings {
  const block: BlockInstance = { id: newBlockId(type), type };
  return withBlocks(settings, loc, sectionId, (list) => {
    const next = [...list];
    next.splice(at ?? next.length, 0, block);
    return next;
  });
}

export function removeBlock(
  settings: SiteSettings,
  loc: InstanceLoc,
  sectionId: string,
  blockId: string,
): SiteSettings {
  return withBlocks(settings, loc, sectionId, (list) => list.filter((b) => b.id !== blockId));
}

export function moveBlock(
  settings: SiteSettings,
  loc: InstanceLoc,
  sectionId: string,
  from: number,
  to: number,
): SiteSettings {
  return withBlocks(settings, loc, sectionId, (list) => {
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved as BlockInstance);
    return next;
  });
}

export function duplicateBlock(
  settings: SiteSettings,
  loc: InstanceLoc,
  sectionId: string,
  blockId: string,
): SiteSettings {
  return withBlocks(settings, loc, sectionId, (list) => {
    const idx = list.findIndex((b) => b.id === blockId);
    const src = list[idx];
    if (idx < 0 || !src) return list;
    const copy: BlockInstance = {
      ...src,
      id: newBlockId(src.type),
      fields: src.fields ? { ...src.fields } : undefined,
    };
    const next = [...list];
    next.splice(idx + 1, 0, copy);
    return next;
  });
}

export function setBlockField(
  settings: SiteSettings,
  loc: InstanceLoc,
  sectionId: string,
  blockId: string,
  path: string,
  value: FieldValue,
): SiteSettings {
  return withBlocks(settings, loc, sectionId, (list) =>
    list.map((b) => (b.id === blockId ? { ...b, fields: { ...b.fields, [path]: value } } : b)),
  );
}

// --- Swap a placed section or block to a different part (type) ---------------
// Changing an instance's `type` re-renders it with another theme part, in place.
// Values are carried over where they still fit: a field is kept when the new
// type declares a field with the same path, a repeat group when the new type
// declares it, and nested blocks when the new section still accepts that block
// type. Everything else is dropped — the new part has no place for it. The
// instance id (so its position and selection) stays the same, and the change is
// reversible via undo. The renderer tolerates missing/unknown fields, so no
// engine change is needed.

/** What the new type can hold, so a swap keeps only values that still fit. */
export interface TypeChange {
  type: string;
  /** Field paths the new type declares; values at other paths are dropped. */
  fieldPaths: string[];
  /** Repeat group names the new type declares; others are dropped. */
  repeatNames?: string[];
  /**
   * Block types the new section accepts: null = the new type has no blocks slot
   * (drop all blocks), [] = any type (keep all), [..] = keep only these types.
   */
  blockTypes?: string[] | null;
}

/** Keep only the entries whose key is allowed; undefined when nothing remains. */
function keepByKey<T>(
  bag: Record<string, T> | undefined,
  allow: Set<string>,
): Record<string, T> | undefined {
  if (!bag) return undefined;
  const next: Record<string, T> = {};
  for (const [k, v] of Object.entries(bag)) if (allow.has(k)) next[k] = v;
  return Object.keys(next).length ? next : undefined;
}

/** Re-type one section instance, carrying over values that still fit. */
export function migrateInstanceType(inst: SectionInstance, change: TypeChange): SectionInstance {
  const fields = keepByKey(inst.fields, new Set(change.fieldPaths));
  const repeats = keepByKey(inst.repeats, new Set(change.repeatNames ?? []));
  let blocks: BlockInstance[] | undefined;
  if (change.blockTypes == null) blocks = undefined;
  else if (change.blockTypes.length === 0) blocks = inst.blocks;
  else {
    const allow = new Set(change.blockTypes);
    blocks = inst.blocks?.filter((b) => allow.has(b.type));
  }
  if (blocks && blocks.length === 0) blocks = undefined;
  const next: SectionInstance = { ...inst, type: change.type };
  if (fields) next.fields = fields;
  else delete next.fields;
  if (repeats) next.repeats = repeats;
  else delete next.repeats;
  if (blocks) next.blocks = blocks;
  else delete next.blocks;
  return next;
}

/** Re-type one nested block, carrying over fields that still fit. */
export function migrateBlockType(
  block: BlockInstance,
  type: string,
  fieldPaths: string[],
): BlockInstance {
  const fields = keepByKey(block.fields, new Set(fieldPaths));
  const next: BlockInstance = { ...block, type };
  if (fields) next.fields = fields;
  else delete next.fields;
  return next;
}

/** Swap a placed section (body or region) to a different section part. */
export function changeInstanceType(
  settings: SiteSettings,
  loc: InstanceLoc,
  sectionId: string,
  change: TypeChange,
): SiteSettings {
  return withInstanceAt(settings, loc, sectionId, (inst) => migrateInstanceType(inst, change));
}

/** Swap a placed nested block to a different block part. */
export function changeBlockType(
  settings: SiteSettings,
  loc: InstanceLoc,
  sectionId: string,
  blockId: string,
  type: string,
  fieldPaths: string[],
): SiteSettings {
  return withBlocks(settings, loc, sectionId, (list) =>
    list.map((b) => (b.id === blockId ? migrateBlockType(b, type, fieldPaths) : b)),
  );
}

// --- Theme-wide style overrides (colors / fonts / spacing) ------------------
// `settings.theme` holds only the operator's overrides (deltas); rendering
// merges them over the theme's own presets (theme.json). Setting a token to ""
// removes the override so that token falls back to the theme default.

/** Which token group an override belongs to. */
export type ThemeTokenGroup = "colors" | "fonts" | "spacing";

export function setThemeToken(
  settings: SiteSettings,
  group: ThemeTokenGroup,
  key: string,
  value: string,
): SiteSettings {
  const bag: Record<string, string> = { ...settings.theme?.[group] };
  if (value === "") delete bag[key];
  else bag[key] = value;
  const theme: ThemeConfig = { ...settings.theme, [group]: bag };
  return normalizeTheme(settings, theme);
}

/** Drop every operator override, reverting the whole site to the theme presets. */
export function clearThemeOverrides(settings: SiteSettings): SiteSettings {
  if (settings.theme == null) return settings;
  const next = { ...settings };
  delete next.theme;
  return next;
}

/** Keep only non-empty token groups; drop `theme` entirely when nothing is set. */
function normalizeTheme(settings: SiteSettings, theme: ThemeConfig): SiteSettings {
  const clean: ThemeConfig = {};
  if (theme.name) clean.name = theme.name;
  for (const g of ["colors", "fonts", "spacing"] as ThemeTokenGroup[]) {
    const bag = theme[g];
    if (bag && Object.keys(bag).length > 0) clean[g] = bag;
  }
  if (Object.keys(clean).length === 0) return clearThemeOverrides(settings);
  return { ...settings, theme: clean };
}
