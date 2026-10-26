import type {
  ContentItem,
  ContentTypeDef,
  FieldDef,
  FieldValue,
  MenuItem,
  SiteConfig,
  SiteSettings,
  TaxonomyDef,
} from "@pcms/shared";
import type { ProjectData } from "../api/types.js";

/**
 * The full undoable document: site config, page settings, content items and
 * content-type definitions. Keeping them under one history gives a single
 * undo/redo stack.
 */
export interface EditorState {
  site: SiteConfig;
  settings: SiteSettings;
  content: ContentItem[];
  contentTypes: ContentTypeDef[];
  menus: Record<string, MenuItem[]>;
  taxonomies: TaxonomyDef[];
}

export function initialState(project: ProjectData): EditorState {
  return {
    site: project.site,
    settings: project.settings,
    content: project.content,
    contentTypes: project.contentTypes,
    menus: project.menus,
    taxonomies: project.taxonomies,
  };
}

/** Taxonomies that apply to a given content type. */
export function taxonomiesFor(state: EditorState, type: string): TaxonomyDef[] {
  return state.taxonomies.filter((tx) => tx.types.includes(type));
}

export function setTaxonomies(
  state: EditorState,
  taxonomies: TaxonomyDef[],
): EditorState {
  return { ...state, taxonomies };
}

/** Set the terms assigned to one content item for a taxonomy. */
export function setContentTerms(
  state: EditorState,
  type: string,
  slug: string,
  taxonomy: string,
  terms: string[],
): EditorState {
  const content = state.content.map((item) =>
    item.type === type && item.slug === slug
      ? { ...item, fields: { ...item.fields, [taxonomy]: terms } }
      : item,
  );
  return { ...state, content };
}

export function setMenu(
  state: EditorState,
  name: string,
  items: MenuItem[],
): EditorState {
  return { ...state, menus: { ...state.menus, [name]: items } };
}

export function typeDef(
  state: EditorState,
  name: string,
): ContentTypeDef | undefined {
  return state.contentTypes.find((t) => t.name === name);
}

// ---------------------------------------------------------------------------
// Editor targets — the switchable pages shown in the page selector.
// ---------------------------------------------------------------------------

export type EditorTarget =
  | { kind: "page"; id: string; label: string }
  | { kind: "content"; type: string; slug: string; label: string };

export function targetKey(t: EditorTarget): string {
  return t.kind === "page" ? `page:${t.id}` : `content:${t.type}/${t.slug}`;
}

function typeLabel(state: EditorState, type: string): string {
  return typeDef(state, type)?.label ?? type;
}

/** Build the list of switchable targets: site pages first, then content. */
export function listTargets(state: EditorState): EditorTarget[] {
  const targets: EditorTarget[] = [];

  for (const id of Object.keys(state.settings.pages)) {
    targets.push({ kind: "page", id, label: id === "index" ? "ホーム" : id });
  }

  for (const item of state.content) {
    const title = String(item.fields.title ?? item.slug);
    targets.push({
      kind: "content",
      type: item.type,
      slug: item.slug,
      label: `${typeLabel(state, item.type)}：${title}`,
    });
  }

  return targets;
}

export function findItem(
  state: EditorState,
  type: string,
  slug: string,
): ContentItem | undefined {
  return state.content.find((i) => i.type === type && i.slug === slug);
}

// ---------------------------------------------------------------------------
// Content mutations (immutable).
// ---------------------------------------------------------------------------

/** Update one content item's field. The `body` key maps to the markdown body. */
export function setContentField(
  state: EditorState,
  type: string,
  slug: string,
  key: string,
  value: string,
): EditorState {
  const content = state.content.map((item) => {
    if (item.type !== type || item.slug !== slug) return item;
    if (key === "body") return { ...item, body: value };
    return { ...item, fields: { ...item.fields, [key]: value as FieldValue } };
  });
  return { ...state, content };
}

/** Make an ASCII slug from a title, falling back to a unique id. */
export function slugify(input: string, fallbackPrefix: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `${fallbackPrefix}-${Date.now().toString(36)}`;
}

export function slugExists(state: EditorState, type: string, slug: string): boolean {
  return state.content.some((i) => i.type === type && i.slug === slug);
}

/** Create a content item of a type, seeding defaults from its field defs. */
export function createContent(
  state: EditorState,
  type: string,
  title: string,
  slug: string,
): EditorState {
  const def = typeDef(state, type);
  const fields: Record<string, FieldValue> = {};
  let body = "";
  for (const f of def?.fields ?? []) {
    if (f.name === "body") {
      body = typeof f.default === "string" ? f.default : "";
    } else if (f.default !== undefined) {
      fields[f.name] = f.default;
    }
  }
  fields.title = title;
  const item: ContentItem = { type, slug, fields, body };
  return { ...state, content: [...state.content, item] };
}

export function removeContent(
  state: EditorState,
  type: string,
  slug: string,
): EditorState {
  return {
    ...state,
    content: state.content.filter((i) => !(i.type === type && i.slug === slug)),
  };
}

// --- Content-type definitions ------------------------------------------------

export function addContentType(
  state: EditorState,
  name: string,
  label: string,
): EditorState {
  if (typeDef(state, name)) return state;
  const def: ContentTypeDef = {
    name,
    label,
    fields: [{ name: "title", label: "タイトル", type: "text", required: true }],
  };
  return { ...state, contentTypes: [...state.contentTypes, def] };
}

export function updateContentType(
  state: EditorState,
  name: string,
  patch: Partial<Pick<ContentTypeDef, "label" | "fields">>,
): EditorState {
  return {
    ...state,
    contentTypes: state.contentTypes.map((t) =>
      t.name === name ? { ...t, ...patch } : t,
    ),
  };
}

export function setTypeFields(
  state: EditorState,
  name: string,
  fields: FieldDef[],
): EditorState {
  return updateContentType(state, name, { fields });
}

/** Delete a custom content type and all its items. */
export function deleteContentType(state: EditorState, name: string): EditorState {
  return {
    ...state,
    contentTypes: state.contentTypes.filter((t) => t.name !== name),
    content: state.content.filter((i) => i.type !== name),
  };
}
