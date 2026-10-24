import { useState } from "react";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { t } from "../../i18n.js";

/**
 * Site settings (site.json). The values come from the loaded project; wiring
 * the write path (site.json persistence) to main/preload is a later step, so
 * edits here are kept in the view for now (noted below).
 */
export function SiteSettingsView() {
  const { project } = useSiteWorkspace();
  const [name, setName] = useState(project.site.name);
  const [baseUrl, setBaseUrl] = useState(project.site.baseUrl);
  const [permalink, setPermalink] = useState(project.site.permalink);

  return (
    <div className="pcms-settingsview">
      <h1 className="pcms-page__title">{t("site.tab.settings")}</h1>
      <p className="pcms-note">{t("siteSettings.note")}</p>

      <label className="pcms-field">
        <span className="pcms-field__label">{t("siteSettings.name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="pcms-field">
        <span className="pcms-field__label">{t("siteSettings.baseUrl")}</span>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label className="pcms-field">
        <span className="pcms-field__label">{t("siteSettings.permalink")}</span>
        <input value={permalink} onChange={(e) => setPermalink(e.target.value)} />
      </label>
    </div>
  );
}
