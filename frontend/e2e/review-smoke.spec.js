import { test, expect } from "@playwright/test";
import path from "node:path";

const missionId = "review-fixture-mission";
const scenarios = ["not-run-light", "completed", "failed"];
const viewports = [
  { width: 1440, height: 1000, theme: "dark", language: "en" },
  { width: 1440, height: 1000, theme: "light", language: "en" },
  { width: 390, height: 844, theme: "dark", language: "en" },
  { width: 390, height: 844, theme: "light", language: "en" },
];
const routes = [
  { name: "Landing", target: "/" },
  { name: "Auth", target: "/?page=auth" },
  { name: "Dashboard", target: `/?page=overview&mission=${missionId}` },
  { name: "Mission Command", target: `/?page=overview&mission=${missionId}` },
  { name: "Missions", target: `/?page=missions&mission=${missionId}` },
  { name: "Flight Processing", target: `/?page=drone&mission=${missionId}` },
  { name: "3D Reconstruction", target: `/?page=reconstruction&mission=${missionId}` },
  { name: "Scene Intelligence", target: `/?page=analytics&mission=${missionId}` },
  { name: "Geospatial", target: `/?page=map&mission=${missionId}` },
  { name: "Reports", target: `/?page=reports&mission=${missionId}` },
  { name: "Profile", target: `/?page=profile&mission=${missionId}` },
  { name: "History", target: `/?page=history&mission=${missionId}` },
  { name: "Pipeline Motion", target: `/?page=pipeline-motion&mission=${missionId}` },
  { name: "11-Step Workflow", target: "/", workflow: true },
];

function fixtureMission(scenario) {
  const common = {
    id: missionId,
    name: "Review fixture mission",
    status: "NOT_RUN",
    video_name: "fixture.mp4",
    video: { uploaded: true, size_bytes: 1024, total_frames: 38, duration_seconds: 20, resolution: { width: 1920, height: 1080 } },
    progress: 0,
    findings: [],
    detections: [],
    detection: { total_detections: 0 },
    reconstruction: { registered_cameras: 0, point_count: 0, mean_reprojection_error: null },
    stage_breakdown: { ingest: "COMPLETED" },
  };
  if (scenario === "completed") {
    return {
      ...common,
      status: "COMPLETE",
      progress: 100,
      detections: [{ id: "fixture-detection-1", class: "vehicle", confidence: 0.93, frame: 7 }],
      detection: { total_detections: 1 },
      objects_3d: [{ object_id: "fixture-vehicle", class_name: "vehicle", position_3d: [1, 2, 3], evidence_count: 4 }],
      reconstruction: { registered_cameras: 38, point_count: 18814, sparse_point_count: 18814, mesh_vertices: 5230, mean_reprojection_error: 0.37 },
      mesh: { url: `/api/v1/missions/${missionId}/mesh.obj`, vertices: 5230, faces: 9100 },
      assets: { mesh: `/api/v1/missions/${missionId}/mesh.obj` },
      report: { url: `/api/v1/missions/${missionId}/report.pdf` },
      stage_breakdown: Object.fromEntries(["ingest", "quality", "detection", "tracking", "reconstruction", "measurements", "intelligence", "report"].map((key) => [key, "COMPLETED"])),
    };
  }
  if (scenario === "failed") {
    return {
      ...common,
      status: "FAILED",
      failed_stage: "reconstruction",
      error: "COLMAP failed: fixture reconstruction error",
      reconstruction: { registered_cameras: 2, error: "COLMAP failed: fixture reconstruction error" },
      stage_breakdown: { ingest: "COMPLETED", quality: "COMPLETED", detection: "COMPLETED", reconstruction: "FAILED" },
    };
  }
  if (scenario === "unavailable" || scenario === "disabled") {
    return { ...common, status: scenario.toUpperCase() };
  }
  return common;
}

