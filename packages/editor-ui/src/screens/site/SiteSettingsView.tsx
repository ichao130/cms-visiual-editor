import type { SiteConfig } from "@pcms/shared";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { t } from "../../i18n.js";

/**
 * Site settings (site.json): name, base URL, permalink. Edits go into the
 * shared workspace document, so the site save bar persists them (via
 * api.saveSite) and undo/redo covers them like any other change.
 */
export function SiteSettingsView() {
  const { doc, commit, setDirty } = useSiteWorkspace();
  const site = doc.site;

  const update = (patch: Partial<SiteConfig>) => {
    commit({ ...doc, site: { ...site, ...patch } });
    setDirty(true);
  };

  return (
    <div className="pcms-settingsview">
      <h1 className="pcms-page__title">{t("site.tab.settings")}</h1>

      <label className="pcms-field">
        <span className="pcms-field__label">{t("siteSettings.name")}</span>
        <input value={site.name} onChange={(e) => update({ name: e.target.value })} />
      </label>
      <label className="pcms-field">
        <span className="pcms-field__label">{t("siteSettings.baseUrl")}</span>
        <input
          value={site.baseUrl ?? ""}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="https://example.com"
        />
      </label>
      <label className="pcms-field">
        <span className="pcms-field__label">{t("siteSettings.permalink")}</span>
        <input
          value={site.permalink ?? ""}
          onChange={(e) => update({ permalink: e.target.value })}
          placeholder="/:type/:slug/"
        />
      </label>
    </div>
  );
}
