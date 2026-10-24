import type {
  ContentItem,
  FieldValue,
  MenuItem,
  PageSettings,
  SiteConfig,
  ThemeConfig,
} from "@pcms/shared";

/** Pagination state for an archive page. */
export interface PaginationContext {
  current: number;
  total: number;
  /** Archive base URL, e.g. "/post/". */
  baseUrl: string;
  prevUrl?: string;
  nextUrl?: string;
}

/** The term context on a taxonomy archive page. */
export interface TermContext {
  taxonomy: string;
  /** Taxonomy label, e.g. "カテゴリ". */
  label: string;
  /** The term value, e.g. "お知らせ". */
  value: string;
  url: string;
}

/** Everything the renderer needs to resolve values for one page render. */
export interface RenderScope {
  site: SiteConfig;
  theme: ThemeConfig;
  page: PageSettings;
  /** The current item when inside a loop or on a content-item page. */
  item?: ContentItem;
  /** Named menus available via `data-loop="<menu>"`. */
  menus: Record<string, MenuItem[]>;
  /** Named collections available via `data-loop="<name>"`, e.g. "posts". */
  collections: Record<string, ContentItem[]>;
  /** Pagination fields (`data-field="pagination.*"`) on archive pages. */
  pagination?: PaginationContext;
  /** Term fields (`data-field="term.*"`) on taxonomy archive pages. */
  term?: TermContext;
  /**
   * When true, keep `data-pcms-section` / `data-pcms-field` markers on output
   * so the live editor can map clicks back to sections/fields. Not set for
   * published output. Turned off inside loops/repeats (those are content).
   */
  editable?: boolean;
}

/**
 * Resolve a `data-field` path to a value.
 *
 * Returns `undefined` when nothing is set, which the renderer treats as
 * "keep the theme's own default content" — so a theme works with no config.
 */
export function resolveField(
  path: string,
  scope: RenderScope,
): FieldValue | undefined {
  if (path === "") return undefined;
  const [head, ...rest] = path.split(".");
  const tail = rest.join(".");

  if (head === "site") return getByPath(scope.site, tail);
  if (head === "theme") return getByPath(scope.theme, tail);

  if (head === "pagination" && scope.pagination) {
    return resolvePagination(scope.pagination, tail);
  }
  if (head === "term" && scope.term) {
    if (tail === "label") return scope.term.label;
    if (tail === "value") return scope.term.value;
    if (tail === "taxonomy") return scope.term.taxonomy;
    if (tail === "url") return scope.term.url;
    return undefined;
  }

  // Inside a loop/repeat (or on a content-item page) the current item takes
  // priority. `post.title` / `item.url` strip the prefix; a bare name like
  // `price` resolves against the item's fields directly.
  if (scope.item) {
    if (isItemPrefix(head, scope.item)) {
      const value = resolveItemField(scope.item, tail);
      if (value !== undefined) return value;
    } else {
      const value = resolveItemField(scope.item, path);
      if (value !== undefined) return value;
    }
  }

  // Page-level field value, keyed by the full data-field path.
  const pageFields = scope.page.fields;
  if (pageFields && path in pageFields) return pageFields[path];

  return undefined;
}

function isItemPrefix(head: string | undefined, item: ContentItem): boolean {
  return head === "post" || head === "item" || head === item.type;
}

function resolveItemField(item: ContentItem, tail: string): FieldValue | undefined {
  if (tail === "body") return item.bodyHtml ?? item.body;
  if (tail === "slug") return item.slug;
  if (tail === "type") return item.type;
  const value = getByPath(item.fields, tail);
  return value;
}

function resolvePagination(
  p: PaginationContext,
  tail: string,
): FieldValue | undefined {
  switch (tail) {
    case "current":
      return p.current;
    case "total":
      return p.total;
    case "label":
      return `${p.current} / ${p.total}`;
    case "prevUrl":
      return p.prevUrl ?? null;
    case "nextUrl":
      return p.nextUrl ?? null;
    default:
      return undefined;
  }
}

/** Read a dotted path out of a plain object; returns undefined if missing. */
function getByPath(obj: unknown, path: string): FieldValue | undefined {
  if (path === "") return undefined;
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur as FieldValue | undefined;
}

/** Whether a resolved value should be considered "empty" for `data-if`. */
export function isEmpty(value: FieldValue | undefined): boolean {
  if (value == null) return true;
  if (value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
