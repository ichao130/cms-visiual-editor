import { t } from "../i18n.js";

interface ToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}

export function Toolbar({ canUndo, canRedo, dirty, onUndo, onRedo, onSave }: ToolbarProps) {
  return (
    <header className="pcms-toolbar">
      <span className="pcms-toolbar__title">{t("app.title")}</span>
      <div className="pcms-toolbar__spacer" />
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
    </header>
  );
}
