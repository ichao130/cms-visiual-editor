import { describe, expect, it } from "vitest";
import { cssVarNames } from "../src/components/code-complete.js";

describe("cssVarNames", () => {
  it("extracts declared custom properties", () => {
    const css = ":root{--primary:#c33;--accent:#2a7;--font-heading:serif}";
    expect(cssVarNames(css).sort()).toEqual(["accent", "font-heading", "primary"]);
  });

  it("dedupes across rules and ignores var() references", () => {
    const css =
      ":root{--primary:#c33}\n.dark{--primary:#f55}\n.btn{color:var(--primary)}";
    expect(cssVarNames(css)).toEqual(["primary"]);
  });

  it("returns an empty list when there are no custom properties", () => {
    expect(cssVarNames(".a{color:red}")).toEqual([]);
    expect(cssVarNames("")).toEqual([]);
  });
});
