const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = 'C:\\Users\\kc889\\.gemini\\antigravity-ide\\brain\\8fda6c9c-006b-446e-814a-d64714b6b1ea';
const MISSION_ID = 'faf26d2d-b804-4a97-894e-4756af3fc522';

(async () => {
    console.log('Launching browser to capture 3D Viewer modes and Video Frames tab...');
    const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const page = await context.newPage();

    // Navigate to 3D reconstruction page
    const url = `http://127.0.0.1:5173/?page=reconstruction&mission=${MISSION_ID}`;
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // 1. Capture Textured Mode (Default)
    const texturedPath = path.join(ARTIFACT_DIR, 'viewer_textured.png');
    await page.screenshot({ path: texturedPath });
    console.log('Saved viewer_textured.png');

    // Helper to click mode button
    async function selectMode(modeName) {
        const btn = page.locator(`button:has-text("${modeName}"), button[title*="${modeName}" i], .render-mode-btn:has-text("${modeName}")`).first();
        if (await btn.count() > 0) {
            await btn.click();
            await page.waitForTimeout(1000);
            return true;
        }
        return false;
    }

    // 2. Solid Mode
    console.log('Switching to Solid mode...');
    await selectMode('Solid');
    const solidPath = path.join(ARTIFACT_DIR, 'viewer_solid.png');
    await page.screenshot({ path: solidPath });
    console.log('Saved viewer_solid.png');

    // 3. Wireframe Mode
    console.log('Switching to Wireframe mode...');
    await selectMode('Wireframe');
    const wireframePath = path.join(ARTIFACT_DIR, 'viewer_wireframe.png');
    await page.screenshot({ path: wireframePath });
    console.log('Saved viewer_wireframe.png');

    // 4. Point Cloud Mode
    console.log('Switching to Point Cloud mode...');
    await selectMode('Point Cloud');
    const pointcloudPath = path.join(ARTIFACT_DIR, 'viewer_pointcloud.png');
    await page.screenshot({ path: pointcloudPath });
    console.log('Saved viewer_pointcloud.png');

    // 5. Video Frames Tab
    console.log('Switching to Video Frames tab...');
    const framesTab = page.locator('button:has-text("Video Frames"), button:has-text("Keyframes"), .tab-btn:has-text("Frames")').first();
    if (await framesTab.count() > 0) {
        await framesTab.click();
        await page.waitForTimeout(1500);
    }
    const framesTabPath = path.join(ARTIFACT_DIR, 'viewer_video_frames_tab.png');
    await page.screenshot({ path: framesTabPath });
    console.log('Saved viewer_video_frames_tab.png');

    await browser.close();
    console.log('All viewer screenshots captured successfully.');
})();
