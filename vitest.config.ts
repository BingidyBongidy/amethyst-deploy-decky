import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Type-check the tests too (rollup's build only type-checks what it bundles).
    typecheck: { enabled: true, include: ["src/**/*.test.{ts,tsx}"], tsconfig: "./tsconfig.test.json" },
  },
});
