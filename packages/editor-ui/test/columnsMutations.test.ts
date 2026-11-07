import { describe, expect, it } from "vitest";
import type { SiteSettings } from "@pcms/shared";
import {
  addBlock,
  addColumnChild,
  equalRatio,
  moveColumnChild,
  removeColumnChild,
  setColumnChildField,
  setColumnCount,
  setColumnsRatio,
  type InstanceLoc,
} from "../src/state/mutations.js";

const loc: InstanceLoc = { kind: "body", pageId: "index" };

/** A page with one section instance "sec-1" holding one layout block "col-1". */
function base(columns: unknown): SiteSettings {
  return {
    pages: {
      index: {
        instances: [
          {
            id: "sec-1",
            type: "body",
            blocks: [{ id: "col-1", type: "columns", fields: { ratio: "1:1" }, columns }],
          },
        ],
      },
    },
  } as unknown as SiteSettings;
}

function layoutBlock(s: SiteSettings) {
  return s.pages.index!.instances!.find((i) => i.id === "sec-1")!.blocks!.find((b) => b.id === "col-1")!;
}

describe("equalRatio", () => {
  it("builds an equal-width ratio string", () => {
    expect(equalRatio(2)).toBe("1:1");
    expect(equalRatio(3)).toBe("1:1:1");
    expect(equalRatio(0)).toBe("1");
  });
});

describe("addBlock seedColumns", () => {
  it("seeds empty columns and an equal ratio for a layout block", () => {
    const s = addBlock({ pages: { index: { instances: [{ id: "sec-1", type: "body" }] } } } as unknown as SiteSettings, loc, "sec-1", "columns", undefined, 2);
    const b = s.pages.index!.instances![0]!.blocks![0]!;
    expect(b.type).toBe("columns");
    expect(b.columns).toEqual([[], []]);
    expect(b.fields?.ratio).toBe("1:1");
  });

  it("creates a plain block (no columns) without a seed", () => {
    const s = addBlock({ pages: { index: { instances: [{ id: "sec-1", type: "body" }] } } } as unknown as SiteSettings, loc, "sec-1", "text");
    const b = s.pages.index!.instances![0]!.blocks![0]!;
    expect(b.type).toBe("text");
    expect(b.columns).toBeUndefined();
    expect(b.fields).toBeUndefined();
  });
});

describe("setColumnCount", () => {
  it("adds empty columns and resets the ratio to equal", () => {
    const s = setColumnCount(base([[{ id: "a", type: "text" }]]), loc, "sec-1", "col-1", 3);
    const b = layoutBlock(s);
    expect(b.columns).toHaveLength(3);
    expect(b.columns![0]).toEqual([{ id: "a", type: "text" }]); // kept
    expect(b.columns![1]).toEqual([]);
    expect(b.fields?.ratio).toBe("1:1:1");
  });

  it("drops trailing columns when reducing the count", () => {
    const s = setColumnCount(base([[], [{ id: "x", type: "text" }], []]), loc, "sec-1", "col-1", 2);
    expect(layoutBlock(s).columns).toHaveLength(2);
    expect(layoutBlock(s).fields?.ratio).toBe("1:1");
  });

  it("clamps to the 1..6 range", () => {
    expect(layoutBlock(setColumnCount(base([[], []]), loc, "sec-1", "col-1", 0)).columns).toHaveLength(1);
    expect(layoutBlock(setColumnCount(base([[], []]), loc, "sec-1", "col-1", 9)).columns).toHaveLength(6);
  });
});

describe("setColumnsRatio", () => {
  it("sets the width ratio without touching columns", () => {
    const s = setColumnsRatio(base([[], []]), loc, "sec-1", "col-1", "2:1");
    expect(layoutBlock(s).fields?.ratio).toBe("2:1");
    expect(layoutBlock(s).columns).toEqual([[], []]);
  });
});

describe("column child mutations", () => {
  it("adds a child into the given column", () => {
    const s = addColumnChild(base([[], []]), loc, "sec-1", "col-1", 1, "heading");
    expect(layoutBlock(s).columns![0]).toEqual([]);
    expect(layoutBlock(s).columns![1]).toHaveLength(1);
    expect(layoutBlock(s).columns![1]![0]!.type).toBe("heading");
  });

  it("removes a child by id from its column", () => {
    const start = base([[{ id: "a", type: "text" }, { id: "b", type: "heading" }], []]);
    const s = removeColumnChild(start, loc, "sec-1", "col-1", 0, "a");
    expect(layoutBlock(s).columns![0]).toEqual([{ id: "b", type: "heading" }]);
  });

  it("reorders children within a column", () => {
    const start = base([[{ id: "a", type: "text" }, { id: "b", type: "heading" }], []]);
    const s = moveColumnChild(start, loc, "sec-1", "col-1", 0, 0, 1);
    expect(layoutBlock(s).columns![0]!.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("edits a child's field", () => {
    const start = base([[{ id: "a", type: "heading", fields: { text: "旧" } }], []]);
    const s = setColumnChildField(start, loc, "sec-1", "col-1", 0, "a", "text", "新");
    expect(layoutBlock(s).columns![0]![0]!.fields).toEqual({ text: "新" });
  });

  it("does not mutate the original settings object", () => {
    const start = base([[{ id: "a", type: "text" }], []]);
    const snapshot = JSON.stringify(start);
    addColumnChild(start, loc, "sec-1", "col-1", 0, "heading");
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});
