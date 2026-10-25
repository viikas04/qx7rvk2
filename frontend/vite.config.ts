/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the FastAPI backend runs on :8000
    proxy: { "/api": process.env.VITE_PROXY_TARGET ?? "http://localhost:8000" },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes("recharts") || id.includes("d3-") ? "charts" : undefined) },
    },
  },
  test: { environment: "jsdom" },
});
