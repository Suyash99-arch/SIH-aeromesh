import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "interactive-objects.spec.js",
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4188",
    browserName: "chromium",
    screenshot: "off",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4188 --strictPort",
    url: "http://127.0.0.1:4188",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
