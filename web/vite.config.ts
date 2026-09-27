import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: `npm run dev` proxies /api to the FastAPI server (`pcast serve`).
// Prod: `npm run build` writes dist/, which `pcast serve` serves at "/".
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 2500 },
  worker: { format: "es" }, // MapLibre starts its worker as a module worker
});
