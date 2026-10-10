import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const frontendUrl = process.env.E2E_FRONTEND_URL || "https://sih-aeromesh-blond.vercel.app";
const backendUrl = "https://sih-aeromesh.onrender.com/api/v1";
const evidenceRoot = path.resolve("test-results/live-evidence");
const individualEmail = process.env.E2E_INDIVIDUAL_EMAIL;
const individualPassword = process.env.E2E_INDIVIDUAL_PASSWORD;
const govEmail = process.env.E2E_GOV_EMAIL;
const govPassword = process.env.E2E_GOV_PASSWORD;

const telemetry = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [], chunkHttpErrors: [], completedUploads: [] };
const missionIds = new Set();
const healthPollers = new Set();
let accountCreated = false;

function chunkFailureCount() {
  return telemetry.failedRequests.filter((item) => item.includes("/upload/chunk")).length + telemetry.chunkHttpErrors.length;
}

test.afterEach(() => {
  for (const poller of healthPollers) clearInterval(poller);
  healthPollers.clear();
});

function scrub(value) {
  let result = String(value ?? "");
  for (const secret of [individualEmail, individualPassword, govEmail, govPassword, process.env.E2E_GOV_INVITE_CODE]) {
    if (secret) result = result.split(secret).join("[redacted]");
  }
  return result.replace(/([?&](?:token|access_token|authorization|key)=)[^&\s]*/gi, "$1[redacted]");
}

function attachTelemetry(page) {
  page.on("console", (message) => {
    if (message.type() === "error") telemetry.consoleErrors.push(scrub(message.text()));
  });
  page.on("pageerror", (error) => telemetry.pageErrors.push(scrub(error.message)));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    telemetry.failedRequests.push(`${request.method()} ${url.origin}${url.pathname}: ${scrub(request.failure()?.errorText)}`);
    if (telemetry.offlineWindow && url.pathname.endsWith("/upload/chunk")) {
      telemetry.offlineChunkFailures = (telemetry.offlineChunkFailures || 0) + 1;
    }
    const chunkMatch = url.pathname.match(/\/missions\/([^/]+)\/upload\/chunk$/);
    if (chunkMatch) {
      telemetry.chunkRequestFailures ??= [];
      telemetry.chunkRequestFailures.push({
        missionId: chunkMatch[1],
        uploadId: url.searchParams.get("upload_id"),
        chunkIndex: Number(url.searchParams.get("chunk_index")),
      });
    }
  });
  page.on("response", (response) => {
    const responseUrl = new URL(response.url());
    const chunkMatch = responseUrl.pathname.match(/\/missions\/([^/]+)\/upload\/chunk$/);
    if (chunkMatch && response.status() >= 400) {
      const failedChunk = {
        missionId: chunkMatch[1],
        status: response.status(),
        uploadId: responseUrl.searchParams.get("upload_id"),
        chunkIndex: Number(responseUrl.searchParams.get("chunk_index")),
        filename: responseUrl.searchParams.get("filename"),
      };
      telemetry.chunkHttpErrors.push(failedChunk);
      response.json().then((body) => {
        failedChunk.requestId = body?.request_id || null;
        failedChunk.error = body?.error || body?.detail || null;
      }).catch(() => {});
    }
    if (chunkMatch && response.status() === 200 && response.request().method() === "POST") {
      response.json().then((body) => {
        if (body?.status === "upload_complete") {
          telemetry.completedUploads.push({
            missionId: chunkMatch[1],
            filename: body.video?.filename,
            sizeBytes: body.video?.size_bytes,
          });
        }
      }).catch(() => {});
    }
    if (response.status() >= 400) {
      telemetry.httpErrors.push(`${response.status()} ${responseUrl.origin}${responseUrl.pathname}`);
    }
    if (response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/missions")) {
      response.json().then((body) => {
        const id = body?.mission?.id || body?.id;
        if (id) missionIds.add(id);
      }).catch(() => {});
    }
    if (new URL(response.url()).pathname.endsWith("/auth/login")) {
      response.json().then((body) => {
        telemetry.authResponses ??= [];
        telemetry.authResponses.push({
          status: response.status(),
          success: Boolean(body?.success || body?.access_token),
          portalType: scrub(body?.user?.portal_type || ""),
          detail: scrub(body?.detail || body?.error || body?.message || ""),
        });
      }).catch(() => {});
    }
  });
}

