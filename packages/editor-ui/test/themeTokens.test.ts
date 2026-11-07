import { describe, expect, it } from "vitest";
import type { SiteSettings } from "@pcms/shared";
import { clearThemeOverrides, setThemeToken } from "../src/state/mutations.js";

const base = (): SiteSettings => ({ pages: {} });

describe("theme token overrides", () => {
  it("sets a token into the right group", () => {
    const next = setThemeToken(base(), "colors", "primary", "#f00");
    expect(next.theme).toEqual({ colors: { primary: "#f00" } });
  });

  it("merges tokens across groups and keys", () => {
    let s = setThemeToken(base(), "colors", "primary", "#f00");
    s = setThemeToken(s, "colors", "accent", "#0f0");
    s = setThemeToken(s, "fonts", "heading", "serif");
    expect(s.theme).toEqual({
      colors: { primary: "#f00", accent: "#0f0" },
      fonts: { heading: "serif" },
    });
  });

  it("clearing a token with '' drops the key, then the empty group, then theme", () => {
    let s = setThemeToken(base(), "colors", "primary", "#f00");
    s = setThemeToken(s, "colors", "accent", "#0f0");
    s = setThemeToken(s, "colors", "accent", ""); // drop one key
    expect(s.theme).toEqual({ colors: { primary: "#f00" } });
    s = setThemeToken(s, "colors", "primary", ""); // drop the last key → whole theme gone
    expect(s.theme).toBeUndefined();
  });

  it("clearThemeOverrides removes every override", () => {
    const s = setThemeToken(base(), "spacing", "section", "6rem");
    expect(clearThemeOverrides(s).theme).toBeUndefined();
    // no-op when there's nothing to clear
    expect(clearThemeOverrides(base())).toEqual(base());
  });

  it("does not mutate the input settings", () => {
    const s = base();
    setThemeToken(s, "colors", "primary", "#f00");
    expect(s.theme).toBeUndefined();
  });
});
