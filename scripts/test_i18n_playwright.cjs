const path = require('path');
const fs = require('fs');

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  chromium = require(path.resolve(__dirname, '../frontend/node_modules/playwright')).chromium;
}

const ALLOW_LIST = [
  'HEXA', 'SPARK', 'AEROMESH', 'YOLO', 'COLMAP', 'PyCOLMAP', 'ByteTrack', 'BoT-SORT',
  'UTC', 'GPS', 'CPU', 'GPU', 'RAM', 'CUDA', 'VRAM', 'MB', 'GB', 'KB', 'FPS', 'px',
  'm', 'km', 'm²', 'km²', 's', 'min', 'h', 'ID', 'API', 'UUID', 'PNG', 'JPG', 'MP4',
  'MOV', 'MKV', 'AVI', 'GLB', 'PLY', 'OBJ', 'LAS', 'GeoJSON', 'JSON', 'ZIP', 'PDF',
  'CSV', 'RBAC', 'MFA', 'OTP', 'HTTP', 'HTTPS', 'URL', 'REST', 'SSE', 'SIH', 'BUILD',
  'AI', '3D', '2D', '4K', 'UHD', 'HD', 'v0.9.0', 'v1.0', 'X4', 'AERO-X4', 'Intel',
  'NVIDIA', 'GeForce', 'RTX', 'GTX', 'UHD Graphics'
];

function isAllowed(word) {
  const clean = word.replace(/[^a-zA-Z0-9]/g, '').trim();
  if (!clean || clean.length < 4) return true;
  if (/^[0-9]+(\.[0-9]+)?[a-zA-Z]*$/.test(clean)) return true;
  if (/^[A-Z0-9_-]+$/.test(clean) && clean.length <= 6) return true;
  return ALLOW_LIST.some(term => clean.toLowerCase() === term.toLowerCase());
}

async function runHindiAudit() {
  console.log('==================================================');
  console.log('       PLAYWRIGHT HINDI LOCALIZATION AUDIT        ');
  console.log('==================================================\n');

  const screenshotsDir = path.resolve(__dirname, '../docs/screenshots/hindi');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-web-security'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'hi-IN',
  });

  const page = await context.newPage();

  // Set language to Hindi in localStorage
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('aeromesh_lang', 'hi');
    localStorage.setItem('aeromesh_theme', 'dark');
    window.location.reload();
  });
  await page.waitForTimeout(2000);

  const pagesToTest = [
    { name: 'landing', path: '/' },
    { name: 'dashboard', path: '/?page=missions' },
    { name: 'reconstruction_3d', path: '/?page=viewer' },
    { name: 'scene_intelligence', path: '/?page=analysis' },
    { name: 'geospatial', path: '/?page=geospatial' },
    { name: 'reports', path: '/?page=reports' },
  ];

  let totalLatinViolations = 0;

  for (const p of pagesToTest) {
    console.log(`Auditing Page: [${p.name}]...`);
    await page.goto(`http://127.0.0.1:5173${p.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Capture Dark Mode Screenshot
    await page.screenshot({ path: path.join(screenshotsDir, `${p.name}_dark_hi.png`), fullPage: false });

    // Switch to Light Mode and Capture
    await page.evaluate(() => {
      localStorage.setItem('aeromesh_theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotsDir, `${p.name}_light_hi.png`), fullPage: false });

    // Restore Dark Mode
    await page.evaluate(() => {
      localStorage.setItem('aeromesh_theme', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    // Extract all visible text nodes
    const visibleTexts = await page.evaluate(() => {
      const texts = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return NodeFilter.FILTER_REJECT;
          }
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE'].includes(parent.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      while (walker.nextNode()) {
        const txt = walker.currentNode.nodeValue.trim();
        if (txt) texts.push(txt);
      }
      return texts;
    });

    // Check for 4+ consecutive Latin letters not in allow-list
    const violations = [];
    const latinRegex = /[a-zA-Z]{4,}/g;

    for (const txt of visibleTexts) {
      const matches = txt.match(latinRegex);
      if (matches) {
        for (const match of matches) {
          if (!isAllowed(match)) {
            violations.push({ text: txt, word: match });
          }
        }
      }
    }

    if (violations.length === 0) {
      console.log(`  ✓ Clean Hindi page: 0 Latin violations detected.`);
    } else {
      console.log(`  ⚠ ${violations.length} Latin word(s) detected:`);
      violations.slice(0, 5).forEach(v => console.log(`     - "${v.word}" in "${v.text.substring(0, 40)}..."`));
      totalLatinViolations += violations.length;
    }
  }

  await browser.close();

  console.log('\n==================================================');
  console.log(`HINDI AUDIT COMPLETE: ${totalLatinViolations} total non-allowlisted Latin tokens.`);
  console.log('==================================================\n');
}

runHindiAudit().catch(err => {
  console.error('Audit failed:', err);
});
