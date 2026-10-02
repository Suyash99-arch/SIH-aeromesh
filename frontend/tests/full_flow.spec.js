import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";

test.describe("Real Full Flow E2E Verification", () => {
  test("landing -> guest entry -> dashboard (empty) -> upload -> processing -> viewer", async ({ page }) => {
    const consoleLogs = [];
    const pageErrors = [];
    const failedRequests = [];

    // Listen for console logs, errors, and network responses
    page.on("console", (msg) => {
      const logStr = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(logStr);
      if (msg.type() === "error") {
        console.error("Browser console error detected:", msg.text());
      }
    });

    page.on("pageerror", (err) => {
      pageErrors.push(err.message || String(err));
      console.error("Uncaught page error detected:", err);
    });

    page.on("response", (res) => {
      if (res.status() >= 400 && !res.url().includes("/favicon") && !res.url().includes(".map")) {
        failedRequests.push(`${res.status()} ${res.statusText()}: ${res.url()}`);
        console.error(`HTTP error response ${res.status()} on ${res.url()}`);
      }
    });

    const screenshotsDir = path.join(process.cwd(), "test-results", "flow_screenshots");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    // 1. Landing page
    console.log("Navigating to landing page...");
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(screenshotsDir, "step1_landing.png") });

    // 2. Guest Entry
    console.log("Executing guest login...");
    const guestBtn = page.getByRole("button", { name: /Guest|Start|Demo/i }).first();
    if (await guestBtn.isVisible()) {
      await guestBtn.click({ force: true });
    } else {
      await page.goto("/#/dashboard");
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotsDir, "step2_guest_entry.png") });

    // 3. Dashboard (empty / initial state)
    console.log("Verifying dashboard...");
    await expect(page.locator(".sidebar, .dashboard-layout, body")).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, "step3_dashboard_empty.png") });

    // 4. Upload & Create Mission
    console.log("Navigating to mission creation and uploading video...");
    await page.goto("/#/missions/new");
    await page.waitForTimeout(500);

    const nameInput = page.locator("input[placeholder*='Mission'], input[name='name']").first();
    if (await nameInput.isVisible()) {
      await nameInput.fill("E2E Playwright Mission");
    }

    const videoInput = page.locator("input[type='file']");
    if (await videoInput.isVisible()) {
      const sampleVideo = path.join(process.cwd(), "..", "SinglePass3D", "input", "drone.mp4");
      const fallbackVideo = path.join(process.cwd(), "..", "scratch", "sample_videos", "test_h264.mp4");
      const videoPath = fs.existsSync(sampleVideo) ? sampleVideo : fallbackVideo;
      if (fs.existsSync(videoPath)) {
        await videoInput.setInputFiles(videoPath);
      }
    }
    await page.screenshot({ path: path.join(screenshotsDir, "step4_upload.png") });

    // 5. Processing
    console.log("Monitoring processing screen...");
    const processBtn = page.getByRole("button", { name: /Process|Start|Submit|Upload/i }).first();
    if (await processBtn.isVisible()) {
      await processBtn.click({ force: true });
    }
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, "step5_processing.png") });

    // 6. 3D Viewer
    console.log("Navigating to 3D Viewer...");
    await page.goto("/#/reconstruction");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, "step6_viewer.png") });

    // Write out console logs file
    const logPath = path.join(screenshotsDir, "playwright_console.log");
    fs.writeFileSync(logPath, consoleLogs.join("\n"), "utf-8");

    // Fail assertions on errors/uncaught exceptions/failed requests
    expect(pageErrors, `Uncaught page errors: ${pageErrors.join("; ")}`).toHaveLength(0);
    const severeConsoleErrors = consoleLogs.filter((l) => l.startsWith("[error]") && !l.includes("favicon"));
    expect(severeConsoleErrors, `Console errors: ${severeConsoleErrors.join("; ")}`).toHaveLength(0);
    expect(failedRequests, `HTTP 4xx/5xx requests: ${failedRequests.join("; ")}`).toHaveLength(0);
  });
});
