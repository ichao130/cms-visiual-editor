/** Split items into pages of `size`. Always returns at least one page. */
export function paginate<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages.length > 0 ? pages : [[]];
}

/** Output path for archive page `n` under a base like "/post/". */
export function archivePagePath(base: string, n: number): string {
  const trimmed = base.replace(/^\/+|\/+$/g, "");
  const prefix = trimmed === "" ? "" : `${trimmed}/`;
  return n <= 1 ? `${prefix}index.html` : `${prefix}page/${n}/index.html`;
}

/** Site-relative URL for archive page `n` under a base like "/post/". */
export function archivePageUrl(base: string, n: number): string {
  return n <= 1 ? base : `${base}page/${n}/`;
}
