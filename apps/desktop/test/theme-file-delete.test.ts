import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectData } from "@pcms/editor-ui";
import type { ThemeBundle } from "@pcms/engine";

/**
 * Deleting a theme file from the code editor is recorded as a tombstone in the
 * per-theme overlay (the files on disk are never modified, CLAUDE.md). This
 * checks the desktop overlay honours the tombstone: a deleted section/asset
 * drops out of the bundle applied to the preview AND the published output.
 */

const DATA = mkdtempSync(join(tmpdir(), "pcms-theme-delete-"));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "userData" ? DATA : join(DATA, name)),
    isPackaged: false,
    getName: () => "pcms-test",
  },
}));

let overlaySet: typeof import("../src/main/theme-overlay.js").overlaySet;
let overlayClear: typeof import("../src/main/theme-overlay.js").overlayClear;
let applyThemeOverlay: typeof import("../src/main/theme-overlay.js").applyThemeOverlay;
let THEME_FILE_TOMBSTONE: string;

beforeAll(async () => {
  const ov = await import("../src/main/theme-overlay.js");
  overlaySet = ov.overlaySet;
  overlayClear = ov.overlayClear;
  applyThemeOverlay = ov.applyThemeOverlay;
  ({ THEME_FILE_TOMBSTONE } = await import("@pcms/engine"));
});

afterEach(() => overlayClear());

function sampleProject(): ProjectData {
  const theme: ThemeBundle = {
    config: { name: "t" } as ThemeBundle["config"],
    layout: "<!doctype html><html><body><main data-slot=\"content\"></main></body></html>",
    sections: { hero: "<section data-section=\"hero\"></section>", cta: "<section data-section=\"cta\"></section>" },
    blocks: {},
    templates: { index: "<div data-slot=\"content\"></div>" },
    assets: ["assets/style.css", "assets/extra.js"],
  };
  return {
    theme,
    previewCss: "body{}",
    themeAssets: {},
    themeTextAssets: { "assets/extra.js": "console.log(1)" },
  } as unknown as ProjectData;
}

describe("desktop theme overlay — tombstone", () => {
  it("drops a tombstoned section from the applied theme", () => {
    overlaySet("sections/cta.html", THEME_FILE_TOMBSTONE);
    const out = applyThemeOverlay(sampleProject());
    expect(Object.keys(out.theme.sections)).toContain("hero");
    expect(Object.keys(out.theme.sections)).not.toContain("cta");
  });

  it("drops a tombstoned asset from the asset list and text map", () => {
    overlaySet("assets/extra.js", THEME_FILE_TOMBSTONE);
    const out = applyThemeOverlay(sampleProject());
    expect(out.theme.assets).not.toContain("assets/extra.js");
    expect(out.themeTextAssets["assets/extra.js"]).toBeUndefined();
    expect(out.theme.assets).toContain("assets/style.css");
  });
});
