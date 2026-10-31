import type { VisitPoint, VisitStats } from "@pcms/shared";

/**
 * Visit-stats providers behind the proxy. CLAUDE.md: reporting-API credentials
 * live here in the Firebase proxy, never in the app or site.json, and only the
 * siteId + window are forwarded — no server connection info or form data. The
 * provider reads real numbers from GA4 (Data API) or MOKKEDA; with nothing
 * configured, the deterministic mock keeps the evaluation build working offline.
 *
 * HTTP is injected so the GA4/MOKKEDA request shaping and response
 * normalization are unit-tested without network or credentials.
 */

export type { VisitPoint, VisitStats };

export interface StatsRequest {
  siteId: string;
  days: number;
}

export interface StatsProvider {
  readonly name: string;
  fetch(req: StatsRequest): Promise<VisitStats>;
}

/** Minimal fetch shape, so tests can inject a stub. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type Http = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The last `days` dates ending today (oldest first), as "YYYY-MM-DD". */
export function lastNDates(days: number, today = new Date()): string[] {
  const out: string[] = [];
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

const sum = (series: VisitPoint[]): number => series.reduce((a, p) => a + p.visits, 0);

/* ------------------------------------------------------------------ mock */

/** Deterministic pseudo-visits from the siteId + date, for the offline build. */
export class MockStatsProvider implements StatsProvider {
  readonly name = "mock";
  async fetch(req: StatsRequest): Promise<VisitStats> {
    const seed = [...req.siteId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
    const series = lastNDates(req.days).map((date, i) => {
      const h = Math.abs(((seed + i * 2654435761) ^ (seed >> 3)) % 60);
      return { date, visits: 40 + h };
    });
    return { total: sum(series), series, source: this.name, days: req.days };
  }
}

/* ------------------------------------------------------------------- GA4 */

/**
 * Normalize a GA4 Data API `runReport` response (date dimension + a visits
 * metric) into VisitStats. Rows can arrive unsorted, so they are keyed by date
 * and laid back over the requested window (missing days count as zero).
 */
export function normalizeGa4(json: unknown, days: number): VisitStats {
  const rows = (json as { rows?: unknown[] } | null)?.rows ?? [];
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const r = row as { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
    const raw = r.dimensionValues?.[0]?.value ?? "";
    // GA4 dates are "YYYYMMDD"; turn them into "YYYY-MM-DD".
    const date = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    byDate.set(date, num(r.metricValues?.[0]?.value));
  }
  const series = lastNDates(days).map((date) => ({ date, visits: byDate.get(date) ?? 0 }));
  return { total: sum(series), series, source: "ga4", days };
}

export class Ga4StatsProvider implements StatsProvider {
  readonly name = "ga4";
  constructor(
    private readonly propertyId: string,
    private readonly accessToken: string,
    private readonly http: Http,
  ) {}

  async fetch(req: StatsRequest): Promise<VisitStats> {
    const dates = lastNDates(req.days);
    const body = JSON.stringify({
      dateRanges: [{ startDate: dates[0], endDate: dates[dates.length - 1] }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }],
    });
    const res = await this.http(
      `https://analyticsdata.googleapis.com/v1beta/properties/${this.propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body,
      },
    );
    if (!res.ok) throw new Error(`GA4 Data API error: ${res.status}`);
    return normalizeGa4(await res.json(), req.days);
  }
}

/* --------------------------------------------------------------- MOKKEDA */

/**
 * MOKKEDA reporting adapter. MOKKEDA's report endpoint returns a per-site
 * summary for a date range (site_id, day_from, day_to → pv / cv / …), so the
 * daily series is built by requesting one day at a time. The exact base URL,
 * auth header and field name are the operator's account's, read from the env.
 */
export class MokkedaStatsProvider implements StatsProvider {
  readonly name = "mokkeda";
  constructor(
    private readonly base: string,
    private readonly apiKey: string,
    private readonly http: Http,
    /** Response field holding the visit count (default "pv"). */
    private readonly metric = "pv",
  ) {}

  private async day(siteId: string, date: string): Promise<number> {
    const url =
      `${this.base.replace(/\/+$/, "")}/report` +
      `?site_id=${encodeURIComponent(siteId)}&day_from=${date}&day_to=${date}`;
    const res = await this.http(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (!res.ok) throw new Error(`MOKKEDA API error: ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    return num(json[this.metric]);
  }

  async fetch(req: StatsRequest): Promise<VisitStats> {
    const series: VisitPoint[] = [];
    for (const date of lastNDates(req.days)) {
      series.push({ date, visits: await this.day(req.siteId, date) });
    }
    return { total: sum(series), series, source: this.name, days: req.days };
  }
}

/* -------------------------------------------------------------- selection */

/** Pick a provider from the environment; falls back to the offline mock. */
export function makeStatsProvider(
  env: NodeJS.ProcessEnv = process.env,
  http: Http = globalThis.fetch as unknown as Http,
): StatsProvider {
  if (env.GA4_PROPERTY_ID && env.GA4_ACCESS_TOKEN) {
    return new Ga4StatsProvider(env.GA4_PROPERTY_ID, env.GA4_ACCESS_TOKEN, http);
  }
  if (env.MOKKEDA_API_BASE && env.MOKKEDA_API_KEY) {
    return new MokkedaStatsProvider(
      env.MOKKEDA_API_BASE,
      env.MOKKEDA_API_KEY,
      http,
      env.MOKKEDA_METRIC || "pv",
    );
  }
  return new MockStatsProvider();
}
