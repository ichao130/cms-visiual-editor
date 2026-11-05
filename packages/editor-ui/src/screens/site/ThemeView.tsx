import { useEffect, useState } from "react";
import type { PcmsApi, ThemeSummary } from "../../api/types.js";
import type { Route } from "../../state/route.js";
import { ThemeImport } from "../../components/ThemeImport.js";
import { PreviewThumb } from "../../components/PreviewThumb.js";
import { renderHomeThumbnail } from "../../preview/render.js";
import { t } from "../../i18n.js";

interface Props {
  api: PcmsApi;
  siteId: string;
  onNavigate: (route: Route) => void;
}

/** Theme selection, and the entry point into the theme editor. */
export function ThemeView({ api, siteId, onNavigate }: Props) {
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [importing, setImporting] = useState(false);
  // A live mini-render of the site's home, shown on the in-use theme's card.
  const [currentThumb, setCurrentThumb] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.listThemes().then((ts) => active && setThemes(ts));
    void Promise.all([api.loadProject(), api.listMedia()]).then(([project, media]) => {
      if (!active) return;
      try {
        setCurrentThumb(renderHomeThumbnail(project, media));
      } catch {
        setCurrentThumb(null);
      }
    });
    return () => {
      active = false;
    };
  }, [api]);

  const openEditor = () => onNavigate({ screen: "themeEditor", siteId, mode: "visual" });

  return (
    <div className="pcms-themeview">
      <div className="pcms-listhead">
        <h1 className="pcms-page__title">{t("site.tab.theme")}</h1>
        <div className="pcms-listhead__actions">
          <button className="pcms-primary" onClick={openEditor}>
            {t("theme.openEditor")}
          </button>
          <button onClick={() => setImporting(true)}>{t("theme.import")}</button>
          <button disabled title={t("common.comingSoon")}>
            {t("theme.importFigma")}
          </button>
        </div>
      </div>

      <div className="pcms-cards">
        {themes.map((th) => (
          <div key={th.id} className={`pcms-themecard${th.current ? " is-current" : ""}`}>
            <PreviewThumb html={th.current ? currentThumb : null} />
            <div className="pcms-themecard__name">
              {th.name}
              {th.current && <span className="pcms-badge is-live">{t("theme.current")}</span>}
            </div>
            <p className="pcms-themecard__desc">{th.description}</p>
            <div className="pcms-themecard__actions">
              {th.current ? (
                <button className="pcms-primary" onClick={openEditor}>
                  {t("theme.edit")}
                </button>
              ) : (
                <button disabled title={t("common.comingSoon")}>
                  {t("theme.use")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="pcms-note">{t("theme.figmaRoadmap")}</p>

      {importing && <ThemeImport api={api} onClose={() => setImporting(false)} />}
    </div>
  );
}
