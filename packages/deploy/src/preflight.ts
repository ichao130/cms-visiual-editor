import type { FileSet, Issue } from "./types.js";
import { toBytes } from "./hash.js";

const REQUIRED = ["sitemap.xml", "robots.txt", "404.html"];

/**
 * Pre-publish checks over the complete output: required files present, pages
 * have a title, no empty HTML, and internal links resolve to an output file.
 */
export function preflight(files: FileSet): Issue[] {
  const issues: Issue[] = [];
  const paths = new Set(Object.keys(files));

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
    if (!/<title[^>]*>\s*\S/i.test(html)) {
      issues.push({ level: "warning", message: "タイトルが設定されていません", path });
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

  return issues;
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
