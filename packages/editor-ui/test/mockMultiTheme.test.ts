import { beforeEach, describe, expect, it } from "vitest";

/**
 * Multi-theme behaviour of the browser mock: an imported theme is added as a
 * new, separate theme (the sample stays), switching to it renders its own
 * templates and resets the page layout, while content is always preserved.
 * Mirrors the desktop project.ts createTheme/setActiveTheme contract.
 */

// Minimal localStorage shim — the mock persists through it, and the test env is
// "node" (no DOM). Installed before importing the mock so its lazy reads work.
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

const IMPORTED_FILES = {
  "theme.json": JSON.stringify({ name: "Imported Cafe" }),
  "layout.html":
    '<!doctype html><html><head><link rel="stylesheet" href="/assets/style.css" /></head>' +
    '<body><main data-slot="content"></main></body></html>',
  "templates/index.html": '<section data-section data-label="見出し"><h1 data-field="t">やあ</h1></section>',
  "assets/style.css": "body{color:#0a0}",
};

describe("mock multi-theme", () => {
  beforeEach(() => {
    g.localStorage = new MemStorage() as unknown as Storage;
  });

  it("adds an imported theme alongside the sample and switches to it, keeping content", async () => {
    const api = await freshApi();

    const before = await api.listThemes();
    expect(before.find((t) => t.id === "sample-cafe")?.current).toBe(true);
    const contentBefore = (await api.loadProject()).content.length;
    expect(contentBefore).toBeGreaterThan(0);

    const summary = await api.createTheme({ name: "Imported Cafe", source: "wordpress" }, IMPORTED_FILES);
    expect(summary.id).not.toBe("sample-cafe");

    // Added but not yet active — the sample is still current.
    const added = await api.listThemes();
    expect(added.some((t) => t.id === summary.id)).toBe(true);
    expect(added.find((t) => t.id === "sample-cafe")?.current).toBe(true);

    await api.setActiveTheme(summary.id);

    const after = await api.listThemes();
    expect(after.find((t) => t.id === summary.id)?.current).toBe(true);
    expect(after.find((t) => t.id === "sample-cafe")?.current).toBe(false);

    const project = await api.loadProject();
    // The imported theme's own template and CSS are now active.
    expect(project.theme.templates.index).toContain('data-field="t"');
    expect(project.previewCss).toBe("body{color:#0a0}");
    // Layout reset to the new theme's default (index renders its template).
    expect(project.settings.pages.index?.template).toBe("index");
    // Content is preserved across the switch.
    expect(project.content.length).toBe(contentBefore);
  });

  it("restores the sample's layout when switched back, content intact", async () => {
    const api = await freshApi();
    const summary = await api.createTheme({ name: "Imported Cafe" }, IMPORTED_FILES);
    await api.setActiveTheme(summary.id);
    await api.setActiveTheme("sample-cafe");

    const project = await api.loadProject();
    expect((await api.listThemes()).find((t) => t.id === "sample-cafe")?.current).toBe(true);
    // The sample's rich home composition is back (hero section instance).
    expect(project.settings.pages.index?.instances?.length ?? 0).toBeGreaterThan(0);
    expect(project.content.length).toBeGreaterThan(0);
  });
});
