import { afterEach, describe, expect, it } from "vitest";
import {
  Ga4StatsProvider,
  MockStatsProvider,
  MokkedaStatsProvider,
  lastNDates,
  makeStatsProvider,
  normalizeGa4,
  type Http,
  type HttpResponse,
} from "../src/analytics/stats.js";

const ok = (body: unknown): HttpResponse => ({ ok: true, status: 200, json: async () => body });

describe("lastNDates", () => {
  it("returns the window oldest-first, ending today (UTC)", () => {
    const dates = lastNDates(3, new Date("2026-02-10T08:00:00Z"));
    expect(dates).toEqual(["2026-02-08", "2026-02-09", "2026-02-10"]);
  });
});

const ga = (isoDate: string) => isoDate.replace(/-/g, "");

describe("normalizeGa4", () => {
  it("maps YYYYMMDD rows onto the window and sums the total", () => {
    // Build rows for the two most recent days of the current window.
    const win = lastNDates(3);
    const json = {
      rows: [
        { dimensionValues: [{ value: ga(win[1]) }], metricValues: [{ value: "12" }] },
        { dimensionValues: [{ value: ga(win[2]) }], metricValues: [{ value: "20" }] },
      ],
    };
    const stats = normalizeGa4(json, 3);
    expect(stats.source).toBe("ga4");
    expect(stats.days).toBe(3);
    expect(stats.series).toHaveLength(3);
    // The earliest day had no row → 0; the two present days carry through.
    expect(stats.series.map((p) => p.visits).slice(-2)).toEqual([12, 20]);
    expect(stats.total).toBe(32);
  });

  it("treats a missing rows array as all-zero", () => {
    const stats = normalizeGa4({}, 2);
    expect(stats.total).toBe(0);
    expect(stats.series.every((p) => p.visits === 0)).toBe(true);
  });
});

describe("MockStatsProvider", () => {
  it("is deterministic for a site and spans the requested days", async () => {
    const p = new MockStatsProvider();
    const a = await p.fetch({ siteId: "site-cafe", days: 14 });
    const b = await p.fetch({ siteId: "site-cafe", days: 14 });
    expect(a).toEqual(b);
    expect(a.series).toHaveLength(14);
    expect(a.source).toBe("mock");
    expect(a.total).toBeGreaterThan(0);
  });

  it("differs between sites", async () => {
    const p = new MockStatsProvider();
    const a = await p.fetch({ siteId: "site-a", days: 7 });
    const b = await p.fetch({ siteId: "site-b", days: 7 });
    expect(a.total).not.toBe(b.total);
  });
});

describe("Ga4StatsProvider", () => {
  it("calls runReport with a bearer token and normalizes the result", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const latest = lastNDates(2)[1];
    const http: Http = async (url, init) => {
      seenUrl = url;
      seenAuth = init?.headers?.Authorization ?? "";
      return ok({
        rows: [{ dimensionValues: [{ value: ga(latest) }], metricValues: [{ value: "9" }] }],
      });
    };
    const stats = await new Ga4StatsProvider("123", "tok", http).fetch({ siteId: "s", days: 2 });
    expect(seenUrl).toContain("/properties/123:runReport");
    expect(seenAuth).toBe("Bearer tok");
    expect(stats.source).toBe("ga4");
    expect(stats.total).toBe(9);
  });

  it("throws on a non-OK response", async () => {
    const http: Http = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await expect(
      new Ga4StatsProvider("1", "t", http).fetch({ siteId: "s", days: 1 }),
    ).rejects.toThrow(/GA4 Data API error: 403/);
  });
});

describe("MokkedaStatsProvider", () => {
  it("requests one report per day and sums the metric", async () => {
    const urls: string[] = [];
    const http: Http = async (url) => {
      urls.push(url);
      return ok({ pv: 10 });
    };
    const stats = await new MokkedaStatsProvider("https://api.mokkeda.test/", "k", http).fetch({
      siteId: "m1",
      days: 3,
    });
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("site_id=m1");
    expect(urls[0]).toContain("day_from=");
    expect(stats.source).toBe("mokkeda");
    expect(stats.total).toBe(30);
    expect(stats.series).toHaveLength(3);
  });

  it("reads a configurable metric field", async () => {
    const http: Http = async () => ok({ visits: 5, pv: 99 });
    const stats = await new MokkedaStatsProvider("https://x/", "k", http, "visits").fetch({
      siteId: "m",
      days: 2,
    });
    expect(stats.total).toBe(10);
  });
});

describe("makeStatsProvider", () => {
  const keys = ["GA4_PROPERTY_ID", "GA4_ACCESS_TOKEN", "MOKKEDA_API_BASE", "MOKKEDA_API_KEY"];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const clear = () => keys.forEach((k) => delete process.env[k]);

  it("falls back to the mock when nothing is configured", () => {
    clear();
    expect(makeStatsProvider(process.env).name).toBe("mock");
  });

  it("prefers GA4 when its credentials are set", () => {
    clear();
    process.env.GA4_PROPERTY_ID = "1";
    process.env.GA4_ACCESS_TOKEN = "t";
    expect(makeStatsProvider(process.env).name).toBe("ga4");
  });

  it("uses MOKKEDA when only its credentials are set", () => {
    clear();
    process.env.MOKKEDA_API_BASE = "https://x/";
    process.env.MOKKEDA_API_KEY = "k";
    expect(makeStatsProvider(process.env).name).toBe("mokkeda");
  });
});
