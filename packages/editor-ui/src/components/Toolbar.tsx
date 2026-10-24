import type { EditorTarget } from "../state/editorState.js";
import { targetKey } from "../state/editorState.js";
import { t } from "../i18n.js";

interface ToolbarProps {
  targets: EditorTarget[];
  currentKey: string;
  onSelectTarget: (key: string) => void;
  onNew: () => void;
  onManageTypes: () => void;
  onManageMenus: () => void;
  onManageTax: () => void;
  onOpenMedia: () => void;
  onPublish: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}

export function Toolbar({
  targets,
  currentKey,
  onSelectTarget,
  onNew,
  onManageTypes,
  onManageMenus,
  onManageTax,
  onOpenMedia,
  onPublish,
  canUndo,
  canRedo,
  dirty,
  onUndo,
  onRedo,
  onSave,
}: ToolbarProps) {
  return (
    <header className="pcms-toolbar">
      <span className="pcms-toolbar__title">{t("app.title")}</span>
      <label className="pcms-pageselect">
        <span className="pcms-visually-hidden">{t("toolbar.page")}</span>
        <select value={currentKey} onChange={(e) => onSelectTarget(e.target.value)}>
          {targets.map((target) => {
            const key = targetKey(target);
            return (
              <option key={key} value={key}>
                {target.label}
              </option>
            );
          })}
        </select>
      </label>
      <button type="button" onClick={onNew}>
        {t("toolbar.new")}
      </button>
      <div className="pcms-toolbar__spacer" />
      <button type="button" onClick={onManageMenus}>
        {t("toolbar.menus")}
      </button>
      <button type="button" onClick={onManageTypes}>
        {t("toolbar.types")}
      </button>
      <button type="button" onClick={onManageTax}>
        {t("toolbar.tax")}
      </button>
      <button type="button" onClick={onOpenMedia}>
        {t("media.title")}
      </button>
      <button type="button" onClick={onUndo} disabled={!canUndo}>
        {t("toolbar.undo")}
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo}>
        {t("toolbar.redo")}
      </button>
      <span className={`pcms-toolbar__state${dirty ? " is-dirty" : ""}`}>
        {dirty ? t("toolbar.unsaved") : t("toolbar.saved")}
      </span>
      <button type="button" className="pcms-primary" onClick={onSave} disabled={!dirty}>
        {t("toolbar.save")}
      </button>
      <button type="button" className="pcms-publishbtn" onClick={onPublish}>
        {t("toolbar.publish")}
      </button>
    </header>
  );
}
