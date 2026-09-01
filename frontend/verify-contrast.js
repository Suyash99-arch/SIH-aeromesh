const { chromium } = require("@playwright/test");

// WCAG contrast ratio calculation
function getContrastRatio(rgb1, rgb2) {
  const getLuminance = (r, g, b) => {
    const [rs, gs, bs] = [r, g, b].map((x) => {
      x = x / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };

  const lum1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
  const lum2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseColor(colorStr) {
  if (!colorStr) return null;

  // Handle rgb/rgba
  const rgbMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1]),
      parseInt(rgbMatch[2]),
      parseInt(rgbMatch[3]),
    ];
  }

  // Handle hex
  const hexMatch = colorStr.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (hexMatch) {
    return [
      parseInt(hexMatch[1], 16),
      parseInt(hexMatch[2], 16),
      parseInt(hexMatch[3], 16),
    ];
  }

  return null;
}

function findBackgroundColor(element) {
  let el = element;
  while (el && el !== document.body) {
    const bgColor = window.getComputedStyle(el).backgroundColor;
    if (
      bgColor &&
      bgColor !== "rgba(0, 0, 0, 0)" &&
      bgColor !== "transparent"
    ) {
      return parseColor(bgColor);
    }
    el = el.parentElement;
  }
  return parseColor("rgb(10, 14, 27)"); // Default dark bg
}

async function checkContrast(page, url, pageName) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${pageName} - ${url}`);
  console.log("=".repeat(60));

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000); // Let animations settle

  const issues = await page.evaluate(async () => {
    const failures = [];

    // Select all text elements
    const selectors = [
      "h1, h2, h3, h4, h5, h6",
      "p, span, label, div",
      "a, button, input::placeholder",
    ];

    const elements = document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, p, span, label, div, a, button",
    );

    for (const el of elements) {
      // Skip hidden/empty elements
      if (!el.offsetParent || !el.textContent.trim()) continue;

      const textColor = window.getComputedStyle(el).color;
      const textContent = el.textContent.trim().substring(0, 50);

      let bgEl = el;
      let bgColor = null;
      while (
        bgEl &&
        bgEl !== document.body &&
        (!bgColor ||
          bgColor === "rgba(0, 0, 0, 0)" ||
          bgColor === "transparent")
      ) {
        bgColor = window.getComputedStyle(bgEl).backgroundColor;
        bgEl = bgEl.parentElement;
      }

      if (
        !bgColor ||
        bgColor === "rgba(0, 0, 0, 0)" ||
        bgColor === "transparent"
      ) {
        bgColor = "rgb(10, 14, 27)"; // Default dark
      }

      failures.push({
        tag: el.tagName,
        text: textContent,
        color: textColor,
        bgColor: bgColor,
        element: el.className || el.id || el.tagName,
      });
    }

    return failures;
  });

  let contrastFailures = 0;

  for (const issue of issues) {
    const fgColor = parseColor(issue.color);
    const bgColor = parseColor(issue.bgColor);

    if (!fgColor || !bgColor) continue;

    const ratio = getContrastRatio(fgColor, bgColor);

    if (ratio < 4.5) {
      contrastFailures++;
      console.log(`\n❌ LOW CONTRAST (${ratio.toFixed(2)}:1)`);
      console.log(`   Element: <${issue.tag}> ${issue.element}`);
      console.log(`   Text: "${issue.text}"`);
      console.log(`   Foreground: ${issue.color}`);
      console.log(`   Background: ${issue.bgColor}`);
    }
  }

  console.log(
    `\n📊 Total issues: ${contrastFailures}/${issues.length} elements`,
  );
  return contrastFailures;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const routes = [
    { url: "http://localhost:5175/", name: "Home" },
    { url: "http://localhost:5175/?page=overview", name: "Overview" },
    { url: "http://localhost:5175/?page=missions", name: "Missions" },
    { url: "http://localhost:5175/?page=drone", name: "Drone" },
    {
      url: "http://localhost:5175/?page=reconstruction",
      name: "Reconstruction",
    },
    { url: "http://localhost:5175/?page=intelligence", name: "Intelligence" },
    { url: "http://localhost:5175/?page=challenge", name: "Challenge" },
    { url: "http://localhost:5175/?page=settings", name: "Settings" },
  ];

  let totalIssues = 0;

  for (const route of routes) {
    const issues = await checkContrast(page, route.url, route.name);
    totalIssues += issues;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`TOTAL FAILURES ACROSS ALL PAGES: ${totalIssues}`);
  console.log("=".repeat(60));

  await browser.close();
  process.exit(totalIssues > 0 ? 1 : 0);
}

main();
