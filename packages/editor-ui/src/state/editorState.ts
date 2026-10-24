import type { ContentItem, FieldValue, SiteSettings } from "@pcms/shared";
import type { ProjectData } from "../api/types.js";

/**
 * The full undoable document: the operator's page settings plus the editable
 * content items. Keeping both under one history gives a single undo/redo stack
 * across page and content edits.
 */
export interface EditorState {
  settings: SiteSettings;
  content: ContentItem[];
}

export function initialState(project: ProjectData): EditorState {
  return { settings: project.settings, content: project.content };
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

const TYPE_LABELS: Record<string, string> = {
  post: "投稿",
  page: "固定ページ",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
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
      label: `${typeLabel(item.type)}：${title}`,
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
