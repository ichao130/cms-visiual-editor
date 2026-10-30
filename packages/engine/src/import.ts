import { parse } from "node-html-parser";
import { themeifyHtml, validateThemeHtml, type AiIssue } from "./ai.js";

/**
 * Theme import — turn an external theme/template (WordPress, Shopify, a plain
 * HTML page, anything) into a pcms theme fragment. It strips the platform- and
 * server-specific bits (PHP, template directives, scripts), extracts the page
 * body, then runs the themeify annotator so the result is editable. Pure:
 * string in, result out, no I/O. CLAUDE.md: PHP は出力に出さない / AIの出力は検証して
 * から使う — the caller previews and validates before saving.
 */

/** A hint about where the markup came from, used only for the notes/log. */
export type ImportSource = "auto" | "wordpress" | "shopify" | "html" | "other";

export interface ImportResult {
  /** The cleaned, themeified HTML — a pcms theme fragment. */
  html: string;
  /** Validation issues on the result (same check as any AI-proposed theme). */
  issues: AiIssue[];
  /** Human-readable notes on what the optimizer removed or changed. */
  notes: string[];
}

/**
 * Strip server/template code and scripts from raw markup and extract the page
 * body. Returns the cleaned HTML plus a log of what was done.
 */
export function cleanImportedHtml(raw: string): { html: string; notes: string[] } {
  const notes: string[] = [];
  let s = raw;

  const strip = (re: RegExp, repl: string, note: string): void => {
    const n = (s.match(re) ?? []).length;
    if (n > 0) {
      s = s.replace(re, repl);
      notes.push(note);
    }
  };

  // Server code and template engines — WordPress/PHP, ASP/JSP/ERB, and the
  // Liquid/Twig/Handlebars family. Block tags ({% %}) are dropped but their
  // inner HTML is kept (a loop body becomes reusable structure); expressions
  // ({{ }}) are dropped so the element is left empty for a real field.
  strip(/<\?[\s\S]*?\?>/g, "", "PHPコードを除去しました。");
  strip(/<%[\s\S]*?%>/g, "", "サーバーテンプレート（<% %>）を除去しました。");
  strip(/\{%[\s\S]*?%\}/g, "", "テンプレートのブロック記法（{% %}）を除去しました。");
  strip(/\{\{[\s\S]*?\}\}/g, "", "テンプレートの変数（{{ }}）を除去しました。");
  strip(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "", "スクリプトを除去しました。");
  strip(/<!--[\s\S]*?-->/g, "", "コメントを除去しました。");

  // Parse the remainder: extract <body> (dropping <head>), and remove inline
  // event handlers and javascript: links.
  const root = parse(s, { comment: false });
  const body = root.querySelector("body");
  const scope = body ?? root;

  let unsafeAttrs = 0;
  for (const el of scope.querySelectorAll("*")) {
    for (const name of Object.keys(el.attributes)) {
      const lower = name.toLowerCase();
      if (lower.startsWith("on")) {
        el.removeAttribute(name);
        unsafeAttrs += 1;
      } else if (
        (lower === "href" || lower === "src") &&
        /^\s*javascript:/i.test(el.getAttribute(name) ?? "")
      ) {
        el.setAttribute(name, "#");
        unsafeAttrs += 1;
      }
    }
  }
  if (unsafeAttrs > 0) notes.push("イベント属性や危険なリンクを除去しました。");
  if (body) notes.push("ページの<head>を除いて本文を抽出しました。");

  const html = (body ? body.innerHTML : scope.toString()).trim();
  return { html, notes };
}

/**
 * Import an external theme/template: clean it, annotate it with the themeify
 * heuristics, and validate the result.
 */
export function importThemeHtml(raw: string): ImportResult {
  const { html: cleaned, notes } = cleanImportedHtml(raw);
  const themed = themeifyHtml(cleaned);
  const issues = validateThemeHtml(themed);
  const sections = (themed.match(/data-section=/g) ?? []).length;
  if (sections > 0) notes.push(`${sections}個の編集できるセクションを検出しました。`);
  return { html: themed, issues, notes };
}
