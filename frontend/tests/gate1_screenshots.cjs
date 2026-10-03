const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

(async () => {
  const scratchDir = "C:/Users/kc889/.gemini/antigravity-ide/brain/520f5372-741e-4d80-848f-04aaaeb2ff09/scratch";
  fs.mkdirSync(scratchDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const targetMission = "233381f5-0e03-4d48-aa6c-50de3017e593";

  const configs = [
    { theme: "dark", lang: "en", suffix: "dark_en" },
    { theme: "light", lang: "en", suffix: "light_en" },
    { theme: "dark", lang: "hi", suffix: "dark_hi" },
    { theme: "light", lang: "hi", suffix: "light_hi" },
  ];

  for (const cfg of configs) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // Set localStorage before navigating
    await page.goto("http://127.0.0.1:5173/");
    await page.evaluate(({ theme, lang }) => {
      localStorage.setItem("hexaspark_theme", theme);
      localStorage.setItem("hexaspark_lang", lang);
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.setAttribute("lang", lang);
    }, cfg);

    // 1. Landing Page
    await page.goto("http://127.0.0.1:5173/");
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(scratchDir, `gate1_landing_${cfg.suffix}.png`) });
    console.log(`Saved landing screenshot: gate1_landing_${cfg.suffix}.png`);

    // 2. Mission Command Overview Page
    await page.goto(`http://127.0.0.1:5173/?page=overview&mission=${targetMission}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(scratchDir, `gate1_mission_command_${cfg.suffix}.png`) });
    console.log(`Saved mission command screenshot: gate1_mission_command_${cfg.suffix}.png`);

    // 3. 3D Viewer Page
    await page.goto(`http://127.0.0.1:5173/?page=reconstruction&mission=${targetMission}`);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(scratchDir, `gate1_viewer_${cfg.suffix}.png`) });
    console.log(`Saved 3D viewer screenshot: gate1_viewer_${cfg.suffix}.png`);

    // 4. Reports Page
    await page.goto(`http://127.0.0.1:5173/?page=reports&mission=${targetMission}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(scratchDir, `gate1_reports_${cfg.suffix}.png`) });
    console.log(`Saved reports screenshot: gate1_reports_${cfg.suffix}.png`);

    await page.close();
  }

  await browser.close();
  console.log("All Gate 1 screenshots captured successfully!");
})();
