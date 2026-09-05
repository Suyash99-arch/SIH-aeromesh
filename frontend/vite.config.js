import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/media": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/public/assets/missions/**/*.mp4"],
      usePolling: true,
      interval: 1000,
    },
  },
  build: {
    minify: false,
  },
});
