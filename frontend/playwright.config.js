import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.e2e"), quiet: true });

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.js",
  reporter: [["list"], ["html", { outputFolder: "test-results/live-report", open: "never" }]],
  outputDir: "test-results/live",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "https://sih-aeromesh-blond.vercel.app",
    browserName: "chromium",
    colorScheme: "dark",
    screenshot: "off",
    trace: "off",
  },
});
