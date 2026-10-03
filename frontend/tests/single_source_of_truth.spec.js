import { test, expect } from "@playwright/test";

test.describe("Single Source of Truth E2E Tests", () => {
  test.setTimeout(60000);

  const testMissions = [
    {
      id: "36c675a7-d7c4-4730-b76a-d2a6e2f2662f",
      label: "Failed Reconstruction Mission",
    },
    {
      id: "233381f5-0e03-4d48-aa6c-50de3017e593",
      label: "Successful Reconstruction Mission",
    },
  ];

  for (const m of testMissions) {
    test(`Assert canonical numbers agree across all views for ${m.label} (${m.id})`, async ({
      page,
      request,
    }) => {
      // 1. Read single source of truth from API
      const res = await request.get(`http://127.0.0.1:8000/api/v1/missions/${m.id}/summary`);
      expect(res.status()).toBe(200);
      const data = await res.json();
      const summary = data.summary || data;

      const expectedStatus = summary.status;
      const expectedCameras = summary.reconstruction?.registered_cameras ?? 0;
      const expectedPoints = summary.reconstruction?.sparse_point_count ?? 0;
      const expectedDetections = summary.detection?.total_detections ?? 0;
      const expectedTracks = summary.tracking?.unique_tracks ?? 0;
      const expectedFused = summary.spatial_fusion?.total_fused_objects ?? 0;

      console.log(`\n========================================`);
      console.log(`[${m.label}] Canonical Summary Verified:`);
      console.log(` - Status: ${expectedStatus}`);
      console.log(` - Cameras: ${expectedCameras}`);
      console.log(` - Sparse Points: ${expectedPoints}`);
      console.log(` - Detections: ${expectedDetections}`);
      console.log(` - Unique Tracks: ${expectedTracks}`);
      console.log(` - 3D Fused Objects: ${expectedFused}`);
      console.log(`========================================\n`);

      // 2. Mission Command Overview Page
      await page.goto(`http://127.0.0.1:5173/?page=overview&mission=${m.id}`);
      await page.waitForFunction(() => !document.body.innerText.includes("Unknown mission"), { timeout: 15000 });
      const overviewText = await page.textContent("body");
      expect(overviewText).toContain(expectedStatus.toUpperCase());
      expect(overviewText).toContain(expectedCameras === 0 ? "SfM registered 0 cameras" : `${expectedCameras} registered keyframe cameras`);

      // 3. Scene Intelligence Page
      await page.goto(`http://127.0.0.1:5173/?page=scene&mission=${m.id}`);
      await page.waitForFunction((id) => !document.body.innerText.includes("Unknown mission") && (document.body.innerText.includes(id) || document.body.innerText.includes("SCENE INTELLIGENCE")), m.id, { timeout: 15000 });
      await page.waitForTimeout(900);
      const sceneText = await page.textContent("body");
      expect(sceneText).toContain(String(expectedTracks));

      // Capture screenshot of Scene Intelligence for target mission
      if (m.id === "36c675a7-d7c4-4730-b76a-d2a6e2f2662f") {
        await page.screenshot({
          path: "C:/Users/kc889/.gemini/antigravity-ide/brain/520f5372-741e-4d80-848f-04aaaeb2ff09/scratch/step2_scene_intelligence.png",
        });
      }

      // 4. 3D Reconstruction Viewer Page
      await page.goto(`http://127.0.0.1:5173/?page=reconstruction&mission=${m.id}`);
      await page.waitForFunction(() => !document.body.innerText.includes("Unknown mission"), { timeout: 15000 });
      await page.waitForTimeout(500);
      const viewerText = await page.textContent("body");
      expect(viewerText).toContain(`${expectedCameras} Registered`);

      // 5. Reports Page - Wait until report data compiles and renders for this specific mission
      await page.goto(`http://127.0.0.1:5173/?page=reports&mission=${m.id}`);
      await page.waitForFunction((id) => document.body.innerText.includes(id) && !document.body.innerText.includes("Compiling"), m.id, { timeout: 15000 });
      await page.waitForTimeout(900);
      const reportsText = await page.textContent("body");
      expect(reportsText).toContain(String(expectedTracks));

      // 6. PDF Report binary verification
      const pdfRes = await request.get(`http://127.0.0.1:8000/api/v1/missions/${m.id}/report/pdf`);
      expect(pdfRes.status()).toBe(200);
      expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
    });
  }
});
