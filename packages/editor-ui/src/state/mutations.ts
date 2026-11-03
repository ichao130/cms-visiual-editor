import type {
  FieldValue,
  PageSettings,
  RegionName,
  SectionInstance,
  SectionState,
  SectionStyle,
  SiteSettings,
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
