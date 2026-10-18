import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app lives in app/; data/ and tools/ stay at the repo root.
export default defineConfig({
  root: "app",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
});
