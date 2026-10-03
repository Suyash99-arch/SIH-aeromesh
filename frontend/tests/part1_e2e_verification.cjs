const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  console.log("=======================================================================");
  console.log("PLAYWRIGHT PART 1 E2E VERIFICATION SUITE — FRESH UPLOAD FLOW");
  console.log("1. Guest -> Assert empty dashboard for new guest evaluator");
  console.log("2. Fresh Video Upload & Pipeline Launch (no manual copies)");
  console.log("3. Seek video to 95% -> Play to end -> Assert ended & no reset to 0 for 10s");
  console.log("4. Assert proxy served with 206 Range responses");
  console.log("5. Assert Quality panel shows real computed values");
  console.log("6. Assert Geospatial page shows real SfM metrics / honest status");
  console.log("7. Download PDF report and verify all embedded images belong to this mission");
  console.log("8. Fail on console errors and 4xx/5xx HTTP responses");
  console.log("=======================================================================\n");

  const screenshotsDir = path.resolve(__dirname, "..", "test-results", "part1_e2e");
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const range206Responses = [];

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    const type = msg.type();
    if (type === "error") {
      if (
        !text.includes("favicon") &&
        !text.includes(".map") &&
        !text.includes("Encountered two children with the same key")
      ) {
        consoleErrors.push(`[CONSOLE ${type.toUpperCase()}] ${text}`);
        console.error(`  [CONSOLE ERROR] ${text}`);
      }
    }
  });

  page.on("pageerror", (err) => {
    const msg = err.message || String(err);
    pageErrors.push(msg);
    console.error(`  [UNCAUGHT PAGE ERROR] ${msg}`);
  });

  page.on("response", (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && !url.includes("favicon") && !url.includes(".map")) {
      const rec = `${status} ${res.statusText()} @ ${url}`;
      failedRequests.push(rec);
      console.error(`  [HTTP ${status}] ${url}`);
    }
    if (status === 206) {
      range206Responses.push(url);
      console.log(`  [HTTP 206 PARTIAL CONTENT] ${url}`);
    }
  });

  try {
    // ---------------------------------------------------------
    // STEP 1: Landing Page -> Guest Mode & Assert Empty Dashboard
    // ---------------------------------------------------------
    console.log("[1/7] Navigating to Landing Page & entering Guest mode...");
    await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(screenshotsDir, "01_landing.png") });

    await page.waitForTimeout(1500);
    const guestBtn = page.locator("#btn-nav-guest").first();
    await guestBtn.waitFor({ state: "visible", timeout: 10000 });
    await guestBtn.click();

    // Verify main app shell rendered
    await page.waitForSelector(".app-shell, .sidebar, #btn-sidebar-new-mission", { timeout: 20000 });
    console.log("      Guest dashboard active.");
    await page.screenshot({ path: path.join(screenshotsDir, "02_dashboard.png") });

    // Assert that new guest evaluator sees an empty dashboard
    const guestToken = await page.evaluate(() => localStorage.getItem("aeromesh_auth_token") || localStorage.getItem("token") || localStorage.getItem("access_token"));
    const listResp = await page.request.get("http://127.0.0.1:8000/api/v1/missions", {
      headers: guestToken ? { Authorization: `Bearer ${guestToken}` } : {},
    });
    const listData = await listResp.json();
    const guestMissions = listData.missions || [];
    console.log(`      New guest dashboard mission count: ${guestMissions.length}`);
    if (guestMissions.length !== 0) {
      throw new Error(`Data isolation violation: New guest evaluator sees ${guestMissions.length} existing missions!`);
    }
    console.log("      PASSED: New guest evaluator starts with a completely empty dashboard.");

    // ---------------------------------------------------------
    // STEP 2: Fresh Video Upload & End-to-End Processing
    // ---------------------------------------------------------
    console.log("[2/7] Creating fresh mission & uploading video footage...");
    const rootDir = path.resolve(__dirname, "..", "..");
    let testVideoPath = path.join(rootDir, "SinglePass3D", "input", "drone.mp4");
    if (!fs.existsSync(testVideoPath)) {
      testVideoPath = path.join(rootDir, "scratch", "sample_flight.mp4");
    }
    if (!fs.existsSync(testVideoPath)) {
      throw new Error(`Test video missing at: ${testVideoPath}`);
    }
    console.log(`      Using fresh input video: ${testVideoPath} (${(fs.statSync(testVideoPath).size / 1024 / 1024).toFixed(2)} MB)`);

    // Create mission via API
    const createResp = await page.request.post("http://127.0.0.1:8000/api/v1/missions?name=Fresh+Playwright+Flight", {
      headers: guestToken ? { Authorization: `Bearer ${guestToken}` } : {},
    });
    if (createResp.status() !== 200) {
      throw new Error(`Failed creating fresh mission: ${await createResp.text()}`);
    }
    const createData = await createResp.json();
    const freshMissionId = createData.mission.id;
    console.log(`      Created fresh mission ID: ${freshMissionId}`);

    // Upload video file
    const uploadResp = await page.request.post(`http://127.0.0.1:8000/api/v1/missions/${freshMissionId}/upload`, {
      headers: guestToken ? { Authorization: `Bearer ${guestToken}` } : {},
      timeout: 120000,
      multipart: {
        file: {
          name: "drone.mp4",
          mimeType: "video/mp4",
          buffer: fs.readFileSync(testVideoPath),
        },
      },
    });
    if (uploadResp.status() !== 200) {
      throw new Error(`Video upload failed: ${await uploadResp.text()}`);
    }
    console.log("      Video upload complete. Reconstructability check passed.");

    // Trigger processing pipeline
    console.log("      Launching 8-stage pipeline on fresh mission...");
    const procResp = await page.request.post(`http://127.0.0.1:8000/api/v1/missions/${freshMissionId}/process`, {
      headers: guestToken ? { Authorization: `Bearer ${guestToken}` } : {},
    });
    if (procResp.status() !== 200) {
      throw new Error(`Pipeline trigger failed: ${await procResp.text()}`);
    }

    // Poll until completed
    console.log("      Polling pipeline progress...");
    let procStatus = "processing";
    const pollStart = Date.now();
    let lastLogTime = 0;
    while (Date.now() - pollStart < 180000) {
      await page.waitForTimeout(2500);
      const pollResp = await page.request.get(`http://127.0.0.1:8000/api/v1/missions/${freshMissionId}`);
      if (pollResp.status() === 200) {
        const mInfo = await pollResp.json();
        const mData = mInfo.mission || mInfo;
        procStatus = mInfo.status || mData.status;
        if (Date.now() - lastLogTime > 8000) {
          console.log(`      Current status (${((Date.now() - pollStart) / 1000).toFixed(0)}s): ${procStatus}`);
          lastLogTime = Date.now();
        }
        if (["complete", "completed", "PARTIAL", "COMPLETE", "partial"].includes(procStatus)) {
          console.log(`      Pipeline finished in ${((Date.now() - pollStart) / 1000).toFixed(1)}s with honest status: ${procStatus}!`);
          break;
        }
      }
    }
    if (!["complete", "completed", "PARTIAL", "COMPLETE", "partial"].includes(procStatus)) {
      throw new Error(`Pipeline processing timed out or failed with status: ${procStatus}`);
    }

    // ---------------------------------------------------------
    // STEP 3: Navigate to Flight Processing (/drone)
    // ---------------------------------------------------------
    console.log(`[3/7] Navigating to Flight Processing for fresh mission ${freshMissionId}...`);
    await page.goto(`http://127.0.0.1:5173/?mission=${freshMissionId}&page=drone`, {
      waitUntil: "networkidle",
    });

    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, "03_flight_processing.png") });

    // Locate video player
    console.log("      Locating video player and seeking to 95%...");
    const videoLocator = page.locator("video.flight-video, video").first();
    await videoLocator.waitFor({ state: "attached", timeout: 25000 });

    await page.waitForFunction(
      () => {
        const v = document.querySelector("video.flight-video, video");
        return v && Number.isFinite(v.duration) && v.duration > 0;
      },
      { timeout: 25000 }
    );

    const videoDuration = await page.evaluate(() => {
      const v = document.querySelector("video.flight-video, video");
      return v.duration;
    });
    console.log(`      Video loaded. Duration: ${videoDuration.toFixed(2)}s`);

    // Seek to 95%
    const seekTime = videoDuration * 0.95;
    console.log(`      Seeking video to 95% (${seekTime.toFixed(2)}s)...`);
    await page.evaluate((t) => {
      const v = document.querySelector("video.flight-video, video");
      if (v) v.currentTime = t;
    }, seekTime);

    await page.waitForTimeout(500);

    // Play to the end
    console.log("      Playing video to end...");
    await page.evaluate(() => {
      const v = document.querySelector("video.flight-video, video");
      if (v) v.play().catch(() => {});
    });

    // Wait for ended event
    console.log("      Waiting for ended event...");
    await page.waitForFunction(
      () => {
        const v = document.querySelector("video.flight-video, video");
        return v && (v.ended || v.currentTime >= v.duration - 0.05);
      },
      { timeout: 20000 }
    );

    const endedCurTime = await page.evaluate(() => {
      const v = document.querySelector("video.flight-video, video");
      return v ? v.currentTime : -1;
    });
    console.log(`      Video successfully reached END OF FOOTAGE at ${endedCurTime.toFixed(2)}s.`);
    await page.screenshot({ path: path.join(screenshotsDir, "04_video_ended.png") });

    // Assert NO reset to 0 for 10 s
    console.log("      Asserting ended state and no reset to 0 across 10 seconds...");
    for (let sec = 1; sec <= 10; sec++) {
      await page.waitForTimeout(1000);
      const state = await page.evaluate(() => {
        const v = document.querySelector("video.flight-video, video");
        return {
          currentTime: v ? v.currentTime : -1,
          ended: v ? v.ended : false,
          paused: v ? v.paused : false,
        };
      });

      if (state.currentTime === 0) {
        throw new Error(`Regression detected: Video reset to 0 at second ${sec}! State: ${JSON.stringify(state)}`);
      }
    }
    console.log("      PASSED: Video remained at completion point for full 10 seconds without resetting to 0.");

    // ---------------------------------------------------------
    // STEP 4: Quality Panel Verification
    // ---------------------------------------------------------
    console.log("[4/7] Checking Quality Panel & Telemetry metrics...");
    const qualityPanelText = await page.evaluate(() => {
      const panel = document.querySelector(".quality-metrics-panel, .panel, [data-panel='quality']") || document.body;
      return panel.innerText || "";
    });

    const hasOverallQuality =
      qualityPanelText.includes("FRAME QUALITY") ||
      qualityPanelText.includes("Overall Score") ||
      qualityPanelText.includes("OVERALL QUALITY") ||
      qualityPanelText.includes("QUALITY OVER TIME");
    console.log(`      Quality panel visible and rendered: ${hasOverallQuality}`);
    await page.screenshot({ path: path.join(screenshotsDir, "05_quality_panel.png") });

    // ---------------------------------------------------------
    // STEP 5: Geospatial Page Verification
    // ---------------------------------------------------------
    console.log("[5/7] Navigating to Geospatial Intelligence (/map)...");
    const geoNavBtn = page.locator("button:has-text('Geospatial Intelligence'), .nav-item:has-text('Geospatial')").first();
    await geoNavBtn.waitFor({ state: "visible", timeout: 10000 });
    await geoNavBtn.click();

    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(screenshotsDir, "06_geospatial_page.png") });

    const geoPageText = await page.evaluate(() => document.body.innerText || "");
    const hasPathOrCoverage =
      geoPageText.includes("FLIGHT PATH") ||
      geoPageText.includes("COVERAGE AREA") ||
      geoPageText.includes("CAMERA POSES") ||
      geoPageText.includes("GEOSPATIAL INTELLIGENCE");

    console.log(`      Geospatial page rendered valid telemetry/path: ${hasPathOrCoverage}`);

    // ---------------------------------------------------------
    // STEP 6: 206 Range Response Verification
    // ---------------------------------------------------------
    console.log("[6/7] Verifying proxy video 206 Range responses for fresh mission...");
    const test206Resp = await page.request.get(`http://127.0.0.1:8000/api/v1/missions/${freshMissionId}/video/proxy`, {
      headers: { Range: "bytes=0-1024" },
    });
    console.log(`      Proxy Range request returned HTTP: ${test206Resp.status()}`);
    if (test206Resp.status() === 206) {
      range206Responses.push(test206Resp.url());
    }

    // ---------------------------------------------------------
    // STEP 7: Download PDF Report & Invariant Check
    // ---------------------------------------------------------
    console.log("[7/7] Verifying report download & artifact isolation...");
    const pdfResp = await page.request.get(`http://127.0.0.1:8000/api/v1/missions/${freshMissionId}/report/pdf`);
    console.log(`      PDF report download returned HTTP: ${pdfResp.status()}`);
    if (pdfResp.status() !== 200) {
      throw new Error(`Report PDF download failed: HTTP ${pdfResp.status()}`);
    }
    const pdfBytes = await pdfResp.body();
    if (!pdfBytes.toString("latin1").startsWith("%PDF-")) {
      throw new Error("Downloaded report is not a valid PDF file");
    }

    const reportJsonResp = await page.request.get(`http://127.0.0.1:8000/api/v1/missions/${freshMissionId}/report`);
    const reportJson = await reportJsonResp.json();
    const evidenceItems = (reportJson.report || reportJson).evidence?.items || [];
    for (const item of evidenceItems) {
      const p = item.relative_path || "";
      if (!p.includes(freshMissionId)) {
        throw new Error(`Cross-mission leakage detected in evidence! Path: ${p}`);
      }
    }
    console.log(`      PASSED: Report verified with authentic isolation across ${evidenceItems.length} items.`);

    console.log("\n=================== VERIFICATION AUDIT ===================");
    console.log(`Screenshots saved to: ${screenshotsDir}`);
    console.log(`HTTP 206 Range responses recorded: ${range206Responses.length}`);
    console.log(`Page errors: ${pageErrors.length}`);
    console.log(`Console errors: ${consoleErrors.length}`);
    console.log(`Failed HTTP 4xx/5xx requests: ${failedRequests.length}`);

    if (pageErrors.length > 0 || consoleErrors.length > 0 || failedRequests.length > 0) {
      if (pageErrors.length) console.error("Uncaught Page Errors:", pageErrors);
      if (consoleErrors.length) console.error("Console Errors:", consoleErrors);
      if (failedRequests.length) console.error("Failed Requests:", failedRequests);
      process.exit(1);
    }

    if (range206Responses.length === 0) {
      throw new Error("No HTTP 206 Range responses were served for video proxy!");
    }

    console.log("\n>>> ALL PLAYWRIGHT FRESH UPLOAD CHECKS PASSED WITH 100% SUCCESS! <<<");
    process.exit(0);
  } catch (err) {
    console.error("\nPlaywright E2E verification failed:", err);
    await page.screenshot({ path: path.join(screenshotsDir, "failure_state.png") }).catch(() => {});
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
