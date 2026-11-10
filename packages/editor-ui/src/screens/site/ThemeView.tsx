import { useCallback, useEffect, useState } from "react";
import type { PcmsApi, ThemeSummary } from "../../api/types.js";
import type { Route } from "../../state/route.js";
import { ThemeImport } from "../../components/ThemeImport.js";
import { PreviewThumb } from "../../components/PreviewThumb.js";
import { renderHomeThumbnail } from "../../preview/render.js";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { t } from "../../i18n.js";

/** The bundled sample theme is the fallback; it is never renamed or deleted. */
const SAMPLE_THEME_ID = "sample-cafe";

interface Props {
  api: PcmsApi;
  siteId: string;
  onNavigate: (route: Route) => void;
}

/** Theme selection, and the entry point into the theme editor. */
export function ThemeView({ api, siteId, onNavigate }: Props) {
  // Switching the active theme must refresh the shared workspace (project +
  // editable document), not just this screen's thumbnail — otherwise the editor
  // keeps rendering the old theme and the design appears not to change.
  const { reloadWorkspace } = useSiteWorkspace();
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
      .then(() => {
        reloadWorkspace(); // refresh the editor/preview with the new theme
        return reload();
      })
      .finally(() => setSwitching(false));
  };

  // Rename / delete apply to imported themes only; the bundled sample is fixed
  // and is the fallback, so it is never renamed or removed here.
  const renameTheme = (th: ThemeSummary) => {
    const name = window.prompt(t("theme.renamePrompt"), th.name)?.trim();
    if (!name || name === th.name) return;
    setSwitching(true);
    void api
      .renameTheme(th.id, name)
      .then(reload)
      .finally(() => setSwitching(false));
  };

  const deleteTheme = (th: ThemeSummary) => {
    if (!window.confirm(t("theme.deleteConfirm").replace("{name}", th.name))) return;
    setSwitching(true);
    void api
      .deleteTheme(th.id)
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
              {th.id !== SAMPLE_THEME_ID && (
                <>
                  <button disabled={switching} onClick={() => renameTheme(th)}>
                    {t("theme.rename")}
                  </button>
                  <button
                    className="pcms-danger"
                    disabled={switching}
                    onClick={() => deleteTheme(th)}
                  >
                    {t("theme.delete")}
                  </button>
                </>
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
          onImported={() => {
            // A WP import can become the active theme, so refresh the whole
            // workspace (not just the list) — same as switching.
            reloadWorkspace();
            void reload();
          }}
        />
      )}
    </div>
  );
}
