import { describe, expect, it } from "vitest";
import type { SectionInstance, SiteSettings } from "@pcms/shared";
import {
  changeBlockType,
  changeInstanceType,
  migrateBlockType,
  migrateInstanceType,
  type TypeChange,
} from "../src/state/mutations.js";

const hero = (): SectionInstance => ({
  id: "hero-1",
  type: "hero",
  hidden: true,
  style: { bg: "#fff", paddingY: "lg" },
  fields: { heading: "朝の一杯", lead: "自家焙煎", cta_label: "見る" },
  repeats: { slides: [{ img: "a.jpg" }] },
  blocks: [
    { id: "f1", type: "feature", fields: { title: "豆" } },
    { id: "s1", type: "spacer", fields: { h: "40" } },
  ],
});

describe("migrateInstanceType", () => {
  it("carries over fields the new type still declares, drops the rest", () => {
    const change: TypeChange = { type: "notice", fieldPaths: ["heading"], blockTypes: null };
    const next = migrateInstanceType(hero(), change);
    expect(next.type).toBe("notice");
    expect(next.fields).toEqual({ heading: "朝の一杯" }); // lead/cta_label dropped
  });

  it("keeps id, hidden and style (type-agnostic)", () => {
    const next = migrateInstanceType(hero(), { type: "notice", fieldPaths: [] });
    expect(next.id).toBe("hero-1");
    expect(next.hidden).toBe(true);
    expect(next.style).toEqual({ bg: "#fff", paddingY: "lg" });
    expect(next.fields).toBeUndefined(); // nothing matched
  });

  it("drops repeats the new type does not declare", () => {
    const kept = migrateInstanceType(hero(), { type: "x", fieldPaths: [], repeatNames: ["slides"] });
    expect(kept.repeats).toEqual({ slides: [{ img: "a.jpg" }] });
    const dropped = migrateInstanceType(hero(), { type: "x", fieldPaths: [], repeatNames: [] });
    expect(dropped.repeats).toBeUndefined();
  });

  it("blockTypes null drops blocks, [] keeps all, [..] filters to allowed", () => {
    expect(migrateInstanceType(hero(), { type: "x", fieldPaths: [], blockTypes: null }).blocks).toBeUndefined();
    expect(migrateInstanceType(hero(), { type: "x", fieldPaths: [], blockTypes: [] }).blocks).toHaveLength(2);
    const filtered = migrateInstanceType(hero(), { type: "x", fieldPaths: [], blockTypes: ["feature"] });
    expect(filtered.blocks?.map((b) => b.type)).toEqual(["feature"]);
  });

  it("does not mutate the input instance", () => {
    const inst = hero();
    migrateInstanceType(inst, { type: "notice", fieldPaths: ["heading"], blockTypes: null });
    expect(inst.type).toBe("hero");
    expect(inst.fields).toEqual({ heading: "朝の一杯", lead: "自家焙煎", cta_label: "見る" });
    expect(inst.blocks).toHaveLength(2);
  });
});

describe("migrateBlockType", () => {
  it("re-types a block, keeping only fields the new type declares", () => {
    const next = migrateBlockType({ id: "f1", type: "feature", fields: { title: "豆", icon: "★" } }, "logo", ["title"]);
    expect(next).toEqual({ id: "f1", type: "logo", fields: { title: "豆" } });
  });

  it("drops fields entirely when none match", () => {
    expect(migrateBlockType({ id: "f1", type: "feature", fields: { title: "豆" } }, "spacer", [])).toEqual({
      id: "f1",
      type: "spacer",
    });
  });
});

describe("changeInstanceType / changeBlockType (settings-level)", () => {
  const settings = (): SiteSettings => ({
    pages: { home: { instances: [hero()] } },
    regions: { header: [{ id: "nav-1", type: "nav", fields: { brand: "KUMITO" } }] },
  });

  it("swaps a body section in place (same id/position)", () => {
    const next = changeInstanceType(settings(), { kind: "body", pageId: "home" }, "hero-1", {
      type: "notice",
      fieldPaths: ["heading"],
      blockTypes: null,
    });
    const inst = next.pages.home?.instances?.[0];
    expect(inst?.id).toBe("hero-1");
    expect(inst?.type).toBe("notice");
    expect(inst?.fields).toEqual({ heading: "朝の一杯" });
  });

  it("swaps a region section too", () => {
    const next = changeInstanceType(settings(), { kind: "region", region: "header" }, "nav-1", {
      type: "logo-bar",
      fieldPaths: [],
    });
    expect(next.regions?.header?.[0]?.type).toBe("logo-bar");
  });

  it("swaps a nested block in place", () => {
    const next = changeBlockType(settings(), { kind: "body", pageId: "home" }, "hero-1", "f1", "logo", ["title"]);
    const blocks = next.pages.home?.instances?.[0]?.blocks;
    expect(blocks?.[0]).toEqual({ id: "f1", type: "logo", fields: { title: "豆" } });
    expect(blocks?.[1]).toEqual({ id: "s1", type: "spacer", fields: { h: "40" } }); // untouched
  });
});
