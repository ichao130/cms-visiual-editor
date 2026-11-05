import { useEffect, useRef, useState } from "react";
import type { PcmsApi, SiteSummary } from "../api/types.js";
import type { Route } from "../state/route.js";
import { CreateCard } from "../components/CreateCard.js";
import { CardRenameForm } from "../components/CardRenameForm.js";
import { renderHomeThumbnail } from "../preview/render.js";
import { useToast } from "../state/ToastContext.js";
import { useDialog } from "../state/useDialog.js";
import { t } from "../i18n.js";

/** Logical width the thumbnail iframe renders at before being scaled to fit. */
const THUMB_BASE_WIDTH = 1200;

/**
 * A scaled, inert mini-render of a site's home page. The iframe renders the
 * page at a fixed logical width and is scaled down to the card's width, so the
 * card shows a faithful preview rather than a placeholder.
 */
function SitePreviewThumb({ html }: { html: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(THUMB_BASE_WIDTH ? 0.18 : 1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / THUMB_BASE_WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="pcms-card__preview" ref={ref} aria-hidden="true">
      {html ? (
        <iframe
          className="pcms-card__previewframe"
          srcDoc={html}
          sandbox=""
          scrolling="no"
          tabIndex={-1}
          title=""
          style={{ transform: `scale(${scale})` }}
        />
      ) : (
        <div className="pcms-card__previewempty" />
      )}
    </div>
  );
}

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
  const [thumbHtml, setThumbHtml] = useState<string | null>(null);
  // Project-level menu (⋯ beside the title) and the basic-settings dialog it opens.
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let active = true;
    void api.listSites(projectId).then((s) => active && setSites(s));
    return () => {
      active = false;
    };
  }, [api, projectId]);

  // Build a home-page thumbnail for the site cards. (The mock exposes one site,
  // so cards share it; a per-site implementation loads each site's project.)
  useEffect(() => {
    let active = true;
    void Promise.all([api.loadProject(), api.listMedia()]).then(([project, media]) => {
      if (!active) return;
      try {
        setThumbHtml(renderHomeThumbnail(project, media));
      } catch {
        setThumbHtml(null);
      }
    });
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
    <div className="pcms-page pcms-page--single">
      <div className="pcms-page__main">
        <div className="pcms-page__titlerow">
          <h1 className="pcms-page__title">{t("project.sites")}</h1>
          <div className="pcms-kebabwrap">
            <button
              type="button"
              className="pcms-kebab"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("common.menu")}
              onClick={() => setMenuOpen((o) => !o)}
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <div
                  className="pcms-dropdown__scrim"
                  aria-hidden="true"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="pcms-dropdown" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setSettingsOpen(true);
                    }}
                  >
                    {t("common.settings")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
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
                  className="pcms-card pcms-card--site"
                  onClick={() => onNavigate({ screen: "site", siteId: s.id, tab: "info" })}
                >
                  <SitePreviewThumb html={thumbHtml} />
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

      {settingsOpen && <ProjectSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** Project-wide basic settings, opened from the ⋯ menu beside the title. */
function ProjectSettingsModal({ onClose }: { onClose: () => void }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("project.basicSettings")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel pcms-modal__panel--narrow" ref={ref} tabIndex={-1}>
        <header className="pcms-modal__head">
          <h2>{t("project.basicSettings")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </header>
        <p className="pcms-empty">{t("project.basicSettings.hint")}</p>
      </div>
    </div>
  );
}
