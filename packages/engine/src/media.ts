/**
 * Media usage — count how many times each stored media path is referenced in
 * the site data. Image fields store the media path as their value (site.json
 * logo/OGP, section field values, content fields), so a reference is an exact
 * string match for a known media path anywhere in the project JSON. Pure: data
 * in, counts out, no I/O. Used to warn before deleting an image still in use.
 */
export function mediaUsageCounts(data: unknown, paths: string[]): Record<string, number> {
  const known = new Set(paths);
  const counts: Record<string, number> = {};
  for (const p of paths) counts[p] = 0;

  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (known.has(value)) counts[value] = (counts[value] ?? 0) + 1;
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const v of Object.values(value)) walk(v);
    }
  };

  walk(data);
  return counts;
}
