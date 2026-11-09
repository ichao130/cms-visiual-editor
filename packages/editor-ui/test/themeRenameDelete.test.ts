import { beforeEach, describe, expect, it } from "vitest";

/**
 * Managing imported themes from the admin screen: rename and delete. The bundled
 * sample is the fallback — it is never renamed or deleted. Deleting the active
 * theme falls back to the sample, and content is never part of a theme, so it is
 * untouched.
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

const FILES = {
  "theme.json": JSON.stringify({ name: "Imported" }),
  "layout.html": "<!doctype html><html><body><main data-slot=\"content\"></main></body></html>",
  "templates/index.html": '<section data-section="hero"><h1 data-field="x">Hi</h1></section>',
};

describe("admin — rename/delete imported theme", () => {
  beforeEach(() => {
    g.localStorage = new MemStorage() as unknown as Storage;
  });

  it("renames an imported theme in the list", async () => {
    const api = await freshApi();
    const created = await api.createTheme({ name: "Imported" }, FILES);

    await api.renameTheme(created.id, "新しい名前");
    const themes = await api.listThemes();
    expect(themes.find((t) => t.id === created.id)?.name).toBe("新しい名前");
  });

  it("rejects renaming or deleting the bundled sample", async () => {
    const api = await freshApi();
    await expect(api.renameTheme("sample-cafe", "X")).rejects.toThrow();
    await expect(api.deleteTheme("sample-cafe")).rejects.toThrow();
    // The sample is still present and selectable.
    expect((await api.listThemes()).some((t) => t.id === "sample-cafe")).toBe(true);
  });

  it("deletes an imported theme and drops it from the list", async () => {
    const api = await freshApi();
    const created = await api.createTheme({ name: "Imported" }, FILES);

    await api.deleteTheme(created.id);
    expect((await api.listThemes()).some((t) => t.id === created.id)).toBe(false);
  });

  it("deleting the active theme falls back to the sample", async () => {
    const api = await freshApi();
    const created = await api.createTheme({ name: "Imported" }, FILES);
    await api.setActiveTheme(created.id);
    expect((await api.listThemes()).find((t) => t.current)?.id).toBe(created.id);

    await api.deleteTheme(created.id);
    const themes = await api.listThemes();
    expect(themes.find((t) => t.current)?.id).toBe("sample-cafe");
    expect(themes.some((t) => t.id === created.id)).toBe(false);
  });
});
