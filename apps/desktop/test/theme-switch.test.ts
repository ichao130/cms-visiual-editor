import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Regression for the desktop theme switch: importing a WordPress theme as a new
 * theme and switching to it must persist BOTH the active-theme pointer and the
 * new theme's preset layout, and listing/loading must reflect the active theme
 * (not fall back to the bundled sample). This covers the user-reported bug
 * "ビジュアルエディタがサンプルになっている" — the switch silently reverting to
 * sample-cafe — at the backend boundary the IPC layer calls.
 */

// A throwaway userData dir so the real app-data is never touched.
const DATA = mkdtempSync(join(tmpdir(), "pcms-theme-switch-"));

// Only app.getPath / isPackaged are exercised by the theme path; the rest are
// harmless stubs so project.ts and its transitive imports load under node.
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "userData" ? DATA : join(DATA, name)),
    isPackaged: false,
    getName: () => "pcms-test",
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  shell: { openPath: async () => "", openExternal: async () => undefined },
}));

// Cloud-backed modules are irrelevant to theme storage; stub them so no Firebase
// client is pulled in during the test.
vi.mock("../src/main/auth.js", () => ({ currentUid: () => null }));
vi.mock("../src/main/storageBackup.js", () => ({ storageBackupKv: () => ({}) }));

let createTheme: typeof import("../src/main/project.js").createTheme;
let setActiveTheme: typeof import("../src/main/project.js").setActiveTheme;
let listThemes: typeof import("../src/main/project.js").listThemes;
let loadProject: typeof import("../src/main/project.js").loadProject;

const SAMPLE = "sample-cafe";

const THEME_FILES: Record<string, string> = {
  "theme.json": JSON.stringify({ name: "Imported WP", colors: {}, fonts: {}, spacing: {} }),
  "layout.html": `<!doctype html><html><head><title data-field="site.name">x</title></head><body><main data-slot="content"></main></body></html>`,
  "templates/index.html": `<section data-section="hero"><h1 data-field data-type="text">見出し</h1></section>`,
  "assets/style.css": "body{color:#111}",
};

beforeAll(async () => {
  const mod = await import("../src/main/project.js");
  createTheme = mod.createTheme;
  setActiveTheme = mod.setActiveTheme;
  listThemes = mod.listThemes;
  loadProject = mod.loadProject;
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("desktop theme switch — createTheme + setActiveTheme persistence", () => {
  it("adds a theme without activating it", () => {
    const s = createTheme({ name: "Imported WP", source: "wordpress" }, THEME_FILES);
    expect(s.id).toBeTruthy();
    expect(s.current).toBe(false);
    expect(existsSync(join(DATA, "themes", s.id, "theme-meta.json"))).toBe(true);
    // Still on the sample until the caller switches.
    const active = listThemes().find((t) => t.current);
    expect(active?.id).toBe(SAMPLE);
  });

  it("switching persists the active pointer AND resets the layout to the new theme's preset", () => {
    const s = createTheme({ name: "Another WP", source: "wordpress" }, THEME_FILES);
    setActiveTheme(s.id);

    // The active-theme pointer is written and does NOT revert to sample.
    const pointer = JSON.parse(readFileSync(join(DATA, "site", "active-theme.json"), "utf8"));
    expect(pointer.id).toBe(s.id);

    // listThemes reflects the switch (source of truth for the UI's "in use").
    const current = listThemes().find((t) => t.current);
    expect(current?.id).toBe(s.id);
    expect(current?.id).not.toBe(SAMPLE);

    // Layout reset to the imported theme's preset (index renders its template).
    const settings = JSON.parse(readFileSync(join(DATA, "site", "settings.json"), "utf8"));
    expect(settings.pages.index.template).toBe("index");
    expect(settings.regions).toEqual({});

    // loadProject serves the imported theme — not the bundled sample.
    const project = loadProject();
    expect(project.theme.templates.index).toContain('data-section="hero"');
    expect(project.settings.pages.index.template).toBe("index");
  });

  it("switching back to the sample restores its default layout", () => {
    const s = createTheme({ name: "Third WP", source: "wordpress" }, THEME_FILES);
    setActiveTheme(s.id);
    setActiveTheme(SAMPLE);

    const pointer = JSON.parse(readFileSync(join(DATA, "site", "active-theme.json"), "utf8"));
    expect(pointer.id).toBe(SAMPLE);
    const current = listThemes().find((t) => t.current);
    expect(current?.id).toBe(SAMPLE);
  });

  it("refuses to activate a theme that does not exist on disk", () => {
    expect(() => setActiveTheme("no-such-theme")).toThrow();
  });
});
