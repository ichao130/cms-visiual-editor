import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "firebase/functions/test/**/*.test.ts",
      "apps/desktop/test/**/*.test.ts",
    ],
    environment: "node",
  },
  // The Firebase functions no longer declare the workspace packages (so the
  // deployed manifest carries no "workspace:*"); resolve them to source here.
  resolve: {
    alias: {
      "@pcms/engine": src("./packages/engine/src/index.ts"),
      "@pcms/shared": src("./packages/shared/src/index.ts"),
    },
  },
});
