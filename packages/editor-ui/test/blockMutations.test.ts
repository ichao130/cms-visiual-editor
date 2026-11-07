import { describe, expect, it } from "vitest";
import type { SiteSettings } from "@pcms/shared";
import {
  addBlock,
  duplicateBlock,
  moveBlock,
  removeBlock,
  setBlockField,
  type InstanceLoc,
} from "../src/state/mutations.js";

const bodyLoc: InstanceLoc = { kind: "body", pageId: "index" };
const footerLoc: InstanceLoc = { kind: "region", region: "footer" };

function base(): SiteSettings {
  return {
    pages: {
      index: {
        instances: [
          {
            id: "feat-1",
            type: "features",
            blocks: [
              { id: "b1", type: "feature", fields: { title: "A" } },
              { id: "b2", type: "feature", fields: { title: "B" } },
            ],
          },
        ],
      },
    },
    regions: {
      footer: [{ id: "f1", type: "footer", blocks: [{ id: "fb1", type: "link" }] }],
    },
  };
}

function blocksOf(s: SiteSettings, loc: InstanceLoc, sectionId: string) {
  const list =
    loc.kind === "body" ? s.pages[loc.pageId]?.instances ?? [] : s.regions?.[loc.region] ?? [];
  return list.find((i) => i.id === sectionId)?.blocks ?? [];
}

describe("nested-block mutations", () => {
  it("adds a block at a position with a fresh id", () => {
    const next = addBlock(base(), bodyLoc, "feat-1", "feature", 1);
    const ids = blocksOf(next, bodyLoc, "feat-1").map((b) => b.id);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe("b1");
    expect(ids[2]).toBe("b2");
    expect(ids[1]).not.toBe("b1"); // the new block sits between
    expect(blocksOf(next, bodyLoc, "feat-1")[1]!.type).toBe("feature");
  });

  it("removes a block by id", () => {
    const next = removeBlock(base(), bodyLoc, "feat-1", "b1");
    expect(blocksOf(next, bodyLoc, "feat-1").map((b) => b.id)).toEqual(["b2"]);
  });

  it("moves a block within the list", () => {
    const next = moveBlock(base(), bodyLoc, "feat-1", 1, 0);
    expect(blocksOf(next, bodyLoc, "feat-1").map((b) => b.id)).toEqual(["b2", "b1"]);
  });

  it("ignores an out-of-range move", () => {
    const next = moveBlock(base(), bodyLoc, "feat-1", 0, 5);
    expect(blocksOf(next, bodyLoc, "feat-1").map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("duplicates a block right after it with a new id and copied fields", () => {
    const next = duplicateBlock(base(), bodyLoc, "feat-1", "b1");
    const list = blocksOf(next, bodyLoc, "feat-1");
    expect(list.map((b) => b.id).slice(0, 1)).toEqual(["b1"]);
    expect(list).toHaveLength(3);
    expect(list[1]!.id).not.toBe("b1");
    expect(list[1]!.fields).toEqual({ title: "A" });
    // deep copy — editing the copy must not touch the original
    expect(list[1]!.fields).not.toBe(list[0]!.fields);
  });

  it("sets a block field without disturbing siblings", () => {
    const next = setBlockField(base(), bodyLoc, "feat-1", "b2", "title", "Z");
    const list = blocksOf(next, bodyLoc, "feat-1");
    expect(list[0]!.fields).toEqual({ title: "A" });
    expect(list[1]!.fields).toEqual({ title: "Z" });
  });

  it("operates on blocks inside a site-wide region instance too", () => {
    const added = addBlock(base(), footerLoc, "f1", "link", 1);
    expect(blocksOf(added, footerLoc, "f1")).toHaveLength(2);
    const edited = setBlockField(added, footerLoc, "f1", "fb1", "label", "会社概要");
    expect(blocksOf(edited, footerLoc, "f1")[0]!.fields).toEqual({ label: "会社概要" });
  });

  it("starts a blocks array for a section that had none", () => {
    const settings: SiteSettings = {
      pages: { index: { instances: [{ id: "s1", type: "features" }] } },
    };
    const next = addBlock(settings, bodyLoc, "s1", "feature");
    expect(blocksOf(next, bodyLoc, "s1")).toHaveLength(1);
  });
});
