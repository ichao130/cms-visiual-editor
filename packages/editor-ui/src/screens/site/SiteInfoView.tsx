import { useEffect, useState } from "react";
import type { PcmsApi, SiteStats } from "../../api/types.js";
import { t } from "../../i18n.js";

interface Props {
  api: PcmsApi;
  siteId: string;
}

/** Site overview: analytics tiles, a visit chart, and recent inquiries. */
export function SiteInfoView({ api, siteId }: Props) {
  const [stats, setStats] = useState<SiteStats | null>(null);

  useEffect(() => {
    let active = true;
    void api.loadSiteStats(siteId).then((s) => active && setStats(s));
    return () => {
      active = false;
    };
  }, [api, siteId]);

  if (!stats) return <p className="pcms-empty">{t("common.loading")}</p>;

  return (
    <div className="pcms-info">
      <p className="pcms-note">{t("info.mockNote")}</p>

      <div className="pcms-tiles">
        <Tile label={t("site.stat.visits")} value={stats.visits.toLocaleString()} />
        <Tile label={t("site.stat.inquiries")} value={String(stats.inquiries)} />
        <Tile label={t("site.stat.pages")} value={String(stats.pages)} />
      </div>

      <section className="pcms-info__block">
        <h2 className="pcms-col__title">{t("info.visitsChart")}</h2>
        <VisitChart series={stats.visitSeries} />
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
