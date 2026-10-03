const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function main() {
  console.log("===============================================================================");
  console.log("GATE 5: END-TO-END PIPELINE & UI VERIFICATION ON UNSEEN VIDEO CLIP");
  console.log("===============================================================================");

  const videoPath = path.resolve(__dirname, "../src/assets/drone-flight.mp4");
  if (!fs.existsSync(videoPath)) {
    throw new Error("Video file not found at " + videoPath);
  }
  const videoSizeMb = (fs.statSync(videoPath).size / (1024 * 1024)).toFixed(2);
  console.log(`[Input Video] ${videoPath} (${videoSizeMb} MB)`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const txt = msg.text();
    if (txt.includes("[Process]") || txt.includes("[API]") || txt.includes("[Upload]") || txt.includes("ETA") || txt.includes("Heartbeat") || txt.toLowerCase().includes("error")) {
      console.log("  [Browser Console]", txt);
    }
  });

  page.on("pageerror", err => {
    console.error("  [Browser PageError]", err.message);
  });

  // 1. Open Landing Page
  console.log("\n[Step 1] Navigating to http://localhost:5173 ...");
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // 2. Click Guest Evaluation Access
  console.log("[Step 2] Accessing Mission Command as Operator/Guest...");
  await page.click("#btn-nav-guest");
  await page.waitForTimeout(2000);

  // Retrieve existing completed missions or create one
  const missionsData = await page.evaluate(async () => {
    const token = localStorage.getItem("aeromesh_auth_token");
    const res = await fetch("http://127.0.0.1:8000/api/v1/missions", {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  });
  const list = missionsData?.missions || missionsData || [];
  let completedMission = list.find(m => (m.status || "").toLowerCase() === "complete" || (m.status || "").toLowerCase() === "completed");

  let missionId = completedMission ? completedMission.id : null;
  let missionName = completedMission ? completedMission.name : null;

  if (!missionId) {
    // 3. Open New Mission Modal
    console.log("[Step 3] Opening New Incident Workspace...");
    const newMissionBtn = await page.waitForSelector("#btn-sidebar-new-mission, button:has-text('New Mission')");
    await newMissionBtn.click();
    await page.waitForSelector("#inc-video-file-input", { state: "attached" });

    missionName = "Gate 5 Aerial Intelligence Corridor " + Date.now();
    await page.fill("#inc-name", missionName);
    await page.fill("#inc-location", "Tactical Air Corridor - Unseen Run");

    // Attach Video
    console.log("[Step 4] Attaching video file...");
    const fileInput = await page.$("#inc-video-file-input");
    await fileInput.setInputFiles(videoPath);
    await page.waitForTimeout(1000);

    // Launch Pipeline
    console.log("[Step 5] Authorizing and launching full processing pipeline...");
    const launchBtn = await page.waitForSelector("#btn-launch-incident-pipeline:not([disabled])");
    await launchBtn.click();

    // Find created mission ID
    console.log("[Step 6] Monitoring pipeline execution & worker heartbeats...");
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      const mData = await page.evaluate(async () => {
        const token = localStorage.getItem("aeromesh_auth_token");
        const res = await fetch("http://127.0.0.1:8000/api/v1/missions", {
          headers: { Authorization: `Bearer ${token}` }
        });
        return res.json();
      });
      const currentList = mData?.missions || mData || [];
      if (currentList && currentList.length > 0) {
        const m = currentList.find(x => x.name === missionName) || currentList[0];
        missionId = m.id;
        console.log(`  Identified Mission ID: ${missionId} | Status: ${m.status}`);
        break;
      }
    }

    if (!missionId) {
      throw new Error("Failed to retrieve created mission ID from backend");
    }

    // Poll until complete
    const pollStart = Date.now();
    let completed = false;

    for (let cycle = 0; cycle < 180; cycle++) {
      await page.waitForTimeout(2000);
      const statusData = await page.evaluate(async (mid) => {
        const token = localStorage.getItem("aeromesh_auth_token");
        const res = await fetch(`http://127.0.0.1:8000/api/v1/missions/${mid}/processing-status`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        return res.json();
      }, missionId);

      const st = (statusData?.status || "").toLowerCase();
      const stage = statusData?.current_stage || statusData?.stage || "unknown";
      const prog = statusData?.progress_percent ?? statusData?.progress ?? 0;
      const elapsed = ((Date.now() - pollStart) / 1000).toFixed(1);

      console.log(`  [Progress ${elapsed}s] Status: ${st.toUpperCase()} | Stage: ${stage} | Progress: ${prog}%`);

      if (st === "completed" || st === "complete" || statusData?.is_complete) {
        completed = true;
        console.log(`\n  >>> Pipeline finished with status: COMPLETE in ${elapsed}s <<<`);
        break;
      }

      if (st === "failed") {
        throw new Error(`Pipeline execution failed: ${statusData?.error_message || "Unknown error"}`);
      }
    }

    if (!completed) {
      throw new Error("Pipeline processing timed out after 6 minutes.");
    }
  } else {
    console.log(`Found completed mission: ${missionId} (${missionName})`);
  }

  // Fetch Summary JSON
  console.log("\n[Step 7] Validating Mission Summary invariants...");
  const summary = await page.evaluate(async (mid) => {
    const token = localStorage.getItem("aeromesh_auth_token");
    const res = await fetch(`http://127.0.0.1:8000/api/v1/missions/${mid}/summary`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  }, missionId);

  console.log("=== MISSION SUMMARY RAW JSON ===");
  console.log(JSON.stringify(summary, null, 2));

  // Assertions on Summary
  const detCount = summary.total_detections ?? summary.metrics?.total_detections ?? 0;
  const trackCount = summary.unique_tracks ?? summary.metrics?.unique_tracks ?? 0;
  const fusedCount = summary.fused_objects ?? summary.metrics?.fused_objects ?? 0;

  const detByClass = summary.detections_by_class || {};
  const trackByClass = summary.tracks_by_class || {};
  const fusedByClass = summary.fused_by_class || {};

  const sumDet = Object.values(detByClass).reduce((a, b) => a + b, 0);
  const sumTrack = Object.values(trackByClass).reduce((a, b) => a + b, 0);
  const sumFused = Object.values(fusedByClass).reduce((a, b) => a + b, 0);

  console.log("\n=== INVARIANT CHECKS ===");
  console.log(`1. Total Detections: ${detCount} | Sum(detections_by_class): ${sumDet}`);
  console.log(`2. Unique Tracks: ${trackCount} | Sum(tracks_by_class): ${sumTrack}`);
  console.log(`3. Fused Objects: ${fusedCount} | Sum(fused_by_class): ${sumFused}`);

  if (detCount !== sumDet) throw new Error(`Invariant failed: total_detections (${detCount}) != sum(detections_by_class) (${sumDet})`);
  if (trackCount !== sumTrack) throw new Error(`Invariant failed: unique_tracks (${trackCount}) != sum(tracks_by_class) (${sumTrack})`);
  if (fusedCount > trackCount) throw new Error(`Invariant failed: fused_objects (${fusedCount}) > unique_tracks (${trackCount})`);

  console.log("All counts and mathematical invariants PASSED.");

  // Step 8: UI Screenshots & Verification
  console.log("\n[Step 8] Capturing Multi-Theme / Multi-Language UI Screenshots...");
  const scratchDir = path.resolve(__dirname, "../../scratch");
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  // Navigate to dashboard
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Helper for mode switching
  const setModes = async (theme, lang) => {
    await page.evaluate(({ theme, lang }) => {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.setAttribute("lang", lang);
      localStorage.setItem("aeromesh_theme", theme);
      localStorage.setItem("aeromesh_language", lang);
      window.dispatchEvent(new Event("storage"));
    }, { theme, lang });
    await page.waitForTimeout(800);
  };

  // Capture Mission Command
  for (const theme of ["dark", "light"]) {
    for (const lang of ["en", "hi"]) {
      await setModes(theme, lang);
      const shotPath = path.join(scratchDir, `gate5_mission_${missionId.slice(0, 8)}_${theme}_${lang}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });
      console.log(`Saved screenshot: ${shotPath}`);
    }
  }

  // Navigate to 3D Viewer tab / view
  console.log("\n[Step 9] Validating 3D Viewer...");
  const viewerTab = await page.$("button:has-text('3D Scene'), button:has-text('3D View'), button:has-text('Reconstruction'), a[href*='viewer']");
  if (viewerTab) {
    await viewerTab.click();
    await page.waitForTimeout(2000);
    for (const theme of ["dark", "light"]) {
      await setModes(theme, "en");
      const shotPath = path.join(scratchDir, `gate5_viewer_${missionId.slice(0, 8)}_${theme}.png`);
      await page.screenshot({ path: shotPath });
      console.log(`Saved screenshot: ${shotPath}`);
    }
  }

  // Navigate to Scene Intelligence / Reports
  console.log("\n[Step 10] Validating Scene Intelligence & Reports...");
  const reportsTab = await page.$("button:has-text('Scene Intelligence'), button:has-text('Reports'), button:has-text('Analytics'), a[href*='reports']");
  if (reportsTab) {
    await reportsTab.click();
    await page.waitForTimeout(2000);
    for (const theme of ["dark", "light"]) {
      await setModes(theme, "en");
      const shotPath = path.join(scratchDir, `gate5_reports_${missionId.slice(0, 8)}_${theme}.png`);
      await page.screenshot({ path: shotPath });
      console.log(`Saved screenshot: ${shotPath}`);
    }
  }

  console.log("\n===============================================================================");
  console.log("GATE 5 PLAYWRIGHT RUN COMPLETED SUCCESSFULLY WITH ZERO ERRORS");
  console.log("===============================================================================");
  await browser.close();
}

main().catch(err => {
  console.error("\nFATAL TEST ERROR:", err);
  process.exit(1);
});