async function snap(page, name) {
  const masks = [page.locator('input[type="email"]'), page.locator('input[type="password"]')];
  for (const email of [individualEmail, govEmail].filter(Boolean)) {
    masks.push(page.getByText(email, { exact: true }));
  }
  await page.screenshot({
    path: path.join(evidenceRoot, `${name}.png`),
    fullPage: false,
    animations: "disabled",
    mask: masks,
  });
}

async function openCommandPalette(page) {
  const trigger = page.locator(".shell-command-trigger");
  if (!(await trigger.count())) return false;
  await trigger.click({ timeout: 5_000 });
  await expect(page.getByRole("dialog")).toBeVisible();
  return true;
}

async function openHistory(page) {
  if (await openCommandPalette(page) && await page.locator("#command-history").count()) {
    await page.locator("#command-history").click();
    return;
  }
  await page.keyboard.press("Escape");
  const missionsButton = page.locator(".sidebar .nav-item").filter({ hasText: /^Missions$/i }).first();
  if (await missionsButton.count()) await missionsButton.click();
  else await page.getByRole("button", { name: /active mission|all missions|mission switcher/i }).first().click();
}

async function goToIndividualAuth(page) {
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#btn-hero-indiv-portal").click();
  await expect(page.getByText("Individual Creator Portal")).toBeVisible();
}

async function loginIndividual(page) {
  await goToIndividualAuth(page);
  await page.locator('input[type="email"]').fill(individualEmail);
  await page.locator('input[type="password"]').first().fill(individualPassword);
  await submitLogin(page);
  await expect(page.locator(".app-shell")).toBeVisible();
}

async function submitLogin(page) {
  await page.locator("form").first().locator('button[type="submit"]').click();
}

async function logout(page) {
  const topbarOperator = page.locator("#topbar-operator-btn");
  if (await topbarOperator.count()) {
    await topbarOperator.click();
  } else {
    const profileLink = page.locator(".nav-profile-link");
    if (await profileLink.count()) await profileLink.click();
    else await page.goto(`${frontendUrl}?page=profile`, { waitUntil: "domcontentloaded" });
  }
  await page.locator("#profile-logout-button").click();
  await expect(page.locator("#btn-hero-indiv-portal")).toBeVisible();
}

async function createVideo(filePath, sizeMb) {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const tempVideo = `${filePath}.base.mp4`;
  execFileSync(ffmpeg, [
    "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=44100", "-t", "4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
    "-c:a", "aac", "-movflags", "+faststart", tempVideo,
  ], { stdio: "ignore" });
  const base = await fs.readFile(tempVideo);
  await fs.writeFile(filePath, base);
  if (sizeMb > base.length / (1024 * 1024)) {
    const targetBytes = sizeMb * 1024 * 1024;
    const handle = await fs.open(filePath, "a");
    await handle.write(Buffer.alloc(Math.max(0, targetBytes - base.length)));
    await handle.close();
  }
  await fs.rm(tempVideo, { force: true });
}

async function openIncident(page, title) {
  await page.locator("#btn-sidebar-new-mission").click();
  await expect(page.locator("#inc-name")).toBeVisible();
  await page.locator("#inc-name").fill(title);
  await page.locator("#inc-location").fill("E2E test range");
  await page.locator("#inc-desc").fill("Automated end-to-end test incident.");
}

