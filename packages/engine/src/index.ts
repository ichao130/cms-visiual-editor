/**
 * @pcms/engine — theme parsing, rendering and static site generation.
 *
 * Pure, isomorphic TypeScript: no `fs`, `electron`, or `window`. All I/O is the
 * caller's responsibility (CLAUDE.md 境界のルール), so the same engine powers the
 * desktop app today and a future web editor.
 */

export { ATTR, EDITOR_ATTRS } from "./attributes.js";
export { parseTemplate, parseSectionSchema } from "./parser.js";
export { renameSection } from "./section.js";
export {
  renderTemplate,
  renderComposedPage,
  RESPONSIVE_CSS,
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
export { blocksToHtml, htmlToBlocks, type Block } from "./blocks.js";
export {
  buildBackup,
  parseBackup,
  encryptBackup,
  decryptBackup,
  createEncryptedBackup,
  openEncryptedBackup,
  type BackupData,
  type BackupManifest,
  type EncryptedBackup,
} from "./backup.js";
export {
  KvBackupStore,
  type BackupStore,
  type BackupRef,
  type KvAdapter,
} from "./backupStore.js";
export {
  generateSite,
  isScheduled,
  contentUrl,
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
  diagnoseThemeHtml,
  type AiIssue,
  type AiDiagnosis,
} from "./ai.js";
export {
  buildFormEmbed,
  HONEYPOT_FIELD,
  type FormEmbedOptions,
} from "./formEmbed.js";
export {
  cleanImportedHtml,
  importThemeHtml,
  suggestThemePart,
  type ImportSource,
  type ImportResult,
} from "./import.js";
export { mediaUsageCounts } from "./media.js";
export { preflight, type PreflightIssue, type SiteFileSet } from "./preflight.js";
