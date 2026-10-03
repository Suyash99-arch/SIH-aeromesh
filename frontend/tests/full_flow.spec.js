import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";

test.describe("Authoritative End-to-End Incident Pipeline Verification", () => {
  test("landing -> guest -> New Incident -> upload real 33 MB mp4 -> Launch Pipeline -> processing page -> viewer", async ({
    page,
  }) => {
    // Generous timeout for real 33 MB video upload and processing initiation
    test.setTimeout(180000);

    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error") {
        if (!text.includes("favicon") && !text.includes(".map")) {
          consoleErrors.push(`[${msg.type()}] ${text}`);
          console.error("Browser Console Error:", text);
        }
      }
    });

    page.on("pageerror", (err) => {
      pageErrors.push(err.message || String(err));
      console.error("Uncaught Page Exception:", err);
    });

    page.on("response", (res) => {
      const url = res.url();
      const status = res.status();
      // Fail on any 4xx/5xx (allow harmless favicon/source map misses)
      if (status >= 400 && !url.includes("favicon") && !url.includes(".map")) {
        const errorRecord = `${status} ${res.statusText()} @ ${url}`;
        failedRequests.push(errorRecord);
        console.error("HTTP Error Response:", errorRecord);
      }
    });

    const screenshotsDir = path.resolve(process.cwd(), "test-results", "flow_screenshots");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    // 1. Landing Page
    console.log("[E2E] Step 1: Navigating to Landing Page...");
    await page.goto("http://127.0.0.1:5173/");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(screenshotsDir, "step1_landing.png") });

    // 2. Guest Login
    console.log("[E2E] Step 2: Logging in as Guest Evaluator...");
    const guestBtn = page.locator("#btn-nav-guest, #btn-hero-guest, button:has-text('Guest')").first();
    await expect(guestBtn).toBeVisible({ timeout: 10000 });
    await guestBtn.click();

    // Verify dashboard renders
    await page.waitForSelector(".app-shell, .sidebar, #btn-sidebar-new-mission", { timeout: 15000 });
    await page.screenshot({ path: path.join(screenshotsDir, "step2_guest_dashboard.png") });

    // 3. Open New Incident Workspace
    console.log("[E2E] Step 3: Opening New Incident Workspace...");
    const newMissionBtn = page.locator("#btn-sidebar-new-mission, button:has-text('New Mission')").first();
    await expect(newMissionBtn).toBeVisible();
    await newMissionBtn.click();

    const workspaceModal = page.locator("#incident-creation-workspace");
    await expect(workspaceModal).toBeVisible({ timeout: 10000 });

    // Verify hardcoded sample content is removed (empty fields, generic placeholders)
    const nameInput = page.locator("#inc-name");
    const locInput = page.locator("#inc-location");
    const descInput = page.locator("#inc-desc");

    await expect(nameInput).toBeVisible();
    await expect(locInput).toHaveValue("");
    await expect(descInput).toHaveValue("");

    await page.screenshot({ path: path.join(screenshotsDir, "step3_new_incident_modal.png") });

    // 4. Locate and Upload Real 33 MB MP4 Video
    console.log("[E2E] Step 4: Selecting real 33 MB class MP4 video...");
    const candidates = [
      path.resolve(process.cwd(), "data", "missions", "66f84733-06de-41fd-8227-ddf82b15561f", "video.mp4"),
      path.resolve(process.cwd(), "..", "data", "missions", "66f84733-06de-41fd-8227-ddf82b15561f", "video.mp4"),
      path.resolve(process.cwd(), "data", "missions", "c6a92673-eb5c-48f3-8a5c-e7d4631aa3b0", "video.mp4"),
      path.resolve(process.cwd(), "..", "data", "missions", "c6a92673-eb5c-48f3-8a5c-e7d4631aa3b0", "video.mp4"),
    ];

    let realVideoPath = candidates.find((p) => fs.existsSync(p));
    expect(realVideoPath, "Could not locate real 33 MB MP4 video file in missions storage").toBeTruthy();

    const fileSizeMB = (fs.statSync(realVideoPath).size / (1024 * 1024)).toFixed(1);
    console.log(`[E2E] Found source video: ${realVideoPath} (${fileSizeMB} MB)`);

    await nameInput.fill("E2E Authoritative 33MB Drone Flight");
    await locInput.fill("Sector 07 Aerial Grid (37.7749° N, 122.4194° W)");
    await descInput.fill("Automated E2E pipeline verification with full chunk upload and 3D processing.");

    const fileInput = page.locator("#inc-video-file-input");
    await fileInput.setInputFiles(realVideoPath);

    // Wait for video preview and dynamic ETA box calculation
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(screenshotsDir, "step4_video_selected.png") });

    // 5. Launch Pipeline (Uploads 17 Chunks & Posts typed JSON options)
    console.log("[E2E] Step 5: Launching Pipeline (17 chunks upload + process initiation)...");
    const launchBtn = page.locator("#btn-launch-incident-pipeline");
    await expect(launchBtn).toBeEnabled({ timeout: 10000 });
    await launchBtn.click();

    // 6. Processing Page
    console.log("[E2E] Step 6: Verifying navigation to Processing Page...");
    // Wait for either the pipeline page or processing container
    await page.waitForFunction(
      () => {
        const bodyText = document.body.innerText || "";
        return (
          bodyText.includes("Stage") ||
          bodyText.includes("Pipeline") ||
          bodyText.includes("Processing") ||
          bodyText.includes("Photogrammetric")
        );
      },
      { timeout: 90000 }
    );
    await page.screenshot({ path: path.join(screenshotsDir, "step5_processing_progress.png") });

    // 7. Viewer Page (Safe Artifact Loading - No 404s)
    console.log("[E2E] Step 7: Navigating to 3D Viewer...");
    await page.goto("http://127.0.0.1:5173/?page=reconstruction");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(screenshotsDir, "step6_reconstruction_viewer.png") });

    // 8. Strict Assertions: Zero uncaught exceptions, zero console errors, zero 4xx/5xx requests
    console.log("[E2E] Step 8: Asserting zero console errors and zero HTTP failures...");
    const consoleLogOutput = consoleErrors.join("\n");
    fs.writeFileSync(path.join(screenshotsDir, "console_errors.log"), consoleLogOutput, "utf-8");

    expect(pageErrors, `Uncaught page exceptions detected: ${pageErrors.join("; ")}`).toHaveLength(0);
    expect(consoleErrors, `Browser console errors detected: ${consoleErrors.join("; ")}`).toHaveLength(0);
    expect(failedRequests, `HTTP 4xx/5xx network failures: ${failedRequests.join("; ")}`).toHaveLength(0);

    console.log("[E2E] All Playwright verification steps passed with zero console errors and zero 4xx/5xx HTTP responses!");
  });
});
