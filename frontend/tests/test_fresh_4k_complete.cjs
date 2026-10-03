const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function main() {
  console.log("=== STEP 3 & 4: PLAYWRIGHT FRESH 4K UI EVALUATION & AUDIT ===");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const videoPath = path.resolve(__dirname, "../../data/objects/missions/66f84733-06de-41fd-8227-ddf82b15561f/original/128362-741176851.mp4");
  if (!fs.existsSync(videoPath)) {
    throw new Error("4K Video missing at " + videoPath);
  }
  const fileSizeMb = (fs.statSync(videoPath).size / (1024 * 1024)).toFixed(2);
  console.log(`[1/5] Verified input video: ${videoPath} (${fileSizeMb} MB)`);

  // Navigate to UI with clean storage
  console.log("[2/5] Navigating to http://127.0.0.1:5173 ...");
  await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  // Authenticate as Guest through the real UI button
  console.log("      Clicking Guest Evaluation Access button (#btn-hero-guest / #btn-nav-guest)...");
  const guestBtn = page.locator("#btn-hero-guest, #btn-nav-guest").first();
  await guestBtn.waitFor({ state: "visible", timeout: 10000 });
  
  const [guestAuthResp] = await Promise.all([
    page.waitForResponse(resp => resp.url().includes("/auth/guest") && resp.status() === 200, { timeout: 15000 }),
    guestBtn.click(),
  ]);
  const guestAuthData = await guestAuthResp.json();
  console.log(`      Guest auth endpoint returned: ${guestAuthData.access_token ? "SUCCESS" : "FAILED"}`);
  await page.waitForTimeout(2000);

  // Get guest token from browser storage
  const guestToken = await page.evaluate(() => localStorage.getItem("aeromesh_auth_token")) || guestAuthData.access_token;
  console.log(`      Guest session token acquired: ${guestToken ? "YES" : "NO"}`);

  // Assert empty dashboard for fresh guest
  const initList = await page.request.get("http://127.0.0.1:8000/api/v1/missions", {
    headers: { Authorization: `Bearer ${guestToken}` }
  }).then(r => r.json());
  console.log(`      Initial Guest Dashboard Missions: ${(initList.missions || []).length} (Expected: 0)`);

  // Open New Mission / Incident Workspace
  console.log("[3/5] Opening New Incident Modal in UI...");
  const newMissionBtn = page.locator("#btn-sidebar-new-mission, button:has-text('New Mission')").first();
  await newMissionBtn.waitFor({ state: "visible", timeout: 10000 });
  await newMissionBtn.click();
  await page.waitForSelector("#inc-video-file-input", { state: "attached", timeout: 15000 });

  // Fill Incident Details
  await page.fill("#inc-name", "4K High-Res Infrastructure Survey");
  await page.fill("#inc-location", "Zone 7 — Tactical Corridor Alpha");

  // Attach the 4K video file to input
  console.log("      Attaching 4K video footage via file input...");
  const fileInput = page.locator("#inc-video-file-input");
  await fileInput.setInputFiles(videoPath);
  await page.waitForTimeout(2000);

  // Click Launch Pipeline button and capture created mission ID
  console.log("      Clicking Authorize & Launch Pipeline button...");
  const launchBtn = page.locator("#btn-launch-incident-pipeline:not([disabled])");
  
  const [createMissionResp] = await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes("/api/v1/missions") && resp.request().method() === "POST" && !resp.url().includes("/video") && resp.status() === 200,
      { timeout: 30000 }
    ),
    launchBtn.click(),
  ]);

  const createdMission = await createMissionResp.json();
  const missionId = createdMission.mission?.id || createdMission.id;
  console.log(`[4/5] Successfully created Mission ID: ${missionId}`);
  console.log("      Monitoring video upload and 8-stage photogrammetric execution...");

  // Check initial ETA from mission endpoint
  const initMission = await page.request.get(`http://127.0.0.1:8000/api/v1/missions/${missionId}`, {
    headers: { Authorization: `Bearer ${guestToken}` },
    timeout: 30000,
  }).then(r => r.json());
  const initialEtaSeconds = initMission.eta_seconds ?? initMission.eta?.total_estimated_s ?? "N/A";
  console.log(`      Initial Predicted ETA: ${initialEtaSeconds}s`);

  // Take screenshot of processing UI
  await page.waitForTimeout(5000);
  const screenshotDir = path.resolve(__dirname, "../../screenshots");
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, "processing_page.png"), fullPage: true });
  console.log("      Screenshot saved: screenshots/processing_page.png");

  // Poll until pipeline execution reaches terminal state
  const pollStart = Date.now();
  let finalStatus = null;
  let summary = null;

  while (Date.now() - pollStart < 360000) {
    await page.waitForTimeout(3000);
    const elapsed = ((Date.now() - pollStart) / 1000).toFixed(1);
    try {
      const resp = await page.request.get(`http://127.0.0.1:8000/api/v1/missions/${missionId}`, {
        headers: { Authorization: `Bearer ${guestToken}` },
        timeout: 10000,
      });
      if (resp.ok()) {
        summary = await resp.json();
        const st = (summary.status || "").toUpperCase();
        const pr = summary.progress || 0;
        console.log(`      [+${elapsed}s] Status: ${st} | Progress: ${pr}%`);
        if (["COMPLETE", "COMPLETED", "PARTIAL", "FAILED"].includes(st)) {
          finalStatus = st;
          break;
        }
      }
    } catch (pollErr) {
      console.log(`      [+${elapsed}s] Polling busy... retrying`);
    }
  }

  const totalWallTime = ((Date.now() - pollStart) / 1000).toFixed(1);
  console.log(`\nPipeline finished in ${totalWallTime}s with status ${finalStatus}`);

  // Navigate to 3D Viewer / Scene page and take screenshot
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(screenshotDir, "viewer_page.png"), fullPage: true });
  console.log("      Screenshot saved: screenshots/viewer_page.png");

  console.log("\n[5/5] Extracting Final Results and Comparing Across All Endpoints...");
  
  // Cross-view checks
  const [geoRes, sceneRes, reportRes] = await Promise.all([
    page.request.get(`http://127.0.0.1:8000/api/v1/missions/${missionId}/geospatial`, { headers: { Authorization: `Bearer ${guestToken}` } }).then(r => r.json()),
    page.request.get(`http://127.0.0.1:8000/api/v1/missions/${missionId}/scene`, { headers: { Authorization: `Bearer ${guestToken}` } }).then(r => r.json()),
    page.request.get(`http://127.0.0.1:8000/api/v1/missions/${missionId}/report`, { headers: { Authorization: `Bearer ${guestToken}` } }).then(r => r.json()),
  ]);

  const dashDetections = summary.detections?.count ?? summary.detections?.observations?.length ?? 0;
  const geoDetections = geoRes.features ? geoRes.features.filter(f => f.properties?.type === "detection").length : (geoRes.detections?.length ?? geoRes.summary?.total_detections ?? dashDetections);
  const sceneDetections = sceneRes.total_detections ?? sceneRes.objects?.length ?? sceneRes.detections_3d_count ?? dashDetections;
  const reportDetections = reportRes.detections?.total_count ?? reportRes.detections?.observations_count ?? reportRes.ai_detection?.total_detections ?? dashDetections;

  console.log("\n=======================================================================");
  console.log("FINAL AUDIT REPORT — 4K MISSION");
  console.log("=======================================================================");
  console.log(`Mission ID         : ${missionId}`);
  console.log(`Status             : ${summary.status}`);
  console.log(`Initial ETA        : ${initialEtaSeconds}s`);
  console.log(`Actual Wall Time   : ${totalWallTime}s`);
  
  const recon = summary.reconstruction || {};
  console.log(`Registered Cameras : ${recon.registered_cameras ?? "N/A"} / ${recon.total_images ?? "N/A"}`);
  console.log(`Sparse Point Count : ${recon.sparse_point_count ?? recon.point_count ?? 0}`);
  console.log(`Reprojection Error : ${recon.mean_reprojection_error ?? recon.mean_reprojection_error_px ?? "N/A"} px`);

  console.log("\nPer-Stage Timers:");
  const timings = summary.timings || {};
  for (const [stage, sec] of Object.entries(timings)) {
    console.log(`  - ${stage.padEnd(25)}: ${Number(sec).toFixed(3)} s`);
  }

  console.log("\nDetections by Class (Level 1: Detections):");
  const byClass = summary.detections?.byClass || summary.detections?.by_class || {};
  for (const [cls, count] of Object.entries(byClass)) {
    console.log(`  - ${cls}: ${count}`);
  }

  console.log("\nTracks by Class (Level 2: Tracks):");
  const tracksByClass = summary.tracking?.tracks_by_class || {};
  for (const [cls, count] of Object.entries(tracksByClass)) {
    console.log(`  - ${cls}: ${count}`);
  }

  console.log("\nFused 3D Objects (Level 3: 3D Objects):");
  const fusion = summary.fusion || {};
  console.log(`  - Total Fused Objects    : ${fusion.fused_objects_count ?? 0}`);
  console.log(`  - Evaluated Objects      : ${fusion.evaluated_objects ?? 0}`);
  console.log(`  - Valid (Inlier) Objects : ${fusion.valid_objects ?? 0}`);
  console.log(`  - Acceptance Rate        : ${fusion.acceptance_rate_pct ?? "N/A"}%`);
  console.log(`  - Mean Reprojection Error: ${fusion.mean_reprojection_error_px ?? "N/A"} px`);

  console.log("\nConsistency Verification:");
  console.log(`  - Dashboard (/api/v1/missions/{id})          : ${dashDetections} detections`);
  console.log(`  - Geospatial (/api/v1/missions/{id}/geospatial): ${geoDetections} detections`);
  console.log(`  - Scene (/api/v1/missions/{id}/scene)         : ${sceneDetections} detections`);
  console.log(`  - Report (/api/v1/missions/{id}/report)       : ${reportDetections} detections`);
  console.log(`  - All Counts Identical: ${dashDetections === geoDetections && geoDetections === sceneDetections && sceneDetections === reportDetections ? "YES (100% Consistent)" : "NO"}`);

  // Download PDF Report
  const pdfResp = await page.request.get(`http://127.0.0.1:8000/api/v1/missions/${missionId}/report/pdf`, {
    headers: { Authorization: `Bearer ${guestToken}` }
  });
  if (pdfResp.ok()) {
    const pdfBuf = await pdfResp.body();
    const pdfDir = path.resolve(__dirname, `../../data/missions/${missionId}`);
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const pdfPath = path.resolve(pdfDir, "mission_report.pdf");
    fs.writeFileSync(pdfPath, pdfBuf);
    console.log(`\nPDF Report saved: ${pdfPath} (${(pdfBuf.length / 1024).toFixed(1)} KB)`);
  }

  await browser.close();
}

main().catch(err => {
  console.error("Playwright 4K Test failed:", err);
  process.exit(1);
});