async function openNewMission(page) {
  const sidebarCreate = page.locator("#btn-sidebar-new-mission");
  if (await sidebarCreate.isVisible().catch(() => false)) {
    await sidebarCreate.click();
    return;
  }

  const paletteTrigger = page.locator(".shell-command-trigger");
  if (await paletteTrigger.isVisible().catch(() => false)) {
    await paletteTrigger.click();
    const paletteCreate = page.locator("#command-create");
    if (await paletteCreate.count()) {
      await paletteCreate.click();
      return;
    }
    await page.keyboard.press("Escape");
  }

  // The responsive shell hides its desktop sidebar; use the mission list's
  // create action, which remains available at narrow widths.
  await page.goto(`${frontendUrl}?page=missions`, { waitUntil: "domcontentloaded" });
  const createAction = page.getByRole("button", { name: /new flight mission|create mission|new mission/i }).first();
  await expect(createAction).toBeVisible({ timeout: 15_000 });
  await createAction.click();
}

function startHealthPolling(page) {
  telemetry.healthPollStatuses ??= [];
  const poller = setInterval(async () => {
    try {
      const response = await page.request.get(`${backendUrl}/health`, { timeout: 10_000 });
      telemetry.healthPollStatuses.push(response.status());
    } catch {
      telemetry.healthPollStatuses.push("request_failed");
    }
  }, 1500);
  healthPollers.add(poller);
  return poller;
}

async function waitForUploadOutcome(page, filePath, timeout = 120_000, failedChunkBaseline = 0, completedUploadBaseline = telemetry.completedUploads.length) {
  const progress = page.locator(".status-progress-text");
  const workspace = page.locator("#incident-creation-workspace");
  await expect.poll(async () => {
    const statusText = await progress.innerText().catch(() => "");
    const workspaceText = await workspace.innerText().catch(() => "");
    const chunkFailures = chunkFailureCount();
    return telemetry.completedUploads.length > completedUploadBaseline ||
      /upload failed|chunk \d+ failed|failed to fetch|network error/i.test(workspaceText) ||
      chunkFailures >= failedChunkBaseline + 6;
  }, { timeout, intervals: [500, 1000, 2000] }).toBeTruthy();
  const statusText = await progress.innerText().catch(() => "");
  const workspaceText = await workspace.innerText().catch(() => "");
  const observedChunkFailures = chunkFailureCount() - failedChunkBaseline;
  const expectedSize = (await fs.stat(filePath)).size;
  const completedUpload = telemetry.completedUploads.slice(completedUploadBaseline).find((upload) =>
    upload.filename === path.basename(filePath) && Number(upload.sizeBytes) === expectedSize,
  );
  return {
    complete: Boolean(completedUpload),
    completedUpload: completedUpload || null,
    uiStatus: statusText,
    error: workspaceText.match(/(?:upload failed|chunk \d+ failed|failed to fetch|network error)[^\n]*/i)?.[0] ||
      (observedChunkFailures ? `${observedChunkFailures} chunk request failures` : ""),
    chunkFailureCount: observedChunkFailures,
  };
}

