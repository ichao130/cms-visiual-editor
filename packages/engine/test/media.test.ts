import { describe, expect, it } from "vitest";
import { mediaUsageCounts } from "../src/index.js";

describe("mediaUsageCounts", () => {
  it("counts exact references across nested site data", () => {
    const data = {
      site: { logo: "media/logo.png", ogImage: "media/hero.jpg" },
      settings: {
        pages: {
          home: { hero: { image: "media/hero.jpg" } },
          about: { banner: { image: "media/hero.jpg" } },
        },
      },
      content: [{ fields: { photo: "media/unused-elsewhere.png" } }],
    };
    const counts = mediaUsageCounts(data, [
      "media/logo.png",
      "media/hero.jpg",
      "media/never.png",
    ]);
    expect(counts["media/logo.png"]).toBe(1);
    expect(counts["media/hero.jpg"]).toBe(3);
    expect(counts["media/never.png"]).toBe(0);
  });

  it("does not count a path that only appears as a substring", () => {
    const data = { html: '<img src="media/hero.jpg">' };
    const counts = mediaUsageCounts(data, ["media/hero.jpg"]);
    // The path is embedded in markup, not a field value, so it is not a ref.
    expect(counts["media/hero.jpg"]).toBe(0);
  });

  it("initializes every path to zero", () => {
    expect(mediaUsageCounts({}, ["a", "b"])).toEqual({ a: 0, b: 0 });
  });
});
