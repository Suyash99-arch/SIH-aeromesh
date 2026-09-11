import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^three$/,
        replacement: path.resolve(__dirname, "src/utils/threeTimerCompat.js"),
      },
    ],
  },
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
