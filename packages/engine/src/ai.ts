import { parse, type HTMLElement, type Node } from "node-html-parser";
import type { InlineFieldType } from "@pcms/shared";

/**
 * AI helpers — the deterministic core behind the editor's AI features. The
 * themeify / validate functions are real (no model needed); the draft / rewrite
 * / seo functions are offline heuristics that stand in for a model until the
 * Firebase AI proxy is wired. All pure: string in, string out, no I/O, no keys.
 */

export interface AiIssue {
  level: "error" | "warning";
  message: string;
}

const BLOCK = new Set([
  "section",
  "header",
  "footer",
  "article",
  "aside",
  "main",
  "div",
  "nav",
]);

const VALID_TYPES: ReadonlySet<string> = new Set([
  "text",
  "richtext",
  "image",
  "link",
  "color",
  "number",
  "select",
]);

function isElement(n: Node): n is HTMLElement {
  return (n as HTMLElement).tagName != null;
}
function tag(el: HTMLElement): string {
  return el.tagName?.toLowerCase() ?? "";
}

/**
 * Turn ordinary HTML into a pcms theme template by adding `data-section` /
 * `data-field` annotations heuristically. A human (or the AI) refines it after.
 */
export function themeifyHtml(html: string): string {
  const root = parse(html, { comment: false });

  let containers = root.childNodes.filter(isElement);
  // Descend through a single wrapper (e.g. <body> / <main>) only when its
  // children are themselves block-level sections — not when it holds content.
  while (containers.length === 1 && containers[0] && BLOCK.has(tag(containers[0]))) {
    const inner = containers[0].childNodes.filter(isElement);
    if (inner.length >= 2 && inner.every((el) => BLOCK.has(tag(el)))) {
      containers = inner;
    } else {
      break;
    }
  }

  let s = 0;
  for (const c of containers) {
    if (!BLOCK.has(tag(c))) continue;
    if (c.childNodes.filter(isElement).length === 0) continue;
    s += 1;
    const id = `sec-${s}`;
    if (c.getAttribute("data-section") == null) c.setAttribute("data-section", id);
    if (c.getAttribute("data-label") == null) c.setAttribute("data-label", `セクション${s}`);
    annotateFields(c, id);
  }
  return root.toString();
}

function annotateFields(section: HTMLElement, id: string): void {
  let f = 0;
  for (const el of section.querySelectorAll("h1,h2,h3,h4,h5,h6,p,img,a")) {
    if (el.getAttribute("data-field") != null) continue;
    f += 1;
    const t = tag(el);
    const type: InlineFieldType = t === "img" ? "image" : t === "a" ? "link" : "text";
    el.setAttribute("data-field", `${id}.f${f}`);
    el.setAttribute("data-type", type);
    el.setAttribute("data-label", labelFor(t));
  }
}

function labelFor(t: string): string {
  if (/^h[1-6]$/.test(t)) return "見出し";
  if (t === "img") return "画像";
  if (t === "a") return "リンク";
  return "本文";
}

/**
 * Validate theme HTML (e.g. an AI-proposed one) before it is used: known field
 * types, non-empty field paths, non-empty loop sources. CLAUDE.md: AIの出力は
 * 必ず検証してから使う.
 */
export function validateThemeHtml(html: string): AiIssue[] {
  const root = parse(html, { comment: false });
  const issues: AiIssue[] = [];

  for (const el of root.querySelectorAll("[data-field]")) {
    if ((el.getAttribute("data-field") ?? "") === "") {
      issues.push({ level: "error", message: "data-field が空の要素があります。" });
    }
    const type = el.getAttribute("data-type");
    if (type != null && !VALID_TYPES.has(type)) {
      issues.push({ level: "error", message: `未知の data-type です: ${type}` });
    }
  }
  for (const el of root.querySelectorAll("[data-loop]")) {
    if ((el.getAttribute("data-loop") ?? "") === "") {
      issues.push({ level: "warning", message: "data-loop の対象が指定されていません。" });
    }
  }
  if (root.querySelectorAll("[data-section],[data-field]").length === 0) {
    issues.push({ level: "warning", message: "編集できる箇所（data-section / data-field）がありません。" });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Offline heuristics standing in for a model (replaced by the AI proxy later).
// ---------------------------------------------------------------------------

/** Draft a short paragraph from a prompt. */
export function draftText(prompt: string): string {
  const topic = prompt.trim() || "お店";
  return [
    `<p>${escapeText(topic)}について、心を込めてご紹介します。</p>`,
    `<p>日々のこだわりと、お客様に喜んでいただける体験をお届けします。ぜひお気軽にお立ち寄りください。</p>`,
  ].join("");
}

/** Rewrite text per a short instruction (very rough heuristics). */
export function rewriteText(text: string, instruction: string): string {
  const plain = stripTags(text).trim();
  if (/短く|簡潔|要約/.test(instruction)) {
    const first = plain.split(/[。.!?！？]/)[0] ?? plain;
    return `<p>${escapeText(first.trim())}。</p>`;
  }
  if (/丁寧|ていねい|敬語/.test(instruction)) {
    return `<p>${escapeText(plain)}（ご来店を心よりお待ちしております）</p>`;
  }
  if (/魅力|わくわく|楽しく|キャッチ/.test(instruction)) {
    return `<p>✨ ${escapeText(plain)} ✨</p>`;
  }
  // Default: wrap as-is, noting no strong transform was applied.
  return `<p>${escapeText(plain)}</p>`;
}

/** Suggest an SEO title + meta description from a title and body. */
export function seoSuggest(
  title: string,
  bodyHtml: string,
): { title: string; description: string } {
  const body = stripTags(bodyHtml).replace(/\s+/g, " ").trim();
  const description = body.length > 120 ? `${body.slice(0, 117)}…` : body;
  return { title: title.trim(), description };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}
function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
