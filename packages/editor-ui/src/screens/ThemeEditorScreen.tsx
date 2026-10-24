import type { PcmsApi } from "../api/types.js";
import type { Route, ThemeMode } from "../state/route.js";
import { ThemeEditor } from "../components/ThemeEditor.js";
import { CodeEditorView } from "./theme/CodeEditorView.js";
import { t } from "../i18n.js";

interface Props {
  api: PcmsApi;
  route: Extract<Route, { screen: "themeEditor" }>;
  onNavigate: (route: Route) => void;
}

/** Theme editor shell: Visual (existing editor) / Code (CodeMirror) tabs. */
export function ThemeEditorScreen({ api, route, onNavigate }: Props) {
  const setMode = (mode: ThemeMode) =>
    onNavigate({ screen: "themeEditor", siteId: route.siteId, mode });

  return (
    <div className="pcms-themeeditor">
      <div className="pcms-tabbar">
        <button
          className="pcms-tabbar__back"
          onClick={() => onNavigate({ screen: "site", siteId: route.siteId, tab: "theme" })}
        >
          ← {t("themeEditor.back")}
        </button>
        <div className="pcms-tabbar__tabs">
          <button
            className={`pcms-tabbar__tab${route.mode === "visual" ? " is-active" : ""}`}
            onClick={() => setMode("visual")}
          >
            {t("themeEditor.visual")}
          </button>
          <button
            className={`pcms-tabbar__tab${route.mode === "code" ? " is-active" : ""}`}
            onClick={() => setMode("code")}
          >
            {t("themeEditor.code")}
          </button>
        </div>
      </div>
      <div className="pcms-themeeditor__body">
        {route.mode === "visual" ? <ThemeEditor /> : <CodeEditorView api={api} />}
      </div>
    </div>
  );
}
