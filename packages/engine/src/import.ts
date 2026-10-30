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
export type ImportSource = "auto" | "wordpress" | "shopify" | "figma" | "html" | "other";

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
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

/** Turn one anchor into a dynamic menu item (`data-loop="menu"`). */
function markMenuAnchor(a: HTMLElement): void {
  const label = a.text.trim() || "メニュー";
  a.setAttribute("data-loop", "menu");
  a.setAttribute("data-field", "item.url");
  a.setAttribute("data-type", "link");
  a.set_content(
    `<span data-field="item.label" data-type="text" data-label="ラベル">${escapeText(label)}</span>`,
  );
}

/**
 * Detect navigation menus: a <nav> with a list of links becomes a single
 * `data-loop="menu"` item bound to the site's menu, instead of a frozen set of
 * links. Mirrors the sample theme's layout.html convention.
 */
function detectMenus(root: HTMLElement): number {
  let count = 0;
  for (const nav of root.querySelectorAll("nav")) {
    // A <ul>/<ol> of links: keep one <li>, make its anchor the menu item.
    const listInNav = nav.querySelectorAll("ul,ol")[0];
    if (listInNav) {
      const lis = listInNav.querySelectorAll("li").filter((li) => li.querySelector("a"));
      if (lis.length >= 2) {
        const keep = lis[0];
        const a = keep?.querySelector("a");
        if (a) {
          markMenuAnchor(a);
          for (let i = 1; i < lis.length; i++) lis[i]?.remove();
          count += 1;
          continue;
        }
      }
    }
    // Otherwise direct anchors in the nav.
    const anchors = elementChildren(nav).filter((e) => tagOf(e) === "a");
    if (anchors.length >= 2 && anchors[0]) {
      markMenuAnchor(anchors[0]);
      for (let i = 1; i < anchors.length; i++) anchors[i]?.remove();
      count += 1;
    }
  }
  return count;
}

/**
 * Light performance/accessibility optimization on imported markup: lazy-load
 * images, give them an alt so they pass the pre-publish check, and harden
 * target="_blank" links with rel="noopener".
 */
function optimizeMedia(root: HTMLElement): { imgs: number; links: number } {
  let imgs = 0;
  let links = 0;
  for (const img of root.querySelectorAll("img")) {
    let changed = false;
    if (img.getAttribute("loading") == null) {
      img.setAttribute("loading", "lazy");
      changed = true;
    }
    if (img.getAttribute("decoding") == null) {
      img.setAttribute("decoding", "async");
      changed = true;
    }
    if (img.getAttribute("alt") == null) {
      img.setAttribute("alt", "");
      changed = true;
    }
    if (changed) imgs += 1;
  }
  for (const a of root.querySelectorAll("a")) {
    if (a.getAttribute("target") !== "_blank") continue;
    const rel = a.getAttribute("rel") ?? "";
    if (!/\bnoopener\b/.test(rel)) {
      a.setAttribute("rel", rel ? `${rel} noopener` : "noopener");
      links += 1;
    }
  }
  return { imgs, links };
}

/** True when the raw markup is (starts with) an SVG — e.g. a Figma export. */
function looksLikeSvg(raw: string): boolean {
  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(raw);
}

/**
 * Import a Figma/SVG export: strip scripts, wrap the <svg> in a section, and
 * make its <text> nodes editable. The vector art is kept intact (its own
 * <style>/<defs> stay inside the svg).
 */
function importSvg(raw: string): ImportResult {
  const notes: string[] = [];
  const s = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const root = parse(s, { comment: false });
  const svg = root.querySelector("svg");
  if (!svg) {
    return { html: "", issues: [{ level: "error", message: "SVGを認識できませんでした。" }], notes };
  }
  for (const el of svg.querySelectorAll("*")) {
    for (const name of Object.keys(el.attributes)) {
      if (name.toLowerCase().startsWith("on")) el.removeAttribute(name);
    }
  }
  let f = 0;
  for (const el of svg.querySelectorAll("text")) {
    if (el.getAttribute("data-field") != null) continue;
    f += 1;
    el.setAttribute("data-field", `sec-1.f${f}`);
    el.setAttribute("data-type", "text");
    el.setAttribute("data-label", "テキスト");
  }
  const themed = `<section data-section="sec-1" data-label="デザイン">${svg.toString()}</section>`;
  notes.push("Figma/SVGとして取り込みました。");
  notes.push(
    f > 0
      ? `${f}個のテキストを編集可能にしました。`
      : "テキスト要素は見つかりませんでした（図版として取り込み）。",
  );
  return { html: themed, issues: validateThemeHtml(themed), notes };
}

/**
 * Import an external theme/template: clean it, detect menus and repeating
 * lists, annotate with the themeify heuristics, and validate. A Figma/SVG
 * export is handled directly (wrapped as a design section with editable text).
 */
export function importThemeHtml(raw: string): ImportResult {
  if (looksLikeSvg(raw)) return importSvg(raw);

  const { html: cleaned, notes } = cleanImportedHtml(raw);

  const root = parse(cleaned, { comment: false });
  const menus = detectMenus(root);
  const repeats = markRepeats(root);
  const opt = optimizeMedia(root);
  const themed = themeifyHtml(root.toString());
  const issues = validateThemeHtml(themed);

  if (opt.imgs > 0) {
    notes.push(`${opt.imgs}個の画像を最適化しました（遅延読み込み・alt補完）。`);
  }
  if (opt.links > 0) {
    notes.push(`${opt.links}個の外部リンクに rel="noopener" を付与しました。`);
  }
  if (menus > 0) notes.push(`${menus}個のメニュー（ナビ）を検出しました。`);
  if (repeats > 0) {
    notes.push(`${repeats}個の繰り返し（リスト）を検出し、増減できる項目にしました。`);
  }
  const sections = (themed.match(/data-section=/g) ?? []).length;
  if (sections > 0) notes.push(`${sections}個の編集できるセクションを検出しました。`);
  return { html: themed, issues, notes };
}
