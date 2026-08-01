import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // MapLibre ships its own web worker, which Vite's dependency pre-bundler
  // mangles. Without the worker no GeoJSON source ever produces tiles: raster
  // layers still draw, so the map looks fine while every vector layer is
  // silently invisible.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  server: {
    // Same-origin /api in dev, so the browser never has to care that the API
    // lives on another port.
    proxy: {
      "/api": {
        target: process.env.API_ORIGIN ?? "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
