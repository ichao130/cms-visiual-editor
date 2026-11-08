import { describe, expect, it } from "vitest";
import type { SiteSettings } from "@pcms/shared";
import {
  addRegionInstance,
  disablePageRegions,
  enablePageRegions,
  hasPageRegions,
  removeRegionInstance,
  setRegionInstanceField,
} from "../src/state/mutations.js";

function base(): SiteSettings {
  return {
    regions: {
      header: [{ id: "site-hd", type: "header" }],
      footer: [{ id: "site-ft", type: "footer" }],
    },
    pages: {
      index: {},
      about: {},
    },
  };
}

describe("per-page header/footer override", () => {
  it("enable seeds the page regions from the site-wide ones (deep copy)", () => {
    const next = enablePageRegions(base(), "about");
    expect(hasPageRegions(next, "about")).toBe(true);
    expect(next.pages.about!.regions).toEqual({
      header: [{ id: "site-hd", type: "header" }],
      footer: [{ id: "site-ft", type: "footer" }],
    });
    // Independent copy: the page's header is not the same array as the site's.
    expect(next.pages.about!.regions!.header).not.toBe(next.regions!.header);
    // The site-wide regions and other pages are untouched.
    expect(next.regions).toEqual(base().regions);
    expect(hasPageRegions(next, "index")).toBe(false);
  });

  it("only seeds regions the site actually manages", () => {
    const settings: SiteSettings = {
      regions: { header: [{ id: "h", type: "header" }] }, // no footer managed
      pages: { about: {} },
    };
    const next = enablePageRegions(settings, "about");
    expect(next.pages.about!.regions).toEqual({ header: [{ id: "h", type: "header" }] });
    expect(next.pages.about!.regions!.footer).toBeUndefined();
  });

  it("routes region edits to the page override, not the site-wide regions", () => {
    let s = enablePageRegions(base(), "about");
    s = addRegionInstance(s, "header", "banner", 0, "about");
    // The page's header gained the banner; the site-wide header is unchanged.
    expect(s.pages.about!.regions!.header!.map((i) => i.type)).toEqual(["banner", "header"]);
    expect(s.regions!.header!.map((i) => i.type)).toEqual(["header"]);

    s = setRegionInstanceField(s, "header", "site-hd", "heading", "固有", "about");
    expect(s.pages.about!.regions!.header!.find((i) => i.id === "site-hd")!.fields).toEqual({
      heading: "固有",
    });
    expect(s.regions!.header!.find((i) => i.id === "site-hd")!.fields).toBeUndefined();
  });

  it("without a pageId, region edits still target the site-wide regions", () => {
    const s = removeRegionInstance(base(), "footer", "site-ft");
    expect(s.regions!.footer).toEqual([]);
  });

  it("disable removes the override and reverts to the site-wide regions", () => {
    const enabled = enablePageRegions(base(), "about");
    const next = disablePageRegions(enabled, "about");
    expect(hasPageRegions(next, "about")).toBe(false);
    expect(next.pages.about).toEqual({});
    expect(next.regions).toEqual(base().regions);
  });

  it("disable is a no-op when the page has no override", () => {
    const settings = base();
    const next = disablePageRegions(settings, "index");
    expect(next.pages.index).toEqual({});
  });
});
