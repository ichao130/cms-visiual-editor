import { useEffect, useState } from "react";
import type { PcmsApi, SiteSummary } from "../api/types.js";
import type { Route } from "../state/route.js";
import { t } from "../i18n.js";

interface Props {
  api: PcmsApi;
  projectId: string;
  onNavigate: (route: Route) => void;
}

/** Project: the sites it contains, plus project-level basic settings. */
export function ProjectScreen({ api, projectId, onNavigate }: Props) {
  const [sites, setSites] = useState<SiteSummary[]>([]);

  useEffect(() => {
    let active = true;
    void api.listSites(projectId).then((s) => active && setSites(s));
    return () => {
      active = false;
    };
  }, [api, projectId]);

  return (
    <div className="pcms-page">
      <div className="pcms-page__main">
        <h1 className="pcms-page__title">{t("project.sites")}</h1>
        <div className="pcms-cards">
          {sites.map((s) => (
            <button
              key={s.id}
              className="pcms-card"
              onClick={() => onNavigate({ screen: "site", siteId: s.id, tab: "info" })}
            >
              <span className="pcms-card__title">{s.name}</span>
              <span className="pcms-card__meta">{s.domain}</span>
              <span className={`pcms-badge ${s.published ? "is-live" : "is-draft"}`}>
                {s.published ? t("site.published") : t("site.draft")}
              </span>
              <span className="pcms-card__stats">
                {t("site.stat.visits")}: {s.stats.visits.toLocaleString()} ・ {t("site.stat.inquiries")}: {s.stats.inquiries}
              </span>
            </button>
          ))}
          <button className="pcms-card pcms-card--add" disabled title={t("common.comingSoon")}>
            ＋ {t("project.newSite")}
          </button>
        </div>
      </div>

      <aside className="pcms-page__side">
        <h2 className="pcms-col__title">{t("project.basicSettings")}</h2>
        <p className="pcms-empty">{t("project.basicSettings.hint")}</p>
      </aside>
    </div>
  );
}
