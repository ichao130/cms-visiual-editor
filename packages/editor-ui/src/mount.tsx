import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { PcmsApi } from "./api/types.js";
import { App } from "./components/App.js";
import "./styles.css";

/**
 * Mount the editor into a container with a given API implementation.
 * The desktop renderer calls this with `window.pcms`; the dev harness calls it
 * with a mock. The editor never reaches for Electron itself.
 */
export function mount(container: HTMLElement, api: PcmsApi): () => void {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App api={api} />
    </StrictMode>,
  );
  return () => root.unmount();
}

export type {
  PcmsApi,
  ProjectData,
  MediaUpload,
  DeployConfigInput,
  AccountView,
  ProjectSummary,
  SiteSummary,
  SiteStats,
  InquiryRow,
  ThemeSummary,
  ThemeFileNode,
  ThemeFileKind,
} from "./api/types.js";
