import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
