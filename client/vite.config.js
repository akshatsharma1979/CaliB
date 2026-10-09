import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.API_PORT ?? process.env.PORT ?? 4000;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${apiPort}`
    }
  },
  preview: {
    port: 4173
  },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          icons: ["lucide-react"]
        }
      }
    }
  }
});
