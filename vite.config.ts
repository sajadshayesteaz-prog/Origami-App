import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app lives in app/; data/ and tools/ stay at the repo root.
export default defineConfig({
  root: "app",
  plugins: [react()],
  resolve: {
    alias: { "@origami/engine": fileURLToPath(new URL("./packages/engine/src/index.ts", import.meta.url)) },
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
