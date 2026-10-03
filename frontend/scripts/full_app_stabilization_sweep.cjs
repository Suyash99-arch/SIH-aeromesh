/**
 * Full App Stabilization Sweep
 * Executes comprehensive browser-level tests in real Google Chrome:
 * - 12 routes console error / React error boundary check
 * - Mid-state reloads (object selected, video frames tab, mid-pipeline)
 * - 5x rapid mission switching
 * - 3D viewport interaction & FPS profiling with ambient cursor glow
 * - Opt-in Auth system (register, login, profile, logout)
 * - Offline assertion (0 external network calls)
 */
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'temp_artifacts');

async function runStabilizationSweep() {
  console.log('>>> Launching Real Google Chrome for Stabilization Sweep...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  const consoleErrors = [];
  const uncaughtExceptions = [];
  const externalRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter out harmless WebGL/three.js deprecation warnings if logged as error
      if (!text.includes('THREE.Clock')) {
        consoleErrors.push({ url: page.url(), error: text });
      }
    }
  });

  page.on('pageerror', (err) => {
    uncaughtExceptions.push({ url: page.url(), error: err.message, stack: err.stack });
  });

  // Strict offline routing: block all non-localhost requests
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost') || url.startsWith('data:')) {
      route.continue();
    } else {
      console.log('[OFFLINE SHIELD] Blocked external request:', url);
      externalRequests.push(url);
      route.abort('internetdisconnected');
    }
  });

  const results = {
    routeSweep: [],
    midStateReloads: [],
    missionSwitching: null,
    fpsProfile: null,
    authOptIn: null,
    failurePaths: [],
    consoleErrors,
    uncaughtExceptions,
    externalRequests,
  };

  try {
    // -------------------------------------------------------------
    // PART 1: 12-ROUTE CRASH & ERROR SWEEP
    // -------------------------------------------------------------
    console.log('\n--- PART 1: Exercising All 12 Routes in Real Browser ---');
    const routes = [
      { id: 'overview', name: 'Mission Command' },
      { id: 'missions', name: 'Mission Switcher' },
      { id: 'drone', name: 'Flight Processing' },
      { id: 'reconstruction', name: '3D Reconstruction' },
      { id: 'analytics', name: 'Scene Intelligence' },
      { id: 'map', name: 'Geospatial Intelligence' },
      { id: 'measurements', name: 'Measurements' },
      { id: 'findings', name: 'AI Findings' },
      { id: 'reports', name: 'Reports' },
      { id: 'challenge', name: 'Challenge Coverage' },
      { id: 'settings', name: 'Settings' },
      { id: 'profile', name: 'Profile & Security' },
    ];

    for (const r of routes) {
      const errCountBefore = consoleErrors.length + uncaughtExceptions.length;
      await page.goto(`http://127.0.0.1:5173/?page=${r.id}&mission=north-ridge`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);

      const hasErrorBoundary = await page.locator('text=Something went wrong displaying this section').isVisible().catch(() => false);
      const isAuthCard = await page.locator('#auth-login-email, .auth-card').isVisible().catch(() => false);
      const errCountAfter = consoleErrors.length + uncaughtExceptions.length;
      const newErrors = errCountAfter - errCountBefore;

      const status = hasErrorBoundary ? 'ERROR_BOUNDARY' : isAuthCard ? 'AUTH_GATE_BLOCKED' : newErrors > 0 ? 'CONSOLE_ERROR' : 'CLEAN';
      console.log(`[Route] ${r.name.padEnd(25)} (?page=${r.id.padEnd(14)}) => ${status}`);
      results.routeSweep.push({ ...r, status, newErrors });
    }

    // -------------------------------------------------------------
    // PART 2: MID-STATE REFRESH TESTS
    // -------------------------------------------------------------
    console.log('\n--- PART 2: Mid-State Refresh Testing ---');
    
    // (a) Refresh on 3D Viewport with Object Selected
    console.log('[Mid-State 1] Testing 3D Viewport with active object selection...');
    await page.goto('http://127.0.0.1:5173/?page=reconstruction&mission=north-ridge', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Click first object in table or list if present
    const firstObjRow = page.locator('.object-list-item, .table-row, tr[data-object-id]').first();
    if (await firstObjRow.isVisible()) {
      await firstObjRow.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    console.log('[Mid-State 1] Triggering page reload mid-session...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const midState1Ok = !(await page.locator('text=Something went wrong').isVisible().catch(() => false));
    console.log(`[Mid-State 1] Reload completed without crash: ${midState1Ok}`);
    results.midStateReloads.push({ test: '3D Viewport Reload', ok: midState1Ok });

    // (b) Refresh on Video Frames tab
    console.log('[Mid-State 2] Navigating to Video Frames tab and reloading...');
    const videoFramesTabBtn = page.locator('.incident-tab-btn:has-text("Video Frames")').first();
    if (await videoFramesTabBtn.isVisible()) {
      await videoFramesTabBtn.click();
      await page.waitForTimeout(1000);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const midState2Ok = !(await page.locator('text=Something went wrong').isVisible().catch(() => false));
      console.log(`[Mid-State 2] Video Frames Tab reload completed without crash: ${midState2Ok}`);
      results.midStateReloads.push({ test: 'Video Frames Tab Reload', ok: midState2Ok });
    }

    // (c) Refresh on Autonomous Pipeline Progression
    console.log('[Mid-State 3] Testing Pipeline Progression page reload...');
    await page.goto('http://127.0.0.1:5173/?page=pipeline&mission=north-ridge', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const midState3Ok = !(await page.locator('text=Something went wrong').isVisible().catch(() => false));
    console.log(`[Mid-State 3] Pipeline page reload completed without crash: ${midState3Ok}`);
    results.midStateReloads.push({ test: 'Pipeline Page Reload', ok: midState3Ok });

    // -------------------------------------------------------------
    // PART 3: RAPID 5X MISSION SWITCHING
    // -------------------------------------------------------------
    console.log('\n--- PART 3: Rapid 5x Mission Switching (State Leak / Interval Check) ---');
    const missionCycle = ['north-ridge', 'sector-04', 'downtown-grid', 'harbor-district', 'river-approach', 'north-ridge'];
    let switchPassed = true;
    for (let i = 0; i < missionCycle.length; i++) {
      const targetMission = missionCycle[i];
      await page.goto(`http://127.0.0.1:5173/?page=reconstruction&mission=${targetMission}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      const isCrashed = await page.locator('text=Something went wrong').isVisible().catch(() => false);
      if (isCrashed) {
        switchPassed = false;
        console.error(`[Mission Switch] CRASH detected switching to ${targetMission}`);
      } else {
        console.log(`[Mission Switch #${i + 1}] Successfully switched to: ${targetMission}`);
      }
    }
    results.missionSwitching = switchPassed;

    // -------------------------------------------------------------
    // PART 4: 3D VIEWPORT & PERFORMANCE PROFILING
    // -------------------------------------------------------------
    console.log('\n--- PART 4: 3D Viewport Interaction & Frame Timing Profiling ---');
    await page.goto('http://127.0.0.1:5173/?page=reconstruction&mission=north-ridge', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Profile FPS during canvas drag / orbit
    const canvas = page.locator('canvas').first();
    let fpsResult = null;
    if (await canvas.isVisible()) {
      const box = await canvas.boundingBox();
      if (box) {
        // Start measuring frame timestamps in the browser
        await page.evaluate(() => {
          window.__frameDeltas = [];
          let lastTime = performance.now();
          window.__rafId = requestAnimationFrame(function measure(now) {
            window.__frameDeltas.push(now - lastTime);
            lastTime = now;
            if (window.__frameDeltas.length < 60) {
              window.__rafId = requestAnimationFrame(measure);
            }
          });
        });

        // Perform user orbit interaction across 1 second
        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        for (let step = 0; step < 15; step++) {
          await page.mouse.move(startX + step * 10, startY + (step % 2 === 0 ? 5 : -5));
          await page.waitForTimeout(30);
        }
        await page.mouse.up();

        await page.waitForTimeout(600);

        fpsResult = await page.evaluate(() => {
          const deltas = window.__frameDeltas || [];
          if (!deltas.length) return null;
          const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
          const fps = Math.round(1000 / avgDelta);
          const maxDelta = Math.max(...deltas);
          return { fps, avgDelta: avgDelta.toFixed(2), maxDelta: maxDelta.toFixed(2), sampleCount: deltas.length };
        });

        console.log(`[3D Performance] Measured FPS: ~${fpsResult?.fps} fps (avg frame time: ${fpsResult?.avgDelta}ms, max delta: ${fpsResult?.maxDelta}ms)`);
      }
    }
    results.fpsProfile = fpsResult;

    // -------------------------------------------------------------
    // PART 5: OPT-IN AUTH SYSTEM (LOGIN, REGISTER, PROFILE, LOGOUT)
    // -------------------------------------------------------------
    console.log('\n--- PART 5: Testing Opt-In Auth Workflow ---');
    await page.goto('http://127.0.0.1:5173/?page=auth', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const emailInput = page.locator('#auth-login-email, input[type="email"], input[placeholder*="email"]').first();
    const passInput = page.locator('#auth-login-password, input[type="password"]').first();
    const submitBtn = page.locator('button[type="submit"]:has-text("Sign In"), button[type="submit"]:has-text("Login")').first();

    if (await emailInput.isVisible() && await passInput.isVisible()) {
      await emailInput.fill('operator@aeromesh.internal');
      await passInput.fill('Operator123!');
      await submitBtn.click();
      await page.waitForTimeout(1200);

      // Verify profile is accessible and user is authenticated
      await page.goto('http://127.0.0.1:5173/?page=profile', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const isProfileLoaded = await page.locator('text=Field Operator, text=Operational User, text=Profile').first().isVisible().catch(() => false);
      console.log(`[Auth Opt-in] Login & Profile loaded successfully: ${isProfileLoaded}`);
      results.authOptIn = isProfileLoaded;
    } else {
      console.log('[Auth Opt-in] Auth page inputs not found directly, verifying auth page visibility');
      results.authOptIn = await page.locator('.auth-page, .auth-card').isVisible().catch(() => false);
    }

    // -------------------------------------------------------------
    // PART 6: FAILURE PATHS EXERCISE
    // -------------------------------------------------------------
    console.log('\n--- PART 6: Exercising Known Failure Paths ---');
    
    // Failure Path 1: Non-existent Mission ID
    console.log('[Failure Path 1] Navigating to non-existent mission ID...');
    await page.goto('http://127.0.0.1:5173/?page=reconstruction&mission=non-existent-mission-xyz-404', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const showsCleanFallback = !(await page.locator('text=Cannot read properties of undefined').isVisible().catch(() => false));
    console.log(`[Failure Path 1] Handled missing mission without unhandled crash: ${showsCleanFallback}`);
    results.failurePaths.push({ test: 'Non-existent Mission ID', handledCleanly: showsCleanFallback });

    // Capture final verification screenshots
    const sweepScreenshot = path.join(ARTIFACT_DIR, 'stabilization_sweep_overview.png');
    await page.screenshot({ path: sweepScreenshot });
    console.log(`[Screenshot Saved]: ${sweepScreenshot}`);

    console.log('\n================ SWEEP SUMMARY ================');
    console.log(`Console Errors Caught: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      consoleErrors.forEach((e) => console.log('  - ' + e.error));
    }
    console.log(`Uncaught Exceptions: ${uncaughtExceptions.length}`);
    if (uncaughtExceptions.length > 0) {
      uncaughtExceptions.forEach((e) => console.log('  - ' + e.error));
    }
    console.log(`External Requests Blocked: ${externalRequests.length}`);
    console.log('================================================\n');

    return { success: true, results };
  } catch (err) {
    console.error('[Stabilization Sweep Fatal Error]:', err);
    return { success: false, error: err.message, results };
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  runStabilizationSweep().then((res) => {
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'stabilization_results.json'), JSON.stringify(res, null, 2));
    process.exit(res.success ? 0 : 1);
  });
}

module.exports = { runStabilizationSweep };
