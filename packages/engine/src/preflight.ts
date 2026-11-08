import type { ContentItem, ContentTypeDef, FieldDef, FieldValue } from "@pcms/shared";

/** An in-memory set of output files: site-relative path → contents. */
export type SiteFileSet = Record<string, string | Uint8Array>;

/** A pre-publish check result. */
export interface PreflightIssue {
  level: "error" | "warning";
  message: string;
  path?: string;
}

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

const REQUIRED = ["sitemap.xml", "robots.txt", "404.html"];

/**
 * Pre-publish checks over the complete output: required files present, pages
 * have a title and a meta description, exactly one H1, no empty HTML, internal
 * links resolve to an output file, and page titles are unique across the site.
 * Pure: file set in, issues out. Isomorphic (no fs/network) so both the desktop
 * publish pipeline and the in-app preview can run it.
 */
export function preflight(files: SiteFileSet): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const paths = new Set(Object.keys(files));
  // Page title → the paths that use it, for the cross-page duplicate check.
  const titleUsers = new Map<string, string[]>();

  for (const req of REQUIRED) {
    if (!paths.has(req)) {
      issues.push({ level: "error", message: `必須ファイルがありません: ${req}`, path: req });
    }
  }

  for (const [path, data] of Object.entries(files)) {
    if (!path.endsWith(".html")) continue;
    const html = typeof data === "string" ? data : new TextDecoder().decode(toBytes(data));

    if (html.trim() === "") {
      issues.push({ level: "error", message: "空のHTMLページです", path });
      continue;
    }
    // Redirect stubs (meta refresh) are not content pages — skip the SEO checks.
    if (/http-equiv\s*=\s*["']refresh["']/i.test(html)) continue;
    const title = titleOf(html);
    if (title == null) {
      issues.push({ level: "warning", message: "タイトルが設定されていません", path });
    } else {
      titleUsers.set(title, [...(titleUsers.get(title) ?? []), path]);
    }

    if (!hasMetaDescription(html)) {
      issues.push({ level: "warning", message: "メタディスクリプションがありません", path });
    }

    const h1 = h1Count(html);
    if (h1 === 0) {
      issues.push({ level: "warning", message: "見出し(h1)がありません", path });
    } else if (h1 > 1) {
      issues.push({ level: "warning", message: `見出し(h1)が${h1}個あります（1つにしてください）`, path });
    }

    const missingAlt = imagesMissingAlt(html);
    if (missingAlt > 0) {
      issues.push({
        level: "warning",
        message: `代替テキスト(alt)のない画像が${missingAlt}個あります`,
        path,
      });
    }

    for (const target of internalLinks(html)) {
      if (!resolvesTo(target, paths)) {
        issues.push({
          level: "warning",
          message: `リンク先が見つかりません: ${target}`,
          path,
        });
      }
    }
  }

  // Cross-page: the same <title> on more than one page hurts SEO.
  for (const [title, users] of titleUsers) {
    if (users.length < 2) continue;
    for (const path of users) {
      issues.push({
        level: "warning",
        message: `タイトルが他のページと重複しています: ${title}`,
        path,
      });
    }
  }

  return issues;
}

/**
 * Whether a field value counts as "not filled in" for a required-field check.
 * Empty string / whitespace, null, an empty list, and an unchecked checkbox
 * (false) are empty; the number 0 and `false`-but-as-text are real values.
 */
function isEmptyValue(value: FieldValue | undefined): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "boolean") return value === false;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Whether a field is active given the item's other values. Mirrors the editor's
 * showIf rule (ContentForm): a field with no condition is always active; with a
 * condition it is active only when the referenced field matches (equals the
 * given value, or is non-empty when no value is given). Hidden fields are not
 * required.
 */
function fieldActive(field: FieldDef, fields: Record<string, FieldValue>): boolean {
  const cond = field.showIf;
  if (!cond) return true;
  const other = fields[cond.field];
  if (cond.equals === undefined) return !isEmptyValue(other);
  return other === cond.equals;
}

/**
 * Pre-publish content check: every published item has its type's required
 * fields filled (respecting showIf, skipping drafts). Pure and isomorphic, like
 * {@link preflight}; the publish pipeline merges these with the output checks.
 * Missing required fields are warnings (they do not block publishing) so the
 * operator sees them in the same pre-publish list as the SEO checks.
 */
export function validateContent(
  contentTypes: ContentTypeDef[],
  content: ContentItem[],
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const typeByName = new Map(contentTypes.map((t) => [t.name, t]));
  for (const item of content) {
    if (item.status === "draft") continue;
    const type = typeByName.get(item.type);
    if (!type) continue;
    const label =
      (typeof item.fields.title === "string" && item.fields.title.trim()) || item.slug;
    for (const field of type.fields) {
      if (!field.required) continue;
      if (!fieldActive(field, item.fields)) continue;
      if (isEmptyValue(item.fields[field.name])) {
        issues.push({
          level: "warning",
          message: `「${type.label}」の「${label}」で必須項目が未入力です: ${field.label || field.name}`,
        });
      }
    }
  }
  return issues;
}

/** The trimmed text of the page's <title>, or null when it is missing/empty. */
function titleOf(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const txt = (m[1] ?? "").replace(/\s+/g, " ").trim();
  return txt === "" ? null : txt;
}

/** Whether the page has a <meta name="description"> with non-empty content. */
function hasMetaDescription(html: string): boolean {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (!/name\s*=\s*["']description["']/i.test(tag)) continue;
    const c = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (c && (c[1] ?? "").trim() !== "") return true;
  }
  return false;
}

/** Number of <h1> elements on the page. */
function h1Count(html: string): number {
  return (html.match(/<h1\b/gi) ?? []).length;
}

/**
 * Count `<img>` tags with no `alt` attribute at all. An explicit empty
 * `alt=""` marks a decorative image and is allowed, so only a missing attribute
 * is flagged (accessibility + SEO).
 */
function imagesMissingAlt(html: string): number {
  let count = 0;
  const re = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!/\balt\s*=/i.test(m[0])) count++;
  }
  return count;
}

function internalLinks(html: string): string[] {
  const out = new Set<string>();
  const re = /(?:href|src)\s*=\s*"([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1] ?? "";
    // Only site-root-relative links; skip external, anchors, data, mailto, etc.
    if (url.startsWith("/") && !url.startsWith("//")) out.add(url);
  }
  return [...out];
}

function resolvesTo(url: string, paths: Set<string>): boolean {
  const clean = url.split(/[?#]/)[0] ?? url;
  const rel = clean.replace(/^\/+/, "");
  if (rel === "") return paths.has("index.html");
  if (paths.has(rel)) return true;
  if (rel.endsWith("/")) return paths.has(`${rel}index.html`);
  // A directory-style link without a trailing slash.
  return paths.has(`${rel}/index.html`);
}
