import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Admin theme management on the desktop side: rename rewrites an imported theme's
 * meta, delete removes its folder and working-copy overlay. The bundled sample is
 * never renamable or deletable. (Deleting the *active* theme and its draft reset
 * is covered by the mock contract test; here we assert the on-disk mechanics for
 * a non-active imported theme, with no bundled theme needed.)
 */

const DATA = mkdtempSync(join(tmpdir(), "pcms-theme-mgmt-"));

vi.mock("electron", () => ({
  app: { getPath: (name: string) => (name === "userData" ? DATA : join(DATA, name)) },
}));

let store: typeof import("../src/main/theme-store.js");
let project: typeof import("../src/main/project.js");

beforeAll(async () => {
  store = await import("../src/main/theme-store.js");
  project = await import("../src/main/project.js");
  // Make the sample the active theme so our imported theme is never active.
  mkdirSync(join(DATA, "site"), { recursive: true });
  writeFileSync(join(DATA, "site", "active-theme.json"), JSON.stringify({ id: store.SAMPLE_THEME_ID }), "utf8");
});

afterEach(() => {
  writeFileSync(join(DATA, "site", "active-theme.json"), JSON.stringify({ id: store.SAMPLE_THEME_ID }), "utf8");
});

const FILES = {
  "theme.json": JSON.stringify({ name: "Imported" }),
  "layout.html": '<!doctype html><html><body><main data-slot="content"></main></body></html>',
};

describe("renameTheme / deleteTheme (desktop)", () => {
  it("renames an imported theme's meta", () => {
    const created = project.createTheme({ name: "Imported" }, FILES);
    project.renameTheme(created.id, "改名後");
    expect(store.readThemeMeta(created.id)?.name).toBe("改名後");
    expect(project.listThemes().find((t) => t.id === created.id)?.name).toBe("改名後");
  });

  it("deletes an imported theme folder and its overlay", () => {
    const created = project.createTheme({ name: "Imported" }, FILES);
    const dir = store.themeRoot(created.id);
    // A stray overlay file for this theme must be cleaned up too.
    writeFileSync(join(DATA, "site", `theme-overlay.${created.id}.json`), "{}", "utf8");
    expect(existsSync(dir)).toBe(true);

    project.deleteTheme(created.id);

    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(DATA, "site", `theme-overlay.${created.id}.json`))).toBe(false);
    expect(project.listThemes().some((t) => t.id === created.id)).toBe(false);
  });

  it("refuses to rename or delete the bundled sample", () => {
    expect(() => project.renameTheme(store.SAMPLE_THEME_ID, "X")).toThrow();
    expect(() => project.deleteTheme(store.SAMPLE_THEME_ID)).toThrow();
  });
});
