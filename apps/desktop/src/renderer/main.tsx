import { mount, type PcmsApi } from "@pcms/editor-ui";

// The desktop renderer wires the editor to the real window.pcms exposed by the
// preload. It must never reach for Electron APIs directly (CLAUDE.md 境界のルール).
const container = document.getElementById("root");
const api: PcmsApi | undefined = window.pcms;

if (container && api) {
  mount(container, api);
} else if (container) {
  container.textContent =
    "window.pcms が見つかりません。preload の読み込みに失敗した可能性があります。";
}
