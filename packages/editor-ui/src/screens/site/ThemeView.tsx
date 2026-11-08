import { useCallback, useEffect, useState } from "react";
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
  const [switching, setSwitching] = useState(false);
  // A live mini-render of the site's home, shown on the in-use theme's card.
  const [currentThumb, setCurrentThumb] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // Load the theme list on its own so a failure building the home thumbnail —
    // e.g. an imported theme whose project fails to load — never blanks the list
    // (the bundled sample must always be selectable).
    const ts = await api.listThemes().catch(() => [] as ThemeSummary[]);
    setThemes(ts);
    try {
      const [project, media] = await Promise.all([api.loadProject(), api.listMedia()]);
      setCurrentThumb(renderHomeThumbnail(project, media));
    } catch {
      setCurrentThumb(null);
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    void reload().catch(() => active && setThemes([]));
    return () => {
      active = false;
    };
  }, [reload]);

  const openEditor = () => onNavigate({ screen: "themeEditor", siteId, mode: "visual" });

  // Switching a theme resets the page layout to the new theme's defaults while
  // keeping all content (CLAUDE.md / plan); reload so the editor sees it.
  const useTheme = (id: string) => {
    setSwitching(true);
    void api
      .setActiveTheme(id)
      .then(reload)
      .finally(() => setSwitching(false));
  };

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
                <button disabled={switching} onClick={() => useTheme(th.id)}>
                  {t("theme.use")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="pcms-note">{t("theme.figmaRoadmap")}</p>

      {importing && (
        <ThemeImport
          api={api}
          onClose={() => setImporting(false)}
          onImported={() => void reload()}
        />
      )}
    </div>
  );
}
