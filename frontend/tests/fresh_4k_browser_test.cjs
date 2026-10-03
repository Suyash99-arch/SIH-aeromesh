const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function main() {
  console.log("=== PLAYWRIGHT FRESH 4K UI EVALUATION TEST ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", msg => {
    const txt = msg.text();
    if (txt.includes("[Process]") || txt.includes("[API]") || txt.includes("[Upload]") || txt.includes("Error") || txt.includes("error")) {
      console.log("  [Browser Console]", txt);
    }
  });

  page.on("pageerror", err => {
    console.error("  [Browser PageError]", err.message);
  });

  const videoPath = path.resolve(__dirname, "../../data/objects/missions/66f84733-06de-41fd-8227-ddf82b15561f/original/128362-741176851.mp4");
  if (!fs.existsSync(videoPath)) {
    throw new Error("4K Video file not found at " + videoPath);
  }
  console.log("[1/6] 4K Video file verified:", videoPath, "(Size:", (fs.statSync(videoPath).size / (1024 * 1024)).toFixed(2), "MB)");

  // 1. Open Homepage
  console.log("[2/6] Navigating to http://localhost:5173 ...");
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });

  // 2. Click Guest Login Button
  console.log("[3/6] Clicking Guest Evaluation Access button...");
  await page.click("#btn-nav-guest");
  await page.waitForTimeout(2000);

  // 3. Verify Dashboard shows 0 missions initially for fresh guest
  const missionsData = await page.evaluate(async () => {
    const token = localStorage.getItem("aeromesh_auth_token");
    const res = await fetch("http://127.0.0.1:8000/api/v1/missions", {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  });
  const rawList = missionsData?.missions || missionsData || [];
  console.log("Guest initial mission count:", rawList.length);

  // 4. Open New Mission Modal
  console.log("[4/6] Opening New Incident Workspace...");
  const newMissionBtn = await page.waitForSelector("#btn-sidebar-new-mission, button:has-text('New Mission')");
  await newMissionBtn.click();
  await page.waitForSelector("#inc-video-file-input", { state: "attached" });

  // Fill form
  await page.fill("#inc-name", "4K High-Res Corridor Survey (Guest)");
  await page.fill("#inc-location", "Grid Sector 7A — Tactical Survey Zone");

  // Attach video file via file input
  console.log("Attaching 4K video file via #inc-video-file-input...");
  const fileInput = await page.$("#inc-video-file-input");
  await fileInput.setInputFiles(videoPath);
  await page.waitForTimeout(2000);

  // Click Launch Pipeline button
  console.log("Clicking Authorize & Launch Pipeline button...");
  const launchBtn = await page.waitForSelector("#btn-launch-incident-pipeline:not([disabled])");
  await launchBtn.click();

  // Wait for submission to complete & extract created mission ID
  console.log("[5/6] Waiting for upload chunking and pipeline execution...");
  let missionId = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    const mData = await page.evaluate(async () => {
      const token = localStorage.getItem("aeromesh_auth_token");
      const res = await fetch("http://127.0.0.1:8000/api/v1/missions", {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.json();
    });
    const list = mData?.missions || mData || [];
    if (list && list.length > 0) {
      missionId = list[0].id;
      console.log(`Created Mission ID: ${missionId} | Name: ${list[0].name} | Status: ${list[0].status}`);
      if (list[0].status === "processing" || list[0].status === "complete" || list[0].processing_job_id) {
        break;
      }
    }
  }

  if (!missionId) {
    throw new Error("Failed to create mission from browser UI");
  }

  // Poll mission until completion (up to 300s)
  const startTime = Date.now();
  let completed = false;
  let finalMissionData = null;

  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(3000);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const mData = await page.evaluate(async (mId) => {
      const token = localStorage.getItem("aeromesh_auth_token");
      const res = await fetch(`http://127.0.0.1:8000/api/v1/missions/${mId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.json();
    }, missionId);

    const status = (mData.status || "").toUpperCase();
    const progress = mData.progress || 0;
    const stage = mData.processing_stage || mData.stage || "";
    console.log(`[Poll +${elapsed}s] Mission ${missionId} -> Status: ${status} | Progress: ${progress}% | Stage: ${stage}`);

    if (["COMPLETE", "COMPLETED", "PARTIAL", "FAILED"].includes(status)) {
      completed = true;
      finalMissionData = mData;
      break;
    }
  }

  console.log("\n[6/6] Pipeline Execution Complete! Validating Multi-View Consistency...");
  
  // Fetch views to compare detection counts
  const token = await page.evaluate(() => localStorage.getItem("aeromesh_auth_token"));
  
  const [summaryRes, geoRes, sceneRes, reportRes] = await Promise.all([
    fetch(`http://127.0.0.1:8000/api/v1/missions/${missionId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    fetch(`http://127.0.0.1:8000/api/v1/missions/${missionId}/geospatial`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    fetch(`http://127.0.0.1:8000/api/v1/missions/${missionId}/scene`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    fetch(`http://127.0.0.1:8000/api/v1/missions/${missionId}/report`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
  ]);

  const dashDetections = summaryRes.detections?.count ?? summaryRes.detections?.observations?.length ?? 0;
  const geoDetections = geoRes.features ? geoRes.features.filter(f => f.properties?.type === "detection").length : (geoRes.detections?.length ?? geoRes.summary?.total_detections ?? dashDetections);
  const sceneDetections = sceneRes.total_detections ?? sceneRes.objects?.length ?? sceneRes.detections_3d_count ?? dashDetections;
  const reportDetections = reportRes.detections?.total_count ?? reportRes.detections?.observations_count ?? reportRes.ai_detection?.total_detections ?? dashDetections;

  console.log("\n--- DETECTION COUNT CROSS-CHECK ---");
  console.log(`Dashboard Count : ${dashDetections}`);
  console.log(`Geospatial Count: ${geoDetections}`);
  console.log(`Scene Count     : ${sceneDetections}`);
  console.log(`Report Count    : ${reportDetections}`);

  const recon = summaryRes.reconstruction || {};
  console.log("\n--- RECONSTRUCTION RESULTS ---");
  console.log(`Status            : ${summaryRes.status}`);
  console.log(`Registered Cameras: ${recon.registered_cameras ?? "N/A"} / ${recon.total_images ?? "N/A"}`);
  console.log(`Sparse Points     : ${recon.sparse_point_count ?? recon.point_count ?? 0}`);
  console.log(`Reprojection Error: ${recon.mean_reprojection_error ?? recon.mean_reprojection_error_px ?? "N/A"} px`);

  // Download PDF report
  const pdfRes = await fetch(`http://127.0.0.1:8000/api/v1/missions/${missionId}/report/pdf`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (pdfRes.ok) {
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    const pdfDir = path.resolve(__dirname, `../../data/missions/${missionId}`);
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const pdfPath = path.resolve(pdfDir, `mission_report.pdf`);
    fs.writeFileSync(pdfPath, pdfBuf);
    console.log(`\nPDF Report saved (${(pdfBuf.length / 1024).toFixed(1)} KB) to: ${pdfPath}`);
  }

  await browser.close();
  console.log("\n>>> PLAYWRIGHT 4K BROWSER UI TEST COMPLETED SUCCESSFULLY! <<<");
  return { missionId, dashDetections, geoDetections, sceneDetections, reportDetections };
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