async function expectLatestMissionHasVideo(page, filePath, missionIdOverride) {
  const expectedName = path.basename(filePath);
  const expectedSize = (await fs.stat(filePath)).size;
  const token = await page.evaluate(() => localStorage.getItem("aeromesh_auth_token"));
  let uploadedMission = null;
  await expect.poll(async () => {
    const missionId = missionIdOverride || [...missionIds].at(-1);
    if (!missionId) return false;
    const response = await page.request.get(`${backendUrl}/missions/${encodeURIComponent(missionId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 15_000,
    }).catch(() => null);
    if (!response?.ok()) return false;
    const payload = await response.json().catch(() => ({}));
    const mission = payload.mission || payload;
    const video = mission.video || {};
    if (video.filename !== expectedName || Number(video.size_bytes) !== expectedSize || !video.storage_key) return false;
    uploadedMission = { id: missionId, name: mission.name, video };
    return true;
  }, { timeout: 60_000 }).toBeTruthy();
  expect(uploadedMission, `Mission record does not show stored upload ${expectedName}`).not.toBeNull();
  return uploadedMission;
}

async function captureChunkServerError(page, filePath) {
  const failedChunk = telemetry.chunkHttpErrors?.at(-1) || telemetry.chunkRequestFailures?.at(-1);
  if (!failedChunk) return;
  const token = await page.evaluate(() => localStorage.getItem("aeromesh_auth_token"));
  const file = await fs.readFile(filePath);
  const finalChunk = file.subarray(2 * 1024 * 1024 * Math.floor((file.length - 1) / (2 * 1024 * 1024)));
  const response = await page.request.post(
    `${backendUrl}/missions/${encodeURIComponent(failedChunk.missionId)}/upload/chunk?chunk_index=${failedChunk.chunkIndex}&total_chunks=${Math.ceil(file.length / (2 * 1024 * 1024))}&upload_id=${encodeURIComponent(failedChunk.uploadId)}&filename=${encodeURIComponent(path.basename(filePath))}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      multipart: { chunk: { name: path.basename(filePath), mimeType: "video/mp4", buffer: finalChunk } },
      timeout: 30_000,
    },
  );
  const body = await response.json().catch(() => ({}));
  telemetry.directChunkFinalize = {
    status: response.status(),
    requestId: body.request_id || null,
    error: body.error || null,
  };
}

test.beforeAll(async () => {
  if (!individualEmail || !individualPassword) throw new Error("Set E2E_INDIVIDUAL_EMAIL and E2E_INDIVIDUAL_PASSWORD in frontend/.env.e2e.");
  await fs.mkdir(evidenceRoot, { recursive: true });
});

test.afterAll(async () => {
  await fs.writeFile(path.join(evidenceRoot, "telemetry.json"), JSON.stringify({
    ...telemetry,
    createdMissionIds: [...missionIds],
    accountCreated,
    governmentAccountAvailable: Boolean(govEmail && govPassword),
  }, null, 2));
});

test("A: guest sandbox landing, dashboard, and mission list", async ({ page }) => {
  attachTelemetry(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#btn-hero-guest")).toBeVisible();
  await snap(page, "A1-landing");
  await page.locator("#btn-hero-guest").click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await snap(page, "A2-dashboard");
  await openHistory(page);
  await expect(page.locator(".app-shell")).toBeVisible();
  await snap(page, "A3-mission-list");
  await page.locator("#topbar-operator-btn").click();
  await page.locator("#profile-logout-button").click();
  await expect(page.locator("#btn-hero-guest")).toBeVisible();
  await snap(page, "A4-guest-logout");
});

test("B: individual registration, login, wrong password, logout, and refresh persistence", async ({ page }) => {
  attachTelemetry(page);
  await goToIndividualAuth(page);
  await snap(page, "B1-individual-sign-in");
  await page.getByRole("button", { name: /create account/i }).click();
  const emailInput = page.locator('input[type="email"]');
  const passwords = page.locator('input[type="password"]');
  await emailInput.fill(individualEmail);
  await page.getByPlaceholder("Dr. Rajesh Kumar").fill("E2E Test Operator");
  await passwords.nth(0).fill(individualPassword);
  await passwords.nth(1).fill(individualPassword);
  await page.getByRole("button", { name: /create personal account/i }).click();
  const dashboardAfterRegistration = await page.locator(".sidebar").waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  if (dashboardAfterRegistration) {
    accountCreated = true;
    await snap(page, "B2-registered-dashboard");
    await logout(page);
    await snap(page, "B3-logged-out");
    await goToIndividualAuth(page);
  } else {
    const pageText = await page.locator("body").innerText();
    if (/verify your email|email verification/i.test(pageText)) {
      await snap(page, "B2-email-verification-required");
      throw new Error("Registration requires email verification; manual verification is needed before login tests can continue.");
    }
    await snap(page, "B2-registration-error-existing-account");
    await goToIndividualAuth(page);
  }
  await page.locator('input[type="email"]').fill(individualEmail);
  await page.locator('input[type="password"]').first().fill(individualPassword);
  await submitLogin(page);
  const dashboardAfterLogin = await page.locator(".sidebar").waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  if (!dashboardAfterLogin) await snap(page, "B4-login-error");
  await expect(page.locator(".sidebar")).toBeVisible();
  await snap(page, "B4-logged-in");
  await logout(page);
  await goToIndividualAuth(page);
  await page.locator('input[type="email"]').fill(individualEmail);
  await page.locator('input[type="password"]').first().fill(`${individualPassword}wrong`);
  await submitLogin(page);
  await expect(page.locator('form button[type="submit"]')).not.toContainText(/verifying/i, { timeout: 30_000 });
  await expect(page.getByText(/invalid|incorrect|authentication failed|credentials|email or password/i).last()).toBeVisible();
  await snap(page, "B5-wrong-password");
  await goToIndividualAuth(page);
  await page.locator('input[type="email"]').fill(individualEmail);
  await page.locator('input[type="password"]').first().fill(individualPassword);
  await submitLogin(page);
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await snap(page, "B6-session-after-refresh");
  const sessionStatus = await page.evaluate(async () => {
    const token = localStorage.getItem("aeromesh_auth_token");
    if (!token) return { tokenPresent: false, profileStatus: 0, portalType: "" };
    const response = await fetch("/api/v1/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    const data = response.ok ? await response.json() : {};
    return { tokenPresent: true, profileStatus: response.status, portalType: data.user?.portal_type || "" };
  });
  expect(sessionStatus).toEqual({ tokenPresent: true, profileStatus: 200, portalType: "INDIVIDUAL" });
  const sessionUiRestored = await page.locator("#btn-nav-dashboard").isVisible().catch(() => false)
    || await page.locator("#topbar-operator-btn").isVisible().catch(() => false);
  telemetry.sessionUiRestoredAfterRefresh = sessionUiRestored;
  if (!sessionUiRestored) {
    await page.goto(`${frontendUrl}?page=profile`, { waitUntil: "domcontentloaded" });
    await page.locator("#profile-logout-button").click();
    await expect(page.locator("#btn-hero-indiv-portal")).toBeVisible();
  } else {
    await logout(page);
  }
  expect(sessionUiRestored).toBeTruthy();
});

test("C: ordinary individual credentials are denied at government portal", async ({ page }) => {
  attachTelemetry(page);
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#btn-hero-gov-portal").click();
  await page.locator('input[type="email"]').fill(individualEmail);
  await page.locator('input[type="password"]').first().fill(individualPassword);
  await submitLogin(page);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator('form button[type="submit"]')).not.toContainText(/verifying/i, { timeout: 30_000 });
  await expect(page.getByText(/invalid|incorrect|authentication failed|credentials|email or password|portal/i).last()).toBeVisible();
  await snap(page, "C1-individual-denied-government");
  if (govEmail && govPassword) {
    await page.locator('input[type="email"]').fill(govEmail);
    await page.locator('input[type="password"]').first().fill(govPassword);
    await submitLogin(page);
    await expect(page.locator(".sidebar")).toBeVisible();
    await snap(page, "C2-provisioned-government");
  }
});

test("D/E/F/H/I: incidents, upload behavior, responsive themes, mission pages, and language", async ({ page, context }) => {
  test.setTimeout(600_000);
  attachTelemetry(page);
  await loginIndividual(page);
  const configResponse = await page.request.get(`${backendUrl}/config`);
  expect(configResponse.ok()).toBeTruthy();
  const config = await configResponse.json();
  await page.locator("#btn-sidebar-new-mission").click();
  await expect(page.locator("#inc-name")).toBeVisible();
  await expect(page.locator("#btn-launch-incident-pipeline")).toBeDisabled();
  await snap(page, "D1-validation");

  const uploadLimit = Number(config.max_upload_size_bytes);
  expect(uploadLimit).toBeGreaterThan(0);
  const wrongType = path.join(evidenceRoot, "wrong-type.txt");
  await fs.writeFile(wrongType, "not a video");
  await page.locator("#inc-video-file-input").setInputFiles(wrongType);
  await expect(page.getByText(/video|format|unsupported/i).last()).toBeVisible();
  await snap(page, "E1-wrong-type");
  const tooLarge = path.join(evidenceRoot, "oversized.mp4");
  await fs.writeFile(tooLarge, Buffer.alloc(uploadLimit + 1));
  await page.locator("#inc-video-file-input").setInputFiles(tooLarge);
  await expect(page.getByText(/size|limit|large|maximum/i).last()).toBeVisible();
  await snap(page, "E2-oversized");
  await page.locator("#inc-video-file-input").setInputFiles([]);
  await page.locator("#inc-name").fill("E2E incident upload small");
  await page.locator("#inc-location").fill("E2E test range");
  await page.locator("#inc-desc").fill("Automated upload test.");
  const smallVideo = path.join(evidenceRoot, "small.mp4");
  await createVideo(smallVideo, 5);
  await page.locator("#inc-video-file-input").setInputFiles(smallVideo);
  const smallChunkFailureBaseline = chunkFailureCount();
  const smallCompletedUploadBaseline = telemetry.completedUploads.length;
  await page.locator("#btn-launch-incident-pipeline").click();
  await expect(page.locator(".status-progress-text")).toBeVisible();
  await snap(page, "D2-small-upload-progress");
  const smallOutcome = await waitForUploadOutcome(page, smallVideo, 120_000, smallChunkFailureBaseline, smallCompletedUploadBaseline);
  telemetry.smallUpload = smallOutcome;
  await snap(page, smallOutcome.complete ? "D3-small-upload-complete" : "D3-small-upload-error");
  let smallUploadedMission = null;
  if (smallOutcome.complete) {
    smallUploadedMission = await expectLatestMissionHasVideo(page, smallVideo, smallOutcome.completedUpload.missionId);
    telemetry.smallUpload.missionShowsVideo = Boolean(smallUploadedMission);
  }
  const lightProfileNotice = page.getByText(/full 3D reconstruction and detection require the full compute profile/i).first();
  telemetry.lightProfileNoticeVisible ??= await lightProfileNotice.count() > 0;
  if (await lightProfileNotice.count()) await snap(page, "F1-light-profile-honest-status");
  if (smallOutcome.complete) {
    await expect(page.locator(".app-shell")).toBeVisible();
    await snap(page, "D3-mission-in-history");
    await snap(page, "F-open-test-mission");
  } else {
    await page.getByRole("button", { name: /close/i }).last().click();
  }

  expect(uploadLimit).toBeGreaterThan(35 * 1024 * 1024);
  await page.locator("#btn-sidebar-new-mission").click();
  await page.locator("#inc-name").fill("E2E incident upload chunk resume");
  await page.locator("#inc-location").fill("E2E test range");
  await page.locator("#inc-desc").fill("Automated resumable upload test with one brief offline interruption.");
  const largeVideo = path.join(evidenceRoot, "chunked-35mb.mp4");
  await createVideo(largeVideo, 35);
  await page.locator("#inc-video-file-input").setInputFiles(largeVideo);
  const largeChunkFailureBaseline = chunkFailureCount();
  const largeCompletedUploadBaseline = telemetry.completedUploads.length;
  let interrupted = false;
  let resumeTimer;
  const interruptAfterChunk = new Promise((resolve) => {
    const onResponse = async (response) => {
      if (interrupted || !new URL(response.url()).pathname.endsWith("/upload/chunk")) return;
      interrupted = true;
      page.off("response", onResponse);
      telemetry.offlineWindow = true;
      await context.setOffline(true);
      resumeTimer = setTimeout(async () => {
        await context.setOffline(false);
        telemetry.offlineWindow = false;
        resolve(true);
      }, 1200);
    };
    page.on("response", onResponse);
  });
  const healthPoller = startHealthPolling(page);
  await page.locator("#btn-launch-incident-pipeline").click();
  await expect(page.locator(".status-progress-text")).toBeVisible();
  await snap(page, "D4-chunked-upload-progress");
  await expect.poll(() => interrupted, { timeout: 30_000 }).toBeTruthy();
  await interruptAfterChunk;
  if (resumeTimer) clearTimeout(resumeTimer);
  await context.setOffline(false);
  await snap(page, "D5-chunked-upload-resumed");
  const largeOutcome = await waitForUploadOutcome(page, largeVideo, 300_000, largeChunkFailureBaseline, largeCompletedUploadBaseline);
  telemetry.largeUpload = largeOutcome;
  telemetry.offlineRetryObserved = interrupted && (telemetry.offlineChunkFailures || 0) > 0 && largeOutcome.complete;
  let largeUploadedMission = null;
  if (largeOutcome.complete) {
    largeUploadedMission = await expectLatestMissionHasVideo(page, largeVideo, largeOutcome.completedUpload.missionId);
    telemetry.largeUpload.missionShowsVideo = Boolean(largeUploadedMission);
  }
  if (!largeOutcome.complete) await captureChunkServerError(page, largeVideo);
  await snap(page, largeOutcome.complete ? "D6-chunked-upload-complete" : "D6-chunked-upload-error");
  clearInterval(healthPoller);
  healthPollers.delete(healthPoller);
  expect(telemetry.healthPollStatuses || []).not.toContain(502);
  expect(telemetry.offlineRetryObserved, "Offline interruption did not trigger a failed chunk request followed by a completed upload").toBeTruthy();
  await page.getByRole("button", { name: /close/i }).last().click();

  for (const pageName of ["overview", "missions", "drone", "reconstruction", "analytics"]) {
    const navButton = page.locator(`.nav-item`).filter({ hasText: new RegExp(pageName === "overview" ? "Mission Command" : pageName === "missions" ? "Mission Switcher" : pageName === "drone" ? "Flight Processing" : pageName === "reconstruction" ? "3D Reconstruction" : "Scene Intelligence", "i") }).first();
    if (await navButton.count()) {
      await navButton.click();
      await expect(page.locator(".app-shell")).toBeVisible();
      await snap(page, `F-${pageName}`);
    }
  }
  for (const [commandId, evidenceName] of [
    ["history", "F-history"],
    ["pipeline", "F-pipeline-motion"],
    ["workflow", "F-11-step-workflow"],
    ["overview", "F-mission-command"],
  ]) {
    const hasPalette = await openCommandPalette(page);
    if (hasPalette && await page.locator(`#command-${commandId}`).count()) {
      await page.locator(`#command-${commandId}`).click();
    } else if (commandId === "history") {
      await page.keyboard.press("Escape");
      await page.locator(".sidebar .nav-item").filter({ hasText: /^Missions$/i }).first().click();
    } else if (commandId === "workflow") {
      await page.keyboard.press("Escape");
      await page.goto(`${frontendUrl}#workflow`, { waitUntil: "domcontentloaded" });
    } else {
      await page.keyboard.press("Escape");
      await page.goto(`${frontendUrl}?page=${commandId}`, { waitUntil: "domcontentloaded" });
    }
    if (commandId === "workflow") await expect(page.locator("#workflow")).toBeVisible();
    else await expect(page.locator(".app-shell")).toBeVisible();
    await snap(page, evidenceName);
  }
  await page.locator("#lang-select").selectOption("hi");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await snap(page, "I-hindi-dashboard");
  await page.locator("#lang-select").selectOption("en");

  await page.setViewportSize({ width: 390, height: 844 });
  await openNewMission(page);
  await expect(page.locator("#inc-name")).toBeVisible();
  await snap(page, "H1-incident-390-dark");
  const lightMode = page.getByRole("button", { name: /light mode/i });
  if (await lightMode.count()) await lightMode.click();
  await snap(page, "H2-incident-390-light");
  const back = page.getByRole("button", { name: /dark mode/i });
  if (await back.count()) await back.click();
  await snap(page, "H6-incident-390-dark");
  await context.setOffline(false);
  for (const missionId of missionIds) {
    const deleted = await page.evaluate(async (id) => {
      const token = localStorage.getItem("aeromesh_auth_token");
      const response = await fetch(`https://sih-aeromesh.onrender.com/api/v1/missions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return response.status;
    }, missionId);
    telemetry.missionCleanupStatuses ??= [];
    telemetry.missionCleanupStatuses.push(deleted);
  }
  missionIds.clear();
  await logout(page);
  expect(smallOutcome.complete && smallUploadedMission, `5 MB upload did not complete with a stored mission video: ${smallOutcome.error}`).toBeTruthy();
  expect(largeOutcome.complete && largeUploadedMission, `35 MB upload did not complete with a stored mission video: ${largeOutcome.error}`).toBeTruthy();
});

test("H: guest landing and dashboard at 390px in both themes", async ({ page }) => {
  test.setTimeout(300_000);
  attachTelemetry(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  await snap(page, "H3-landing-390-dark");
  await page.locator("#btn-hero-guest").click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await snap(page, "H4-dashboard-390-dark");
  const lightMode = page.getByRole("button", { name: /light mode/i });
  if (await lightMode.count()) await lightMode.click();
  await snap(page, "H5-dashboard-390-light");
  await logout(page);

  await loginIndividual(page);
  const filePath = path.join(evidenceRoot, "small.mp4");
  await createVideo(filePath, 5);
  const mobileUploadOutcomes = [];
  for (const theme of ["dark", "light"]) {
    await openNewMission(page);
    const themeButton = page.getByRole("button", { name: theme === "dark" ? /dark mode/i : /light mode/i });
    if (await themeButton.count()) await themeButton.click();
    await page.locator("#inc-name").fill(`E2E responsive ${theme} upload`);
    await page.locator("#inc-location").fill("E2E test range");
    await page.locator("#inc-desc").fill(`390px ${theme} mode upload verification.`);
    await page.locator("#inc-video-file-input").setInputFiles(filePath);
    const failureBaseline = chunkFailureCount();
    const completedUploadBaseline = telemetry.completedUploads.length;
    await page.locator("#btn-launch-incident-pipeline").click();
    await expect(page.locator(".status-progress-text")).toBeVisible();
    await snap(page, `H-${theme}-390-upload-progress`);
    const outcome = await waitForUploadOutcome(page, filePath, 120_000, failureBaseline, completedUploadBaseline);
    if (outcome.complete) {
      outcome.missionShowsVideo = Boolean(await expectLatestMissionHasVideo(page, filePath, outcome.completedUpload.missionId));
    }
    mobileUploadOutcomes.push(outcome);
    await snap(page, outcome.complete ? `H-${theme}-390-upload-complete` : `H-${theme}-390-upload-error`);
    await page.getByRole("button", { name: /close/i }).last().click();
  }
  for (const missionId of missionIds) {
    const deleted = await page.evaluate(async (id) => {
      const token = localStorage.getItem("aeromesh_auth_token");
      const response = await fetch(`https://sih-aeromesh.onrender.com/api/v1/missions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return response.status;
    }, missionId);
    telemetry.missionCleanupStatuses ??= [];
    telemetry.missionCleanupStatuses.push(deleted);
  }
  await logout(page);
  expect(mobileUploadOutcomes.every((outcome) => outcome.complete && outcome.missionShowsVideo), "Mobile upload failed in one or both themes").toBeTruthy();
});
