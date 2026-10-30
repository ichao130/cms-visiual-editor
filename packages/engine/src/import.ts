import { parse, type HTMLElement, type Node } from "node-html-parser";
import type { InlineFieldType } from "@pcms/shared";
import { themeifyHtml, validateThemeHtml, type AiIssue } from "./ai.js";

/**
 * Theme import — turn an external theme/template (WordPress, Shopify, a plain
 * HTML page, anything) into a pcms theme fragment. It strips the platform- and
 * server-specific bits (PHP, template directives, scripts), keeps <style>,
 * extracts the page body, detects repeating lists (so they become increment-
 * able items), then runs the themeify annotator. Pure: string in, result out,
 * no I/O. CLAUDE.md: PHP は出力に出さない / AIの出力は検証してから使う.
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

function isEl(n: Node): n is HTMLElement {
  return (n as HTMLElement).tagName != null;
}
function tagOf(el: HTMLElement): string {
  return el.tagName?.toLowerCase() ?? "";
}
function elementChildren(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter(isEl);
}

const FIELD_TAGS = "h1,h2,h3,h4,h5,h6,p,img,a";
function fieldType(t: string): InlineFieldType {
  return t === "img" ? "image" : t === "a" ? "link" : "text";
}
function labelFor(t: string): string {
  if (/^h[1-6]$/.test(t)) return "見出し";
  if (t === "img") return "画像";
  if (t === "a") return "リンク";
  return "本文";
}

/**
 * Strip server/template code and scripts from raw markup, keep <style>, and
 * extract the page body. Returns the cleaned HTML plus a log of what was done.
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

  const root = parse(s, { comment: false });

  // Keep <style> (so the imported part stays styled); lift it out of <head> and
  // re-add it above the extracted body.
  const styleEls = root.querySelectorAll("style");
  const css = styleEls.map((st) => st.innerHTML).join("\n").trim();
  styleEls.forEach((st) => st.remove());

  const body = root.querySelector("body");
  const scope = body ?? root;

  // Remove inline event handlers and javascript: links.
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

  let html = (body ? body.innerHTML : scope.toString()).trim();
  if (css) {
    html = `<style>\n${css}\n</style>\n${html}`;
    notes.push("スタイル（<style>）を取り込みました。");
  }
  return { html, notes };
}

/** Whether these siblings look like a repeating list (cards, products, …). */
function isRepeatGroup(kids: HTMLElement[]): boolean {
  if (kids.length < 3) return false;
  const first = kids[0];
  if (!first) return false;
  const tag = tagOf(first);
  const cls = (first.getAttribute("class") ?? "").trim();
  return kids.every(
    (k) =>
      tagOf(k) === tag &&
      (k.getAttribute("class") ?? "").trim() === cls &&
      elementChildren(k).length >= 1,
  );
}

/** Collapse a repeat group to one representative item with bare-name fields. */
function collapseRepeat(kids: HTMLElement[], n: number): void {
  const keep = kids[0];
  if (!keep) return;
  for (let i = 1; i < kids.length; i++) kids[i]?.remove();
  keep.setAttribute("data-repeat", n === 1 ? "items" : `items${n}`);
  keep.setAttribute("data-label", `項目${n}`);
  let f = 0;
  for (const el of keep.querySelectorAll(FIELD_TAGS)) {
    if (el.getAttribute("data-field") != null) continue;
    f += 1;
    const t = tagOf(el);
    el.setAttribute("data-field", `f${f}`);
    el.setAttribute("data-type", fieldType(t));
    el.setAttribute("data-label", labelFor(t));
  }
}

/**
 * Find repeating lists and turn each into a single increment-able item. Scoped
 * so it never collapses the page's distinct top-level sections: it inspects the
 * children of each element, and once a group is collapsed it does not recurse
 * into it.
 */
function markRepeats(root: HTMLElement): number {
  let count = 0;
  const visit = (el: HTMLElement): void => {
    const kids = elementChildren(el);
    if (isRepeatGroup(kids)) {
      collapseRepeat(kids, ++count);
      return;
    }
    for (const k of kids) visit(k);
  };
  // Start one level in, so a group of distinct top-level sections is never
  // treated as a repeat (their children are inspected, not the sections).
  for (const c of elementChildren(root)) visit(c);
  return count;
}

/**
 * Import an external theme/template: clean it, detect repeating lists, annotate
 * with the themeify heuristics, and validate the result.
 */
export function importThemeHtml(raw: string): ImportResult {
  const { html: cleaned, notes } = cleanImportedHtml(raw);

  const root = parse(cleaned, { comment: false });
  const repeats = markRepeats(root);
  const themed = themeifyHtml(root.toString());
  const issues = validateThemeHtml(themed);

  if (repeats > 0) {
    notes.push(`${repeats}個の繰り返し（リスト）を検出し、増減できる項目にしました。`);
  }
  const sections = (themed.match(/data-section=/g) ?? []).length;
  if (sections > 0) notes.push(`${sections}個の編集できるセクションを検出しました。`);
  return { html: themed, issues, notes };
}
