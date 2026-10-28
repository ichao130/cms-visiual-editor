import type { SiteConfig } from "@pcms/shared";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { useMedia } from "../../media/MediaContext.js";
import { t } from "../../i18n.js";

/** A path input paired with a thumbnail preview and the media-library picker. */
function ImageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const media = useMedia();
  const preview = media.resolveUrl(value || undefined);
  return (
    <div className="pcms-field">
      <span className="pcms-field__label">{label}</span>
      <div className="pcms-imagefield">
        {preview && <img className="pcms-imagefield__thumb" src={preview} alt="" />}
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="media/..." />
        <button
          type="button"
          onClick={() => {
            void media.pickImage().then((path) => {
              if (path) onChange(path);
            });
          }}
        >
          {t("siteSettings.pickImage")}
        </button>
      </div>
    </div>
  );
}

/**
 * Site settings (site.json): name, base URL, permalink, logo, archive page
 * size, OGP defaults and search-engine verification tags. Edits go into the
 * shared workspace document, so the site save bar persists them (via
 * api.saveSite) and undo/redo covers them like any other change. The OGP and
 * verification values are emitted into every generated page's <head>.
 */
export function SiteSettingsView() {
  const { doc, commit, setDirty } = useSiteWorkspace();
  const site = doc.site;

  const update = (patch: Partial<SiteConfig>) => {
    commit({ ...doc, site: { ...site, ...patch } });
    setDirty(true);
  };

  const updateOgp = (patch: Partial<NonNullable<SiteConfig["ogpDefault"]>>) => {
    update({ ogpDefault: { ...site.ogpDefault, ...patch } });
  };

  const updateVerification = (provider: string, value: string) => {
    const next = { ...site.verificationTags };
    if (value) next[provider] = value;
    else delete next[provider];
    update({ verificationTags: next });
  };

  return (
    <div className="pcms-settingsview">
      <h1 className="pcms-page__title">{t("site.tab.settings")}</h1>

      <h2 className="pcms-settingsview__section">{t("siteSettings.section.basic")}</h2>
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
      <ImageField
        label={t("siteSettings.logo")}
        value={site.logo ?? ""}
        onChange={(v) => update({ logo: v || undefined })}
      />
      <label className="pcms-field">
        <span className="pcms-field__label">{t("siteSettings.archivePageSize")}</span>
        <input
          type="number"
          min={1}
          value={site.archivePageSize ?? ""}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            update({ archivePageSize: Number.isFinite(n) && n > 0 ? n : undefined });
          }}
          placeholder="10"
        />
      </label>

      <h2 className="pcms-settingsview__section">{t("siteSettings.section.ogp")}</h2>
      <ImageField
        label={t("siteSettings.ogpImage")}
        value={site.ogpDefault?.image ?? ""}
        onChange={(v) => updateOgp({ image: v || undefined })}
      />
      <label className="pcms-field">
        <span className="pcms-field__label">{t("siteSettings.ogpDescription")}</span>
        <textarea
          value={site.ogpDefault?.description ?? ""}
          onChange={(e) => updateOgp({ description: e.target.value || undefined })}
          rows={2}
        />
      </label>

      <h2 className="pcms-settingsview__section">{t("siteSettings.section.verification")}</h2>
      <p className="pcms-field__hint">{t("siteSettings.verificationHint")}</p>
      <label className="pcms-field">
        <span className="pcms-field__label">{t("siteSettings.verifyGoogle")}</span>
        <input
          value={site.verificationTags?.google ?? ""}
          onChange={(e) => updateVerification("google", e.target.value)}
        />
      </label>
      <label className="pcms-field">
        <span className="pcms-field__label">{t("siteSettings.verifyBing")}</span>
        <input
          value={site.verificationTags?.bing ?? ""}
          onChange={(e) => updateVerification("bing", e.target.value)}
        />
      </label>
    </div>
  );
}
