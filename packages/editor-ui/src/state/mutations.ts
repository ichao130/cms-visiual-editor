import type {
  FieldValue,
  PageSettings,
  SectionState,
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
