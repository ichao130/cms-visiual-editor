import { describe, expect, it } from "vitest";
import { renameSection } from "../src/section.js";

describe("renameSection", () => {
  it("updates data-section and a default data-label", () => {
    const html = `<section data-section="promo" data-label="promo"><h2>x</h2></section>`;
    expect(renameSection(html, "promo", "campaign")).toBe(
      `<section data-section="campaign" data-label="campaign"><h2>x</h2></section>`,
    );
  });

  it("keeps a customized data-label", () => {
    const html = `<section data-section="promo" data-label="期間限定キャンペーン"></section>`;
    expect(renameSection(html, "promo", "campaign")).toBe(
      `<section data-section="campaign" data-label="期間限定キャンペーン"></section>`,
    );
  });

  it("adds data-section when it is missing", () => {
    const html = `<section class="promo"></section>`;
    expect(renameSection(html, "promo", "campaign")).toBe(
      `<section class="promo" data-section="campaign"></section>`,
    );
  });

  it("only touches the first section's opening tag", () => {
    const html = `<section data-section="promo">a</section>\n<section data-section="other">b</section>`;
    expect(renameSection(html, "promo", "campaign")).toBe(
      `<section data-section="campaign">a</section>\n<section data-section="other">b</section>`,
    );
  });

  it("preserves single quotes and surrounding formatting", () => {
    const html = `<section  data-section='promo'  data-label='promo' >`;
    expect(renameSection(html, "promo", "campaign")).toBe(
      `<section  data-section='campaign'  data-label='campaign' >`,
    );
  });
});
