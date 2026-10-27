import { useEffect, useState } from "react";
import type { PcmsApi, SiteSummary } from "../api/types.js";
import type { Route } from "../state/route.js";
import { CreateCard } from "../components/CreateCard.js";
import { CardRenameForm } from "../components/CardRenameForm.js";
import { useToast } from "../state/ToastContext.js";
import { t } from "../i18n.js";

interface Props {
  api: PcmsApi;
  projectId: string;
  onNavigate: (route: Route) => void;
  /** Tell the shell to reload its project/site index after a change. */
  onShellChange: () => void;
}

/** Project: the sites it contains, plus project-level basic settings. */
export function ProjectScreen({ api, projectId, onNavigate, onShellChange }: Props) {
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let active = true;
    void api.listSites(projectId).then((s) => active && setSites(s));
    return () => {
      active = false;
    };
  }, [api, projectId]);

  const onCreate = (name: string) => {
    void api.createSite(projectId, name).then((site) => {
      onShellChange();
      toast(t("toast.siteCreated").replace("{name}", name));
      onNavigate({ screen: "site", siteId: site.id, tab: "info" });
    });
  };

  const onDelete = (site: SiteSummary) => {
    if (!window.confirm(t("site.deleteConfirm").replace("{name}", site.name))) return;
    void api.deleteSite(projectId, site.id).then(() => {
      setSites((list) => list.filter((s) => s.id !== site.id));
      onShellChange();
      toast(t("toast.siteDeleted").replace("{name}", site.name));
    });
  };

  const onRename = (site: SiteSummary, name: string) => {
    setRenaming(null);
    void api.renameSite(projectId, site.id, name).then(() => {
      setSites((list) => list.map((s) => (s.id === site.id ? { ...s, name } : s)));
      onShellChange();
      toast(t("toast.siteRenamed").replace("{name}", name));
    });
  };

  return (
    <div className="pcms-page">
      <div className="pcms-page__main">
        <h1 className="pcms-page__title">{t("project.sites")}</h1>
        <div className="pcms-cards">
          {sites.map((s) =>
            renaming === s.id ? (
              <div key={s.id} className="pcms-cardwrap">
                <CardRenameForm
                  initial={s.name}
                  onRename={(name) => onRename(s, name)}
                  onCancel={() => setRenaming(null)}
                />
              </div>
            ) : (
              <div key={s.id} className="pcms-cardwrap">
                <button
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
                <div className="pcms-cardactions">
                  <button
                    type="button"
                    className="pcms-cardaction"
                    title={t("common.rename")}
                    aria-label={t("common.rename")}
                    onClick={() => setRenaming(s.id)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="pcms-cardaction"
                    title={t("common.delete")}
                    aria-label={t("common.delete")}
                    onClick={() => onDelete(s)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ),
          )}
          <CreateCard
            label={t("project.newSite")}
            placeholder={t("project.newName")}
            onCreate={onCreate}
          />
        </div>
      </div>

      <aside className="pcms-page__side">
        <h2 className="pcms-col__title">{t("project.basicSettings")}</h2>
        <p className="pcms-empty">{t("project.basicSettings.hint")}</p>
      </aside>
    </div>
  );
}
