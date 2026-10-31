import { describe, expect, it } from "vitest";
import { normalizePath } from "../src/screens/site/RedirectsView.js";

describe("normalizePath", () => {
  it("keeps a leading-slash path unchanged", () => {
    expect(normalizePath("/post/old/")).toBe("/post/old/");
  });

  it("adds a leading slash when missing", () => {
    expect(normalizePath("post/old/")).toBe("/post/old/");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePath("  /a/  ")).toBe("/a/");
  });

  it("leaves a blank value blank (not just a slash)", () => {
    expect(normalizePath("")).toBe("");
    expect(normalizePath("   ")).toBe("");
  });
});