test("all app routes render safely across mission states and responsive themes", async ({ page, context, baseURL }) => {
  test.setTimeout(900_000);
  const pageErrors = [];
  const consoleErrors = [];
  const webglContextLossWarnings = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (/context already lost/iu.test(message.text())) webglContextLossWarnings.push(message.text());
  });

  let activeScenario = "not-run-light";
  const videoRequests = [];
  const missionRequests = [];
  const missionApiPaths = [];
  const refreshRequests = [];
  const countRequestsForMission = (id) => missionRequests.filter((pathname) => pathname.endsWith(`/missions/${id}`)).length;
  await page.addInitScript(() => {
    window.__guestMissionStorageChecks = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/auth/guest")) {
        window.__guestMissionStorageChecks.push([
          "aeromesh_active_mission_id",
          "aeromesh_mission_id",
          "aeromesh_last_mission_id",
        ].every((key) => !localStorage.getItem(key) && !sessionStorage.getItem(key)));
      }
      return originalFetch(input, init);
    };
  });
  await page.route(/\/api\/v1\//u, async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname;
    if (/\/missions\//u.test(pathname)) missionApiPaths.push(pathname);
    const mission = fixtureMission(activeScenario);
    if (pathname.endsWith("/health")) {
      const light = activeScenario === "not-run-light";
      return route.fulfill({ json: { status: "healthy", pipeline_mode: light ? "light" : "heavy", reconstruction_engine: light ? "disabled" : "available", ai_engine: light ? "disabled" : "available" } });
    }
    if (pathname.endsWith("/ai-engine/status")) {
      return route.fulfill({ json: { detector: { status: "READY", ready: true }, reconstruction: { status: "AVAILABLE", ready: true }, compute: { device: "cpu" }, tiling: { status: "ACTIVE" } } });
    }
    if (pathname.endsWith("/processing-status")) {
      return route.fulfill({ json: { status: activeScenario === "failed" ? "FAILED" : activeScenario === "completed" ? "COMPLETE" : activeScenario === "unavailable" || activeScenario === "disabled" ? activeScenario.toUpperCase() : "NOT_RUN", progress_percent: activeScenario === "completed" ? 100 : 0, failed_stage: activeScenario === "failed" ? "reconstruction" : null, error: activeScenario === "failed" ? mission.error : null, stages: [] } });
    }
    if (pathname.endsWith("/auth/refresh")) {
      refreshRequests.push(pathname);
      return route.fulfill({ json: { access_token: "fixture-refreshed-token", user: { id: "fixture-review-user", portal_type: "guest", name: "Review Guest" } } });
    }
    if (pathname.endsWith("/auth/me")) {
      return route.fulfill({ json: { user: { id: "fixture-review-user", portal_type: "guest", name: "Review Guest" }, success: true } });
    }
    if (/\/missions\/?$/u.test(pathname) && route.request().method() === "GET") {
      return route.fulfill({ json: [mission, { ...mission, id: "review-fixture-mission-two", name: "Second review fixture mission" }] });
    }
    if (/\/missions\/[^/]+$/u.test(pathname) && route.request().method() === "GET") {
      missionRequests.push(pathname);
      if (activeScenario === "expired-token") return route.fulfill({ status: 401, json: { detail: "expired" } });
      if (activeScenario === "not-found") return route.fulfill({ status: 404, json: { detail: "not found" } });
    }
    if (pathname.includes(`/missions/${missionId}/video`)) {
      videoRequests.push(pathname);
      return route.fulfill({ status: 200, contentType: "video/mp4", body: "" });
    }
    if (pathname.endsWith("/mesh.obj")) {
      return route.fulfill({ status: 200, contentType: "text/plain", body: "o fixture\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n" });
    }
    if (pathname.endsWith("/semantic-scene")) {
      return route.fulfill({ json: { semantic_scene: { objects: mission.objects_3d || [] } } });
    }
    if (pathname.endsWith("/auth/guest")) {
      return route.fulfill({ json: { access_token: "fixture-review-token", user: { id: "fixture-review-user", portal_type: "guest", name: "Review Guest" } } });
    }
    if (pathname.includes(`/missions/${missionId}`)) {
      return route.fulfill({ json: { success: true, mission } });
    }
    if (/\/auth\//u.test(pathname)) return route.fulfill({ json: { user: null, success: true } });
    return route.fulfill({ json: { success: true, mission, missions: [mission] } });
  });

  const screenshotsDir = path.resolve(process.cwd(), "test-results/review-smoke/screenshots");
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  for (const scenario of scenarios) {
    activeScenario = scenario;
    for (const route of routes) {
      for (const viewport of viewports) {
        pageErrors.length = 0;
        consoleErrors.length = 0;
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.evaluate(({ theme, language }) => {
          localStorage.setItem("aeromesh-theme", theme);
          localStorage.setItem("hexaspark_theme", theme);
          localStorage.setItem("aeromesh_lang", language);
          localStorage.setItem("hexaspark_lang", language);
          localStorage.setItem("aeromesh_auth_token", "fixture-review-token");
          localStorage.setItem("aeromesh_current_user", JSON.stringify({ id: "fixture-review-user", portal_type: "guest", name: "Review Guest" }));
        }, viewport);
        const response = await page.goto(`${baseURL}${route.target}`, { waitUntil: "domcontentloaded" });
        if (response) expect(response.status(), `${route.name} document status`).toBe(200);
        expect(await page.evaluate(() => document.contentType), `${route.name} content type`).toBe("text/html");
        await expect.poll(() => page.evaluate(() => document.characterSet)).toBe("UTF-8");
        if (viewport.language === "hi") await expect(page.locator("html")).toHaveAttribute("lang", "hi");
        if (route.workflow) {
          await page.getByRole("link", { name: /11-step workflow/i }).click();
          await expect(page.locator("#workflow")).toBeAttached();
          await page.locator("#workflow").scrollIntoViewIfNeeded();
        } else {
          await expect(page.locator("#root")).not.toBeEmpty();
          await expect(page.locator("#root")).not.toContainText("This page could not be loaded");
        }
        expect(await page.locator("body").innerText()).not.toMatch(/STAGES\./u);
        expect(await page.locator("body").innerText()).not.toContain("Sign-in required");
        const metricOptionLocator = page.locator("#unit-select option[value='metric']");
        if (await metricOptionLocator.count()) {
          expect(await metricOptionLocator.textContent()).not.toContain(String.fromCharCode(0xc2));
        }
        if (route.name === "Mission Command" && scenario === "not-run-light") {
          await expect(page.getByText("Not run. Full 3D reconstruction requires the full compute profile.", { exact: true })).toHaveCount(2);
          await expect(page.locator(".stage-btn.completed")).toHaveCount(1);
          await expect(page.locator(".stage-btn.failed")).toHaveCount(0);
          await expect(page.locator(".pipeline-panel .progress-head")).toContainText("13%");
        }
        if (route.name === "Mission Command" && scenario === "failed") {
          await expect(page.getByText("COLMAP failed: fixture reconstruction error").first()).toBeVisible();
        }
        if (route.name === "Mission Command" && scenario === "completed") {
          await expect(page.locator(".stage-btn.completed")).toHaveCount(8);
        }

        if (scenario === "not-run-light" && ["Mission Command", "Flight Processing"].includes(route.name)) {
          const name = route.name === "Mission Command" ? "mission-command" : "flight-processing";
          const suffix = `${viewport.width}-${viewport.theme}`;
          await page.screenshot({ path: path.join(screenshotsDir, `review-v2-${name}-${suffix}.png`), fullPage: true, animations: "disabled" });
        }
        expect(pageErrors, `${scenario}/${route.name}/${viewport.width}/${viewport.theme} page errors`).toEqual([]);
        expect(consoleErrors, `${scenario}/${route.name}/${viewport.width}/${viewport.theme} console errors`).toEqual([]);
        await expect(page.getByText("This page could not be loaded", { exact: true })).toHaveCount(0);
        if (await page.locator("canvas").count()) {
          await page.goto(`${baseURL}/?page=auth`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(100);
          expect(webglContextLossWarnings, `${scenario}/${route.name}/${viewport.width}/${viewport.theme} WebGL cleanup warnings`).toEqual([]);
        }
      }
    }
  }

  // Stage statuses outside the usual mission lifecycle must still resolve to labels.
  for (const status of ["unavailable", "disabled"]) {
    activeScenario = status;
    await page.goto(`${baseURL}/?page=overview&mission=${missionId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#root")).not.toContainText("This page could not be loaded");
    await expect(page.getByText(status === "unavailable" ? "UNAVAILABLE" : "DISABLED", { exact: true })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/STAGES\./u);
    expect(await page.locator("body").innerText()).not.toContain("Sign-in required");
  }

  // Selecting every available mission card must request string IDs, never object stringifications.
  activeScenario = "not-run-light";
  missionApiPaths.length = 0;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/?page=overview&mission=${missionId}`, { waitUntil: "domcontentloaded" });
  for (let index = 0; index < 2; index += 1) {
    await expect(page.locator(".workspace")).toBeVisible();
    await page.locator(".workspace").click();
    const cards = page.locator(".mission-card-body");
    await expect(cards).toHaveCount(2);
    await cards.nth(index).click();
    await expect(page.locator(".mission-selector-modal")).toHaveCount(0);
  }
  expect(
    missionApiPaths.every((pathname) => !/\[object(?:%20|\s)+object\]/iu.test(pathname)),
    "mission request paths must not contain object coercions",
  ).toBe(true);
  expect(missionApiPaths).toContain(`/api/v1/missions/${missionId}`);
  expect(missionApiPaths).toContain("/api/v1/missions/review-fixture-mission-two");

  // A fresh, unauthenticated load must discard a stale mission query without requesting it.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const staleGuestRequestCount = countRequestsForMission("stale-guest-mission");
  activeScenario = "not-run-light";
  await page.goto(`${baseURL}/?page=overview&mission=stale-guest-mission`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).searchParams.has("mission")).toBe(false);
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator(".toast")).toContainText("This mission needs you to sign in");
  expect(countRequestsForMission("stale-guest-mission")).toBe(staleGuestRequestCount);
  expect(await page.locator("body").innerText()).not.toMatch(/STAGES\./u);
  expect(await page.locator("body").innerText()).not.toContain("Sign-in required");

  // Expired credentials get one refresh attempt, while the mission URL is cleared.
  await page.evaluate(() => {
    localStorage.setItem("aeromesh_auth_token", "fixture-expired-token");
    localStorage.setItem("aeromesh_current_user", JSON.stringify({ id: "fixture-review-user", portal_type: "guest", name: "Review Guest" }));
  });
  activeScenario = "expired-token";
  const missionRequestCountBeforeExpired = countRequestsForMission(missionId);
  const refreshCountBeforeExpired = refreshRequests.length;
  await page.goto(`${baseURL}/?page=overview&mission=${missionId}`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).searchParams.has("mission")).toBe(false);
  await expect(page.locator(".toast")).toContainText("This mission needs you to sign in");
  expect(countRequestsForMission(missionId) - missionRequestCountBeforeExpired).toBe(1);
  expect(refreshRequests.length - refreshCountBeforeExpired).toBe(1);
  expect(await page.locator("body").innerText()).not.toContain("Sign-in required");

  // A 404 similarly clears the query and shows a useful message without a refresh retry.
  await page.evaluate(() => {
    localStorage.setItem("aeromesh_auth_token", "fixture-valid-token");
    localStorage.setItem("aeromesh_current_user", JSON.stringify({ id: "fixture-review-user", portal_type: "guest", name: "Review Guest" }));
  });
  activeScenario = "not-found";
  const missionRequestCountBefore404 = countRequestsForMission(missionId);
  const refreshCountBefore404 = refreshRequests.length;
  await page.goto(`${baseURL}/?page=overview&mission=${missionId}`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).searchParams.has("mission")).toBe(false);
  await expect(page.locator(".toast")).toContainText("Mission not found");
  expect(countRequestsForMission(missionId) - missionRequestCountBefore404).toBe(1);
  expect(refreshRequests.length - refreshCountBefore404).toBe(0);
  expect(await page.locator("body").innerText()).not.toContain("Sign-in required");

  pageErrors.length = 0;
  consoleErrors.length = 0;

  // Exercise Hindi once on Mission Command and retain a review screenshot.
  activeScenario = "not-run-light";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("aeromesh-theme", "light");
    localStorage.setItem("hexaspark_theme", "light");
    localStorage.setItem("aeromesh_lang", "hi");
    localStorage.setItem("hexaspark_lang", "hi");
  });
  await page.goto(`${baseURL}/?page=overview&mission=${missionId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await page.screenshot({ path: path.join(screenshotsDir, "review-v2-mission-command-390-light-hi.png"), fullPage: true, animations: "disabled" });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  // Landing keyboard palette and guest flow use only the intercepted fixture API.
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#btn-hero-guest").waitFor({ state: "visible" });
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#btn-hero-guest").click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__guestMissionStorageChecks.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__guestMissionStorageChecks.at(-1))).toBe(true);

  // Logging out and entering as a guest again cannot restore a previous mission ID.
  await page.evaluate(() => {
    for (const key of ["aeromesh_active_mission_id", "aeromesh_mission_id", "aeromesh_last_mission_id"]) {
      localStorage.setItem(key, "previous-session-mission");
      sessionStorage.setItem(key, "previous-session-mission");
    }
  });
  await page.goto(`${baseURL}/?page=profile`, { waitUntil: "domcontentloaded" });
  await page.locator("#profile-logout-button").click();
  await expect(page.locator("#btn-hero-guest")).toBeVisible();
  await expect.poll(() => page.evaluate(() => [
    "aeromesh_active_mission_id",
    "aeromesh_mission_id",
    "aeromesh_last_mission_id",
  ].every((key) => !localStorage.getItem(key) && !sessionStorage.getItem(key)))).toBe(true);
  const guestRequestCountBeforeReentry = await page.evaluate(() => window.__guestMissionStorageChecks.length);
  await page.locator("#btn-hero-guest").click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__guestMissionStorageChecks.length)).toBeGreaterThan(guestRequestCountBeforeReentry);
  expect(await page.evaluate(() => window.__guestMissionStorageChecks.at(-1))).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(videoRequests.length).toBeGreaterThan(0);
});
