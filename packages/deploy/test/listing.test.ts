import { describe, expect, it } from "vitest";
import { ListingBudget, MAX_LISTING_ENTRIES } from "../src/listing.js";

describe("ListingBudget", () => {
  it("stops collecting at the entry cap and marks truncated", () => {
    const b = new ListingBudget(3);
    expect(b.spent(0)).toBe(false);
    expect(b.spent(2)).toBe(false);
    expect(b.truncated).toBe(false);
    expect(b.spent(3)).toBe(true);
    expect(b.truncated).toBe(true);
  });

  it("stops descending past the depth limit", () => {
    const b = new ListingBudget(100, 2);
    expect(b.tooDeep(2)).toBe(false);
    expect(b.tooDeep(3)).toBe(true);
    expect(b.truncated).toBe(true);
  });

  it("stops once the time budget is spent", () => {
    const b = new ListingBudget(1000, 100, -1); // already past deadline
    expect(b.spent(0)).toBe(true);
    expect(b.truncated).toBe(true);
  });

  it("has a sane default cap", () => {
    expect(MAX_LISTING_ENTRIES).toBeGreaterThan(0);
    expect(new ListingBudget().maxEntries).toBe(MAX_LISTING_ENTRIES);
  });
});
