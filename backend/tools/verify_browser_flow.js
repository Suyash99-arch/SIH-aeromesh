const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('Starting Playwright Browser Verification...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => {
    logs.push(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    logs.push(`[UNCAUGHT PAGE ERROR] ${err.message}\n${err.stack || ''}`);
  });
  page.on('requestfailed', req => {
    logs.push(`[FAILED REQUEST] ${req.method()} ${req.url()} - ${req.failure() ? req.failure().errorText : 'failed'}`);
  });

  try {
    // 1. Visit landing page / home
    console.log('Step 1: Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    console.log('Page Title:', await page.title());

    // 2. Navigate to Reconstruction page
    console.log('Step 2: Navigating to http://localhost:5173/reconstruction...');
    await page.goto('http://localhost:5173/reconstruction', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // 3. Create guest mission or select mission
    console.log('Step 3: Checking Reconstruction page interactive elements...');
    const missionCards = await page.$$('.mission-card, [data-testid="mission-item"], div:has-text("Mission")');
    console.log(`Found ${missionCards.length} potential mission elements.`);

    // Click Guest or Start Reconstruction button if available
    const newMissionBtn = await page.$('button:has-text("New Reconstruction"), button:has-text("Create"), button:has-text("Upload")');
    if (newMissionBtn) {
      console.log('Clicking New Reconstruction button...');
      await newMissionBtn.click();
      await page.waitForTimeout(1000);
    }

    // Check 3D Viewer loading / canvas presence
    const canvasCount = await page.$$eval('canvas', canvases => canvases.length);
    console.log(`Canvas count on page: ${canvasCount}`);

    // Wait for any network requests/effects to settle
    await page.waitForTimeout(3000);

  } catch (err) {
    console.error('Browser interaction exception:', err);
  } finally {
    console.log('\n=================== BROWSER CONSOLE LOGS & ERRORS ===================');
    if (logs.length === 0) {
      console.log('Clean run! Zero console warnings, errors, or failed requests.');
    } else {
      logs.forEach(log => console.log(log));
    }
    console.log('=======================================================================\n');
    await browser.close();
  }
})();
