import { parse, type HTMLElement, type Node } from "node-html-parser";
import { escapeHtml } from "./markdown.js";

/**
 * The block model for the content body editor. A body is an ordered list of
 * blocks; each block maps to one well-formed HTML element. Bodies are still
 * stored as HTML (CLAUDE.md: content/<type>/<slug>.md keeps HTML bodies, and the
 * feed/description derive from that HTML), so the editor round-trips HTML →
 * blocks → HTML rather than inventing a new storage format.
 *
 * Inline markup inside a text block (`html`) is a small allow-list — strong/em/
 * a/br — that survives the round-trip; anything the parser cannot place becomes
 * a raw "html" block so no content is ever silently dropped.
 */
export type Block =
  | { type: "heading"; level: 2 | 3; html: string }
  | { type: "paragraph"; html: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; html: string }
  | { type: "image"; src: string; alt: string; caption?: string }
  | { type: "gallery"; images: { src: string; alt: string }[] }
  | { type: "divider" }
  | { type: "html"; html: string };

function isEl(n: Node): n is HTMLElement {
  return (n as HTMLElement).tagName != null;
}

function tag(el: HTMLElement): string {
  return el.tagName?.toLowerCase() ?? "";
}

/**
 * Keep only the inline markup the block editor understands (strong/em/a/br) and
 * re-serialize everything else as escaped text, so a text block never carries a
 * block tag, an event handler or a javascript: link out of the editor.
 */
function cleanInline(html: string): string {
  const root = parse(html ?? "", { comment: false });
  const out = root.childNodes.map(serializeInline).join("");
  return out.replace(/\s+/g, " ").trim();
}

function serializeInline(node: Node): string {
  if (!isEl(node)) return escapeHtml(node.text ?? "");
  const el = node as HTMLElement;
  let name = tag(el);
  if (name === "br") return "<br>";
  if (name === "b") name = "strong";
  if (name === "i") name = "em";
  const inner = el.childNodes.map(serializeInline).join("");
  if (name === "strong" || name === "em") return `<${name}>${inner}</${name}>`;
  if (name === "a") {
    const href = el.getAttribute("href") ?? "";
    if (href && !/^\s*javascript:/i.test(href)) {
      return `<a href="${escapeHtml(href)}">${inner}</a>`;
    }
    return inner;
  }
  // Any other element (span, div, script…): keep only its text content.
  return inner;
}

/** Serialize blocks back to the HTML stored in the content body. */
export function blocksToHtml(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        parts.push(`<h${b.level}>${b.html}</h${b.level}>`);
        break;
      case "paragraph":
        parts.push(`<p>${b.html}</p>`);
        break;
      case "quote":
        parts.push(`<blockquote>${b.html}</blockquote>`);
        break;
      case "list": {
        const t = b.ordered ? "ol" : "ul";
        const items = b.items.map((i) => `<li>${i}</li>`).join("");
        parts.push(`<${t}>${items}</${t}>`);
        break;
      }
      case "image": {
        const img = `<img src="${escapeHtml(b.src)}" alt="${escapeHtml(b.alt)}">`;
        const caption = (b.caption ?? "").trim();
        // A caption wraps the image in a <figure>; without one, a bare <img>
        // keeps the output (and the round-trip) minimal.
        parts.push(
          caption ? `<figure>${img}<figcaption>${escapeHtml(caption)}</figcaption></figure>` : img,
        );
        break;
      }
      case "gallery": {
        const imgs = b.images
          .map((im) => `<img src="${escapeHtml(im.src)}" alt="${escapeHtml(im.alt)}">`)
          .join("");
        parts.push(`<div class="pcms-gallery">${imgs}</div>`);
        break;
      }
      case "divider":
        parts.push("<hr>");
        break;
      case "html":
        parts.push(b.html);
        break;
    }
  }
  return parts.join("\n");
}

/**
 * Parse a stored HTML body into editor blocks. Known block elements map to their
 * block; a bare text run becomes a paragraph; anything else (tables, iframes,
 * figures, divs…) is kept verbatim as a raw "html" block so nothing is lost.
 */
export function htmlToBlocks(html: string): Block[] {
  const root = parse(html ?? "", { comment: false });
  const blocks: Block[] = [];
  for (const node of root.childNodes) {
    if (!isEl(node)) {
      const text = node.text?.trim() ?? "";
      if (text !== "") blocks.push({ type: "paragraph", html: escapeHtml(text) });
      continue;
    }
    const name = tag(node);
    if (name === "h1" || name === "h2") {
      blocks.push({ type: "heading", level: 2, html: cleanInline(node.innerHTML) });
    } else if (name === "h3" || name === "h4" || name === "h5" || name === "h6") {
      blocks.push({ type: "heading", level: 3, html: cleanInline(node.innerHTML) });
    } else if (name === "p") {
      const inner = cleanInline(node.innerHTML);
      if (inner !== "") blocks.push({ type: "paragraph", html: inner });
    } else if (name === "ul" || name === "ol") {
      const items = node
        .querySelectorAll("li")
        .map((li) => cleanInline(li.innerHTML))
        .filter((i) => i !== "");
      if (items.length > 0) blocks.push({ type: "list", ordered: name === "ol", items });
    } else if (name === "blockquote") {
      // Unwrap a single wrapping <p> so the quote edits as plain inline text.
      const only = node.childNodes.filter(isEl);
      const inner =
        only.length === 1 && tag(only[0] as HTMLElement) === "p"
          ? (only[0] as HTMLElement).innerHTML
          : node.innerHTML;
      blocks.push({ type: "quote", html: cleanInline(inner) });
    } else if (name === "img") {
      blocks.push({
        type: "image",
        src: node.getAttribute("src") ?? "",
        alt: node.getAttribute("alt") ?? "",
      });
    } else if (
      name === "div" &&
      (node.getAttribute("class") ?? "").split(/\s+/).includes("pcms-gallery")
    ) {
      blocks.push({
        type: "gallery",
        images: node.querySelectorAll("img").map((img) => ({
          src: img.getAttribute("src") ?? "",
          alt: img.getAttribute("alt") ?? "",
        })),
      });
    } else if (name === "figure" && node.querySelector("img")) {
      const img = node.querySelector("img")!;
      const caption = node.querySelector("figcaption")?.text.trim() ?? "";
      blocks.push({
        type: "image",
        src: img.getAttribute("src") ?? "",
        alt: img.getAttribute("alt") ?? "",
        ...(caption ? { caption } : {}),
      });
    } else if (name === "hr") {
      blocks.push({ type: "divider" });
    } else if (name === "script" || name === "style") {
      // Never round-trip executable content through the editor.
      continue;
    } else {
      blocks.push({ type: "html", html: node.toString() });
    }
  }
  return blocks;
}
