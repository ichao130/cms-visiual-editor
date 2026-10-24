/**
 * @pcms/engine — theme parsing, rendering and static site generation.
 *
 * Pure, isomorphic TypeScript: no `fs`, `electron`, or `window`. All I/O is the
 * caller's responsibility (CLAUDE.md 境界のルール), so the same engine powers the
 * desktop app today and a future web editor.
 */

export { ATTR, EDITOR_ATTRS } from "./attributes.js";
export { parseTemplate, parseSectionSchema } from "./parser.js";
export {
  renderTemplate,
  renderComposedPage,
  type RenderOptions,
  type ComposedScope,
} from "./renderer.js";
export {
  resolveField,
  isEmpty,
  type RenderScope,
  type PaginationContext,
  type TermContext,
} from "./context.js";
export { parseFrontMatter, type ParsedFrontMatter } from "./frontmatter.js";
export { renderMarkdown, escapeHtml } from "./markdown.js";
export { detectFieldType } from "./field-type.js";
export {
  generateSite,
  type SiteInput,
  type ThemeBundle,
  type GeneratedSite,
} from "./generator.js";
export {
  themeifyHtml,
  validateThemeHtml,
  draftText,
  rewriteText,
  seoSuggest,
  type AiIssue,
} from "./ai.js";
