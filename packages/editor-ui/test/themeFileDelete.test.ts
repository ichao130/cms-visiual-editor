import { beforeEach, describe, expect, it } from "vitest";

/**
 * Deleting a file from the code editor. A created part is dropped; an *original*
 * theme file is tombstoned in the working copy (the files on disk are untouched,
 * CLAUDE.md) so it disappears from the file tree, the theme bundle and the
 * output, and a theme reset restores it.
 */

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) ?? null) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const g = globalThis as { localStorage?: Storage };

async function freshApi() {
  g.localStorage = new MemStorage() as unknown as Storage;
  const { createMockApi } = await import("../src/api/mock.js");
  return createMockApi();
}

describe("code editor — delete file", () => {
  beforeEach(() => {
    g.localStorage = new MemStorage() as unknown as Storage;
  });

  it("removes an original theme file from the tree, bundle and output; reset restores it", async () => {
    const api = await freshApi();

    const before = await api.listThemeFiles();
    const original = before.find((f) => f.path.startsWith("sections/") && !f.custom);
    expect(original, "sample theme should ship section files").toBeTruthy();
    const path = original!.path;
    const sectionId = path.replace(/^sections\//, "").replace(/\.html$/, "");

    // The section exists in the theme bundle before deletion.
    expect(Object.keys((await api.loadProject()).theme.sections)).toContain(sectionId);

    await api.removeThemeFile(path);

    // Gone from the file tree…
    const after = await api.listThemeFiles();
    expect(after.find((f) => f.path === path)).toBeUndefined();
    // …and from the theme bundle used by the preview/output.
    expect(Object.keys((await api.loadProject()).theme.sections)).not.toContain(sectionId);

    // Reset restores the original (the disk file was never touched).
    await api.resetTheme();
    const restored = await api.listThemeFiles();
    expect(restored.find((f) => f.path === path)).toBeTruthy();
    expect(Object.keys((await api.loadProject()).theme.sections)).toContain(sectionId);
  });

  it("drops a created part outright (no tombstone needed)", async () => {
    const api = await freshApi();
    await api.writeThemeFile("sections/temp.html", '<section data-section="temp"></section>');
    expect((await api.listThemeFiles()).find((f) => f.path === "sections/temp.html")).toBeTruthy();

    await api.removeThemeFile("sections/temp.html");
    expect((await api.listThemeFiles()).find((f) => f.path === "sections/temp.html")).toBeUndefined();
  });

  it("deleted original stays gone after an unrelated edit is saved", async () => {
    const api = await freshApi();
    const list = await api.listThemeFiles();
    const victim = list.find((f) => f.path.startsWith("sections/") && !f.custom)!.path;
    const other = list.find((f) => f.path.startsWith("sections/") && !f.custom && f.path !== victim)!.path;

    await api.removeThemeFile(victim);
    // Edit a different original — the merge must not resurrect the deleted one.
    await api.writeThemeFile(other, await api.readThemeFile(other));

    const after = await api.listThemeFiles();
    expect(after.find((f) => f.path === victim)).toBeUndefined();
    expect(after.find((f) => f.path === other)?.edited).toBe(true);
  });
});
