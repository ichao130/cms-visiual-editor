import { useSiteWorkspace } from "../state/SiteWorkspace.js";
import { t } from "../i18n.js";

/**
 * Persistent save bar for the site workspace. Shown above the editing tabs
 * (posts / pages / content types / taxonomies / menus) so every change to the
 * shared document has one consistent place to undo/redo and save — replacing
 * the per-view save buttons the content lists used to carry.
 */
export function SiteSaveBar() {
  const { dirty, save, undo, redo, canUndo, canRedo } = useSiteWorkspace();

  return (
    <div className="pcms-savebar">
      <button type="button" onClick={undo} disabled={!canUndo}>
        ↶ {t("toolbar.undo")}
      </button>
      <button type="button" onClick={redo} disabled={!canRedo}>
        ↷ {t("toolbar.redo")}
      </button>
      <div className="pcms-savebar__spacer" />
      <span className={`pcms-savebar__state${dirty ? " is-dirty" : ""}`}>
        {dirty ? t("toolbar.unsaved") : t("common.saved")}
      </span>
      <button type="button" className="pcms-primary" onClick={save} disabled={!dirty}>
        {t("common.save")}
      </button>
    </div>
  );
}
