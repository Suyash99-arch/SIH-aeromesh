import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiProxyTarget = process.env.E2E_API_PROXY_TARGET || "http://127.0.0.1:8000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "preload-landing-page-assets",
      transformIndexHtml: {
        order: "post",
        handler(html, context) {
          const bundle = context.bundle;
          if (!bundle) return html;
          const homeChunk = Object.values(bundle).find((asset) => asset.type === "chunk" && asset.name === "HomePage");
          if (!homeChunk) return html;
        const links = [`<link rel="prefetch" as="script" crossorigin href="/${homeChunk.fileName}">`];
        for (const cssFile of homeChunk.viteMetadata?.importedCss || []) {
          links.push(`<link rel="prefetch" as="style" crossorigin href="/${cssFile}">`);
        }
          return html.replace("</head>", `${links.join("\n    ")}\n  </head>`);
        },
      },
    },
  ],
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
      "/api/v1": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/missions": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/scenes": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/health": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/media": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    cssMinify: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react-vendor";
          if (/[\\/]node_modules[\\/](three|@react-three)[\\/]/.test(id)) return "three-vendor";
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "icons-vendor";
          if (/[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/.test(id)) return "i18n-vendor";
        },
      },
    },
  },
});
