/**
 * Theme working-copy conventions shared by every backend (the browser mock and
 * the desktop overlay store).
 *
 * CLAUDE.md: the theme's original files on disk are never modified. Edits and
 * created parts live in a per-theme working copy (a path→content overlay). To
 * let the operator delete an *original* theme file without touching the disk, a
 * deletion is recorded as a tombstone: a sentinel overlay value for that path.
 * Everywhere the overlay is merged onto the theme, a tombstoned path is removed
 * from the listing, the preview and the published output. Resetting the theme
 * clears the overlay (tombstones included), so a deletion is recoverable.
 */

/**
 * Sentinel overlay value marking a base theme file as deleted. The leading NUL
 * cannot begin any real file content, so it never collides with an edit.
 */
export const THEME_FILE_TOMBSTONE = "\u0000pcms:file-deleted";

/** True when an overlay value is the deletion tombstone. */
export function isThemeTombstone(value: string | undefined | null): boolean {
  return value === THEME_FILE_TOMBSTONE;
}
