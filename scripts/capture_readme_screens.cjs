const path = require('path');
const fs = require('fs');
let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  chromium = require(path.resolve(__dirname, '../frontend/node_modules/playwright')).chromium;
}

/**
 * Capture high-resolution README screenshots at 1440x900
 * Saves directly into docs/screenshots/ (no tokens or personal emails)
 */
async function captureReadmeScreens() {
  const screenshotsDir = path.resolve(__dirname, '../docs/screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  console.log('[Screenshots] Launching headless browser for capture...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-web-security', '--allow-running-insecure-content'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  try {
    // 1. Landing Page
    console.log('1. Capturing Landing Page...');
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(screenshotsDir, 'landing.png'), fullPage: false });

    // 2. Auth Modal
    console.log('2. Capturing Authentication Modal...');
    const authBtn = page.locator('#btn-nav-gov-portal, #btn-hero-gov-portal').first();
    if (await authBtn.isVisible()) {
      await authBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(screenshotsDir, 'auth.png'), fullPage: false });
    }

    // 3. Login as Guest & Open Dashboard
    console.log('3. Capturing Mission Command Dashboard...');
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const guestBtn = page.locator('#btn-hero-guest, #btn-nav-guest').first();
    await guestBtn.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(screenshotsDir, 'dashboard.png'), fullPage: false });

    // 4. New Incident Workspace Modal
    console.log('4. Capturing New Incident Workspace Modal...');
    try {
      await page.evaluate(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('page', 'missions');
        window.history.pushState({}, '', url.toString());
        window.dispatchEvent(new Event('popstate'));
      });
      await page.waitForTimeout(1000);
      const newMissionBtn = page.locator('button:has-text("New Mission"), button:has-text("Create Mission"), #btn-sidebar-new-mission').first();
      if (await newMissionBtn.isVisible()) {
        await newMissionBtn.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(screenshotsDir, 'new_incident.png'), fullPage: false });
        const modalClose = page.locator('.incident-modal-close, button:has-text("✕")').first();
        if (await modalClose.isVisible()) await modalClose.click();
        await page.waitForTimeout(500);
      }
    } catch (e) {
      console.warn('Could not open new incident modal:', e.message);
    }

    // 5. Processing Page
    console.log('5. Capturing 8-Stage Processing View...');
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('page', 'pipeline');
      window.history.pushState({}, '', url.toString());
      window.dispatchEvent(new Event('popstate'));
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(screenshotsDir, 'processing.png'), fullPage: false });

    // 6. Interactive 3D Viewer / Scene Page
    console.log('6. Capturing Interactive 3D Viewer...');
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('page', 'reconstruction');
      window.history.pushState({}, '', url.toString());
      window.dispatchEvent(new Event('popstate'));
    });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(screenshotsDir, 'viewer.png'), fullPage: false });

    // 7. AI Detections & Video Frames Tab
    console.log('7. Capturing AI Detections & Tracking View...');
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('page', 'analysis');
      window.history.pushState({}, '', url.toString());
      window.dispatchEvent(new Event('popstate'));
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, 'detections.png'), fullPage: false });

    // 8. Geospatial Map View
    console.log('8. Capturing Geospatial Map View...');
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('page', 'geospatial');
      window.history.pushState({}, '', url.toString());
      window.dispatchEvent(new Event('popstate'));
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, 'geospatial.png'), fullPage: false });

    // 9. Certified Engineering Report View
    console.log('9. Capturing Report & Disclosures View...');
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('page', 'reports');
      window.history.pushState({}, '', url.toString());
      window.dispatchEvent(new Event('popstate'));
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, 'report.png'), fullPage: false });

    console.log('\n[Screenshots] All 9 high-res screenshots captured successfully in docs/screenshots/');
  } catch (err) {
    console.error('[Screenshots Error]:', err);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  captureReadmeScreens();
}

module.exports = { captureReadmeScreens };
