import type { ContentItem, FieldValue } from "@pcms/shared";

/**
 * WordPress WXR (eXtended RSS export) content import. A theme ZIP carries the
 * DESIGN; the actual pages, posts, titles, dates and taxonomy terms live in the
 * site's database and come out only through Tools → Export, as a WXR XML file.
 * `parseWxr` turns that file into pcms `ContentItem[]` so an imported theme can
 * be filled with the real content instead of staying blank.
 *
 * The module is pure/isomorphic (no DOM, fs or WP runtime): WXR is parsed with a
 * small CDATA-aware reader, and each post's Gutenberg body (`content:encoded`) is
 * reduced to plain content HTML — pcms stores bodies as HTML (see blocks.ts) — by
 * stripping the `<!-- wp:… -->` block delimiters, exactly as the classic theme
 * path does in cleanWpMarkup.
 */
export interface WxrImportItem {
  /** The pcms ContentItem to create (type "page" / "post"). */
  item: ContentItem;
  /** WXR post id, used only to resolve parent → slug across the set. */
  postId: string;
  /** WXR parent post id ("0" = none). */
  parentId: string;
}

export interface WxrImportResult {
  items: WxrImportItem[];
  /** The front page's converted body HTML, when the export has one. */
  home?: { title: string; html: string };
  /** Absolute image URLs referenced in bodies — not fetchable offline. */
  unresolvedImages: string[];
  notes: string[];
  /** Taxonomy terms seen, so the UI can report / register them. */
  terms: { taxonomy: string; slug: string; label: string }[];
}

/** Read one `<tag>` (namespaced ok), unwrapping a CDATA section. Non-greedy. */
function readTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(tag)}>`, "i");
  const m = re.exec(xml);
  if (!m) return undefined;
  return stripCdata(m[1] ?? "");
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCdata(s: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return (m ? m[1]! : s).trim();
}

/** Split the channel into its `<item>…</item>` blocks. */
function splitItems(xml: string): string[] {
  const out: string[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1] ?? "");
  return out;
}

/** Gutenberg body → plain content HTML: drop `<!-- wp:… -->` delimiters, keep HTML. */
export function wxrBodyToHtml(encoded: string): string {
  return encoded
    .replace(/<!--\s*\/?wp:[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A WXR date "2026-02-01 09:00:00" → the "YYYY-MM-DD" pcms date field. */
function toDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  return m ? m[1] : undefined;
}

/** Last-resort slug when `wp:post_name` is empty (CJK titles slugify to nothing). */
function fallbackSlug(title: string, kind: string, n: number): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return ascii || `${kind}-${n}`;
}

const HOME_SLUGS = new Set(["home", "front", "front-page", "frontpage", "top"]);
const HOME_TITLES = new Set(["ホーム", "トップ", "トップページ", "home", "front page"]);

function isFrontPage(title: string, slug: string): boolean {
  return HOME_SLUGS.has(slug.toLowerCase()) || HOME_TITLES.has(title.trim().toLowerCase());
}

/** Collect absolute (http/https) image URLs referenced in a body. */
function imagesIn(html: string): string[] {
  const out: string[] = [];
  const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1] ?? "";
    if (/^https?:\/\//i.test(url)) out.push(url);
  }
  return out;
}

export function parseWxr(xml: string): WxrImportResult {
  const notes: string[] = [];
  const items: WxrImportItem[] = [];
  const unresolved = new Set<string>();
  const termMap = new Map<string, { taxonomy: string; slug: string; label: string }>();
  let home: WxrImportResult["home"];

  let pageN = 0;
  let postN = 0;
  for (const block of splitItems(xml)) {
    const wpType = (readTag(block, "wp:post_type") ?? "").toLowerCase();
    if (wpType !== "page" && wpType !== "post") continue; // skip attachment / nav_menu_item / …
    const type = wpType; // "page" | "post"
    const title = readTag(block, "title") ?? "";
    const rawSlug = readTag(block, "wp:post_name") ?? "";
    const n = type === "page" ? ++pageN : ++postN;
    const slug = rawSlug || fallbackSlug(title, type, n);
    const encoded = readTag(block, "content:encoded") ?? "";
    const bodyHtml = wxrBodyToHtml(encoded);
    for (const u of imagesIn(bodyHtml)) unresolved.add(u);

    // The front page flows into the active theme's top, not a standalone page.
    if (type === "page" && isFrontPage(title, slug) && !home) {
      home = { title: title || "ホーム", html: bodyHtml };
      notes.push(`トップページ「${title || "ホーム"}」の本文をテーマのトップに流し込みます。`);
      continue;
    }

    // Taxonomy terms: <category domain="category|post_tag" nicename="slug">Label</category>.
    const fields: Record<string, FieldValue> = { title };
    const date = toDate(readTag(block, "wp:post_date"));
    if (date) fields.date = date;
    const author = readTag(block, "dc:creator");
    if (author) fields.author = author;
    const cats: string[] = [];
    const tags: string[] = [];
    const catRe = /<category\s+domain="([^"]+)"\s+nicename="([^"]+)"[^>]*>([\s\S]*?)<\/category>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = catRe.exec(block)) !== null) {
      const taxonomy = cm[1] === "post_tag" ? "tag" : cm[1]!;
      const label = stripCdata(cm[3] ?? "");
      if (!label) continue;
      const key = `${taxonomy}\u0000${cm[2]}`;
      if (!termMap.has(key)) termMap.set(key, { taxonomy, slug: cm[2]!, label });
      (taxonomy === "tag" ? tags : cats).push(label);
    }
    if (cats.length) fields.category = cats;
    if (tags.length) fields.tag = tags;

    const status = (readTag(block, "wp:status") ?? "publish").toLowerCase();
    const item: ContentItem = {
      type,
      slug,
      fields,
      body: bodyHtml,
      status: status === "draft" || status === "pending" ? "draft" : "published",
    };
    items.push({ item, postId: readTag(block, "wp:post_id") ?? "", parentId: readTag(block, "wp:post_parent") ?? "0" });
  }

  // Resolve hierarchy: parent post id → the imported parent's slug.
  const slugById = new Map(items.map((i) => [i.postId, i.item.slug]));
  for (const i of items) {
    if (i.parentId && i.parentId !== "0") {
      const parentSlug = slugById.get(i.parentId);
      if (parentSlug) i.item.parent = parentSlug;
    }
  }

  const pages = items.filter((i) => i.item.type === "page").length;
  const posts = items.filter((i) => i.item.type === "post").length;
  if (pages) notes.push(`固定ページ ${pages}件を取り込みます。`);
  if (posts) notes.push(`投稿 ${posts}件を取り込みます。`);
  if (unresolved.size) {
    notes.push(`本文中の画像 ${unresolved.size}件は旧サイトのURL参照です。取り込み後にメディアへ差し替えてください。`);
  }

  return {
    items,
    home,
    unresolvedImages: [...unresolved],
    notes,
    terms: [...termMap.values()],
  };
}
