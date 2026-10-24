import { mount } from "./mount.js";
import { createMockApi } from "./api/mock.js";

// Browser dev harness: wire the editor to a mock window.pcms so it runs and is
// previewable without the Electron shell.
const container = document.getElementById("root");
if (container) mount(container, createMockApi());
