import type { EditorTarget } from "../state/editorState.js";
import { targetKey } from "../state/editorState.js";
import { t } from "../i18n.js";

interface ToolbarProps {
  targets: EditorTarget[];
  currentKey: string;
  onSelectTarget: (key: string) => void;
  device: "desktop" | "mobile";
  onDevice: (device: "desktop" | "mobile") => void;
  onAi: () => void;
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
  device,
  onDevice,
  onAi,
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
      <div className="pcms-device" role="group" aria-label={t("toolbar.device")}>
        <button
          type="button"
          className={device === "desktop" ? "is-active" : ""}
          onClick={() => onDevice("desktop")}
          title={t("device.pc")}
        >
          🖥
        </button>
        <button
          type="button"
          className={device === "mobile" ? "is-active" : ""}
          onClick={() => onDevice("mobile")}
          title={t("device.mobile")}
        >
          📱
        </button>
      </div>
      <div className="pcms-toolbar__spacer" />
      <button type="button" className="pcms-aibtn" onClick={onAi}>
        {t("toolbar.ai")}
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
    </header>
  );
}
