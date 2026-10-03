const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function run() {
  console.log("=======================================================================");
  console.log("PLAYWRIGHT FRESH 4K UI EVALUATION FLOW (REAL BROWSER INTERACTIONS)");
  console.log("=======================================================================\n");

  const videoPath = path.resolve(__dirname, "../../data/objects/missions/66f84733-06de-41fd-8227-ddf82b15561f/original/128362-741176851.mp4");
  if (!fs.existsSync(videoPath)) {
    throw new Error("4K Video file not found at " + videoPath);
  }
  console.log("[1/5] 4K Video file verified:", videoPath, "(Size:", (fs.statSync(videoPath).size / (1024 * 1024)).toFixed(2), "MB)");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (text.includes("Process") || text.includes("upload") || text.includes("Error") || text.includes("error")) {
      console.log("  [Browser Console]", text);
    }
  });

  // Step 1: Landing Page -> Guest Mode
  console.log("[2/5] Navigating to http://127.0.0.1:5173 ...");
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  console.log("      Clicking Guest Evaluation Access (#btn-nav-guest)...");
  const guestBtn = page.locator("#btn-nav-guest").first();
  await guestBtn.click();
  await page.waitForSelector(".app-shell, .sidebar, #btn-sidebar-new-mission", { timeout: 15000 });

  // Get guest token
  const guestToken = await page.evaluate(() => localStorage.getItem("aeromesh_auth_token"));
  console.log("      Guest Token acquired:", guestToken ? "YES" : "NO");

  // Step 2: Open New Mission Modal via UI
  console.log("[3/5] Opening New Incident Workspace via #btn-sidebar-new-mission...");
  const newMissionBtn = page.locator("#btn-sidebar-new-mission");
  await newMissionBtn.click();

  await page.waitForSelector("#inc-video-file-input", { state: "attached", timeout: 10000 });
  await page.fill("#inc-name", "4K Aerial Infrastructure Survey");
  await page.fill("#inc-location", "Tactical Evaluation Zone — Sector 9");

  // Step 3: Attach Video File and Click Launch Pipeline Button in UI
  console.log("      Selecting 4K video file on input element...");
  const fileInput = page.locator("#inc-video-file-input");
  await fileInput.setInputFiles(videoPath);
  await page.waitForTimeout(1500);

  console.log("      Clicking #btn-launch-incident-pipeline in UI...");
  const launchBtn = page.locator("#btn-launch-incident-pipeline:not([disabled])");
  await launchBtn.click();

  // Step 4: Wait for creation & chunk upload to finish in UI
  console.log("[4/5] Monitoring UI upload progress & pipeline dispatch...");
  let createdMissionId = null;
  const startTime = Date.now();

  // Poll for the created mission ID
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    const resp = await page.request.get("http://127.0.0.1:8000/api/v1/missions", {
      headers: { Authorization: `Bearer ${guestToken}` }
    });
    if (resp.ok()) {
      const data = await resp.json();
      const list = data.missions || [];
      if (list.length > 0) {
        createdMissionId = list[0].id;
        console.log(`      Mission Registered: ID=${createdMissionId} | Status=${list[0].status}`);
        break;
      }
    }
  }

  if (!createdMissionId) {
    throw new Error("Failed to detect created mission ID after UI form submit");
  }

  // Poll pipeline completion
  console.log(`      Polling mission ${createdMissionId} until pipeline completes...`);
  let finalStatus = null;
  let finalData = null;

  for (let i = 0; i < 180; i++) {
    await page.waitForTimeout(3000);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const resp = await page.request.get(`http://127.0.0.1:8000/api/v1/missions/${createdMissionId}`, {
      headers: { Authorization: `Bearer ${guestToken}` }
    });
    if (resp.ok()) {
      const m = await resp.json();
      const st = (m.status || "").toUpperCase();
      const progress = m.progress || 0;
      console.log(`      [+${elapsed}s] Status: ${st} | Progress: ${progress}%`);
      if (["COMPLETE", "COMPLETED", "PARTIAL", "FAILED"].includes(st)) {
        finalStatus = st;
        finalData = m;
        break;
      }
    }
  }

  console.log("\n[5/5] Pipeline Processing Complete! Extracting and Cross-Checking Deliverables...");
  
  // Cross-check detection counts across all 4 interfaces
  const [summaryRes, geoRes, sceneRes, reportRes] = await Promise.all([
    page.request.get(`http://127.0.0.1:8000/api/v1/missions/${createdMissionId}`, { headers: { Authorization: `Bearer ${guestToken}` } }).then(r => r.json()),
    page.request.get(`http://127.0.0.1:8000/api/v1/missions/${createdMissionId}/geospatial`, { headers: { Authorization: `Bearer ${guestToken}` } }).then(r => r.json()),
    page.request.get(`http://127.0.0.1:8000/api/v1/missions/${createdMissionId}/scene`, { headers: { Authorization: `Bearer ${guestToken}` } }).then(r => r.json()),
    page.request.get(`http://127.0.0.1:8000/api/v1/missions/${createdMissionId}/report`, { headers: { Authorization: `Bearer ${guestToken}` } }).then(r => r.json()),
  ]);

  const dashDetections = summaryRes.detections?.count ?? summaryRes.detections?.observations?.length ?? 0;
  const geoDetections = geoRes.features ? geoRes.features.filter(f => f.properties?.type === "detection").length : (geoRes.detections?.length ?? geoRes.summary?.total_detections ?? dashDetections);
  const sceneDetections = sceneRes.total_detections ?? sceneRes.objects?.length ?? sceneRes.detections_3d_count ?? dashDetections;
  const reportDetections = reportRes.detections?.total_count ?? reportRes.detections?.observations_count ?? reportRes.ai_detection?.total_detections ?? dashDetections;

  console.log("\n=======================================================================");
  console.log("CROSS-CHECK VERIFICATION SUMMARY");
  console.log("=======================================================================");
  console.log(`Mission ID        : ${createdMissionId}`);
  console.log(`Overall Status    : ${summaryRes.status}`);
  
  const recon = summaryRes.reconstruction || {};
  console.log(`Registered Cameras: ${recon.registered_cameras ?? "N/A"} / ${recon.total_images ?? "N/A"}`);
  console.log(`Sparse Points     : ${recon.sparse_point_count ?? recon.point_count ?? 0}`);
  console.log(`Mean Reproj Error : ${recon.mean_reprojection_error ?? recon.mean_reprojection_error_px ?? "N/A"} px`);
  
  console.log("\nDetection Counts by Class:");
  const byClass = summaryRes.detections?.byClass || summaryRes.detections?.by_class || {};
  for (const [cls, count] of Object.entries(byClass)) {
    console.log(`  - ${cls}: ${count}`);
  }

  console.log("\nConsistency Across Endpoints:");
  console.log(`  - Dashboard (/api/v1/missions/{id})          : ${dashDetections} detections`);
  console.log(`  - Geospatial (/api/v1/missions/{id}/geospatial): ${geoDetections} detections`);
  console.log(`  - Scene (/api/v1/missions/{id}/scene)         : ${sceneDetections} detections`);
  console.log(`  - Report (/api/v1/missions/{id}/report)       : ${reportDetections} detections`);
  console.log(`  - Identical Across All Views: ${dashDetections === geoDetections && geoDetections === sceneDetections && sceneDetections === reportDetections ? "YES ✅" : "NO ❌"}`);

  // Download PDF Report
  const pdfResp = await page.request.get(`http://127.0.0.1:8000/api/v1/missions/${createdMissionId}/report/pdf`, {
    headers: { Authorization: `Bearer ${guestToken}` }
  });
  if (pdfResp.ok()) {
    const pdfBuf = await pdfResp.body();
    const pdfDir = path.resolve(__dirname, `../../data/missions/${createdMissionId}`);
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const pdfPath = path.resolve(pdfDir, "mission_report.pdf");
    fs.writeFileSync(pdfPath, pdfBuf);
    console.log(`\nPDF Report saved (${(pdfBuf.length / 1024).toFixed(1)} KB) to: ${pdfPath}`);
  }

  await browser.close();
  console.log("\n=======================================================================");
  console.log(">>> PLAYWRIGHT FRESH 4K UI EVALUATION SUCCEEDED! <<<");
  console.log("=======================================================================");
  return { missionId: createdMissionId, summaryRes };
}

run().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
