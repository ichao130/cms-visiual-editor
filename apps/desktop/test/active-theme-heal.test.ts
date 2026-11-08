import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A dangling active-theme pointer — one that names an imported theme whose folder
 * was deleted on disk — must heal back to the bundled sample, so the app never
 * tries to load from a missing theme directory (and the theme list, sample
 * included, never comes up empty). Regression for "サンプルテーマがなくなった".
 */

const DATA = mkdtempSync(join(tmpdir(), "pcms-active-heal-"));

vi.mock("electron", () => ({
  app: { getPath: (name: string) => (name === "userData" ? DATA : join(DATA, name)) },
}));

let mod: typeof import("../src/main/theme-store.js");

beforeAll(async () => {
  mod = await import("../src/main/theme-store.js");
});

function writePointer(id: string): void {
  const site = join(DATA, "site");
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, "active-theme.json"), JSON.stringify({ id }), "utf8");
}

afterEach(() => writePointer(mod.SAMPLE_THEME_ID));

describe("activeThemeId self-heal", () => {
  it("falls back to the sample when the pointed-to theme folder is gone", () => {
    writePointer("branbery-ghost-999");
    expect(mod.activeThemeId()).toBe(mod.SAMPLE_THEME_ID);
  });

  it("keeps the sample pointer", () => {
    writePointer(mod.SAMPLE_THEME_ID);
    expect(mod.activeThemeId()).toBe(mod.SAMPLE_THEME_ID);
  });

  it("keeps a pointer to an imported theme that still exists on disk", () => {
    mkdirSync(mod.themeRoot("real-theme"), { recursive: true });
    writePointer("real-theme");
    expect(mod.activeThemeId()).toBe("real-theme");
  });
});
