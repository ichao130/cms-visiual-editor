import { useEffect, useState } from "react";
import type { AccountView, PcmsApi, ProjectSummary } from "../api/types.js";
import type { Route } from "../state/route.js";
import { CreateCard } from "../components/CreateCard.js";
import { t } from "../i18n.js";

interface Props {
  api: PcmsApi;
  account: AccountView | null;
  onNavigate: (route: Route) => void;
  /** Tell the shell to reload its project/site index after a change. */
  onShellChange: () => void;
}

/** Dashboard: the operator's projects plus their account summary. */
export function DashboardScreen({ api, account, onNavigate, onShellChange }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    let active = true;
    void api.listProjects().then((p) => active && setProjects(p));
    return () => {
      active = false;
    };
  }, [api]);

  const onCreate = (name: string) => {
    void api.createProject(name).then((project) => {
      onShellChange();
      onNavigate({ screen: "project", projectId: project.id });
    });
  };

  return (
    <div className="pcms-page">
      <div className="pcms-page__main">
        <h1 className="pcms-page__title">{t("dashboard.projects")}</h1>
        <div className="pcms-cards">
          {projects.map((p) => (
            <button
              key={p.id}
              className="pcms-card"
              onClick={() => onNavigate({ screen: "project", projectId: p.id })}
            >
              <span className="pcms-card__title">{p.name}</span>
              <span className="pcms-card__meta">
                {p.siteCount} {t("dashboard.sites")}
              </span>
            </button>
          ))}
          <CreateCard
            label={t("dashboard.newProject")}
            placeholder={t("dashboard.newName")}
            onCreate={onCreate}
          />
        </div>
      </div>

      <aside className="pcms-page__side">
        <h2 className="pcms-col__title">{t("account.title")}</h2>
        {account ? (
          <div className="pcms-account">
            <div className="pcms-account__row">
              <span className="pcms-account__label">{t("account.name")}</span>
              <span>{account.name}</span>
            </div>
            <div className="pcms-account__row">
              <span className="pcms-account__label">{t("account.email")}</span>
              <span>{account.email}</span>
            </div>
            <div className="pcms-account__row">
              <span className="pcms-account__label">{t("account.plan")}</span>
              <span>{account.plan}</span>
            </div>
            <div className="pcms-account__ai">
              <span className="pcms-account__label">{t("account.ai")}</span>
              <div className="pcms-meter">
                <div
                  className="pcms-meter__fill"
                  style={{ width: `${Math.min(100, (account.ai.used / account.ai.limit) * 100)}%` }}
                />
              </div>
              <span className="pcms-account__aitext">
                {account.ai.used} / {account.ai.limit}
              </span>
            </div>
          </div>
        ) : (
          <p className="pcms-empty">{t("common.loading")}</p>
        )}
      </aside>
    </div>
  );
}
