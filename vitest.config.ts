import { defineConfig } from "vitest/config";

// Engine tests run in Node; the app's Vite config (root: app/) is separate.
export default defineConfig({
  test: {
    include: ["packages/engine/test/**/*.test.ts"],
    testTimeout: 60000,
  },
});
