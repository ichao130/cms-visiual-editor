import { describe, expect, it } from "vitest";
import { uniqueFieldName } from "../src/screens/site/FormsView.js";

describe("uniqueFieldName", () => {
  it("names the first field field1", () => {
    expect(uniqueFieldName([])).toBe("field1");
  });

  it("increments past existing fieldN names", () => {
    expect(uniqueFieldName(["field1"])).toBe("field2");
  });

  it("skips a name that the count would collide with after a removal", () => {
    // field2 was removed; count is 2, but field3 already exists.
    expect(uniqueFieldName(["field1", "field3"])).toBe("field4");
  });

  it("ignores non-fieldN names when counting", () => {
    expect(uniqueFieldName(["name", "email"])).toBe("field3");
  });
});
