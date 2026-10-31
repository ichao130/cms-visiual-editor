import { useEffect, useState } from "react";
import type { ContentItem, ContentTypeDef, VisitStats } from "@pcms/shared";
import type { PcmsApi, SiteStats } from "../../api/types.js";
import { t } from "../../i18n.js";

interface Props {
  api: PcmsApi;
  siteId: string;
}

/** Real, locally-derived counts of the site's own content (not analytics). */
export interface ContentSummary {
  /** Live (non-draft) item count per content type, in type-definition order. */
  types: { name: string; label: string; count: number }[];
  /** Total draft items across all types. */
  drafts: number;
}

/** Count live items per type and total drafts from the project's content. */
export function summarizeContent(
  content: ContentItem[],
  contentTypes: ContentTypeDef[],
): ContentSummary {
  const live = new Map<string, number>();
  let drafts = 0;
  for (const item of content) {
    if (item.status === "draft") {
      drafts++;
      continue;
    }
    live.set(item.type, (live.get(item.type) ?? 0) + 1);
  }
  // List defined types first (in their order), then any ad-hoc types present.
  const seen = new Set<string>();
  const types: ContentSummary["types"] = [];
  for (const def of contentTypes) {
    seen.add(def.name);
    types.push({ name: def.name, label: def.label, count: live.get(def.name) ?? 0 });
  }
  for (const [name, count] of live) {
    if (!seen.has(name)) types.push({ name, label: name, count });
  }
  return { types, drafts };
}

/** Site overview: analytics tiles, a visit chart, and recent inquiries. */
export function SiteInfoView({ api, siteId }: Props) {
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [visit, setVisit] = useState<VisitStats | null>(null);
  const [content, setContent] = useState<ContentSummary | null>(null);
  const [mediaCount, setMediaCount] = useState(0);
  const [redirectCount, setRedirectCount] = useState(0);

  useEffect(() => {
    let active = true;
    void api.loadSiteStats(siteId).then((s) => active && setStats(s));
    setVisit(null);
    void api.fetchVisitStats(siteId).then((v) => active && setVisit(v));
    void Promise.all([api.loadProject(), api.listMedia(), api.loadRedirects()]).then(
      ([project, media, redirects]) => {
        if (!active) return;
        setContent(summarizeContent(project.content, project.contentTypes));
        setMediaCount(media.length);
        setRedirectCount(redirects.length);
      },
    );
    return () => {
      active = false;
    };
  }, [api, siteId]);

  if (!stats) return <p className="pcms-empty">{t("common.loading")}</p>;

  return (
    <div className="pcms-info">
      {content && (
        <section className="pcms-info__block">
          <h2 className="pcms-col__title">{t("info.contentOverview")}</h2>
          <div className="pcms-tiles">
            {content.types.map((ct) => (
              <Tile key={ct.name} label={ct.label} value={String(ct.count)} />
            ))}
            <Tile label={t("info.drafts")} value={String(content.drafts)} />
            <Tile label={t("info.media")} value={String(mediaCount)} />
            <Tile label={t("info.redirects")} value={String(redirectCount)} />
          </div>
        </section>
      )}

      <h2 className="pcms-col__title">{t("info.analytics")}</h2>
      <p className="pcms-note">
        {visit == null
          ? t("common.loading")
          : visit.source === "mock"
            ? t("info.mockNote")
            : `${providerLabel(visit.source)} 連携・直近${visit.days}日`}
      </p>

      <div className="pcms-tiles">
        <Tile
          label={t("site.stat.visits")}
          value={(visit ? visit.total : stats.visits).toLocaleString()}
        />
        <Tile label={t("site.stat.inquiries")} value={String(stats.inquiries)} />
        <Tile label={t("site.stat.pages")} value={String(stats.pages)} />
      </div>

      <section className="pcms-info__block">
        <h2 className="pcms-col__title">{t("info.visitsChart")}</h2>
        <VisitChart series={(visit ? visit.series.map((p) => p.visits) : stats.visitSeries)} />
      </section>

      <section className="pcms-info__block">
        <h2 className="pcms-col__title">{t("info.recentInquiries")}</h2>
        {stats.recentInquiries.length === 0 ? (
          <p className="pcms-empty">{t("info.noInquiries")}</p>
        ) : (
          <ul className="pcms-inquiries">
            {stats.recentInquiries.map((q) => (
              <li key={q.id} className="pcms-inquiries__row">
                <div className="pcms-inquiries__head">
                  <span className="pcms-inquiries__name">{q.name}</span>
                  <span className="pcms-inquiries__date">{formatDate(q.receivedAt)}</span>
                </div>
                <div className="pcms-inquiries__msg">{q.message}</div>
                <div className="pcms-inquiries__email">{q.email}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Human label for an analytics provider id. */
function providerLabel(source: string): string {
  if (source === "ga4") return "Google アナリティクス";
  if (source === "mokkeda") return "MOKKEDA";
  return source;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="pcms-tile">
      <span className="pcms-tile__value">{value}</span>
      <span className="pcms-tile__label">{label}</span>
    </div>
  );
}

/** A small inline-SVG bar chart (no chart dependency). */
function VisitChart({ series }: { series: number[] }) {
  if (series.length === 0) return <p className="pcms-empty">{t("info.noData")}</p>;
  const w = 480;
  const h = 120;
  const max = Math.max(...series, 1);
  const gap = 4;
  const barW = (w - gap * (series.length - 1)) / series.length;
  return (
    <svg className="pcms-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("info.visitsChart")}>
      {series.map((v, i) => {
        const bh = Math.round((v / max) * (h - 16));
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={h - bh}
            width={barW}
            height={bh}
            rx={3}
            fill="var(--pcms-accent)"
          />
        );
      })}
    </svg>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
