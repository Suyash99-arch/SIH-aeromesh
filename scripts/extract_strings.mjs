import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "frontend", "src");

// Patterns to detect visible JSX strings:
// 1. Text between JSX tags: >Some visible text<
// 2. JSX attributes: placeholder="...", title="...", alt="...", aria-label="..."
const JSX_TEXT_RE = />\s*([A-Za-z][^<>{}\r\n]{2,})\s*</g;
const ATTR_RE = /\b(placeholder|title|alt|aria-label)\s*=\s*["']([^"']+)["']/g;
const T_CALL_RE = /\bt\(\s*["']([^"']+)["']/g;

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, "/");
  const lines = content.split("\n");
  
  const results = {
    file: relPath,
    tCalls: [],
    literals: [],
  };

  // Scan t() calls
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    T_CALL_RE.lastIndex = 0;
    while ((match = T_CALL_RE.exec(line)) !== null) {
      results.tCalls.push({ line: i + 1, key: match[1] });
    }
  }

  // Scan text between tags
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("//") || line.trim().startsWith("/*") || line.trim().startsWith("*")) {
      continue;
    }
    let match;
    JSX_TEXT_RE.lastIndex = 0;
    while ((match = JSX_TEXT_RE.exec(line)) !== null) {
      const text = match[1].trim();
      // Filter out code keywords, styles, css properties, hex codes, or javascript expressions
      if (text.length > 1 && !text.startsWith("http") && !text.includes("var(--") && !text.startsWith("#")) {
        results.literals.push({ line: i + 1, text, type: "tag-content" });
      }
    }

    ATTR_RE.lastIndex = 0;
    while ((match = ATTR_RE.exec(line)) !== null) {
      const text = match[2].trim();
      if (text.length > 1 && !text.startsWith("http")) {
        results.literals.push({ line: i + 1, text, type: match[1] });
      }
    }
  }

  return results;
}

function walkDir(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (entry.name.endsWith(".jsx") || (entry.name.endsWith(".js") && !entry.name.includes(".test.") && !entry.name.includes(".spec."))) {
      files.push(fullPath);
    }
  }
  return files;
}

const allFiles = walkDir(srcDir);
const report = allFiles.map(scanFile);

let totalTCalls = 0;
let totalLiterals = 0;

console.log("=========================================================================================");
console.log("                      HEXA SPARK / AEROMESH i18n STRING EXTRACTION                       ");
console.log("=========================================================================================\n");

console.log(`${"Source File".padEnd(55)} | ${"t() Calls".padEnd(10)} | ${"Visible Literals".padEnd(16)}`);
console.log("-".repeat(90));

const sortedReport = report.sort((a, b) => b.literals.length - a.literals.length);

for (const r of sortedReport) {
  totalTCalls += r.tCalls.length;
  totalLiterals += r.literals.length;
  if (r.literals.length > 0 || r.tCalls.length > 0) {
    console.log(`${r.file.padEnd(55)} | ${String(r.tCalls.length).padEnd(10)} | ${String(r.literals.length).padEnd(16)}`);
  }
}

console.log("-".repeat(90));
console.log(`TOTALS: ${allFiles.length} files scanned | ${totalTCalls} t() calls | ${totalLiterals} un-localized visible strings\n`);

// Write detailed extraction to docs/extracted_strings.json
const outDir = path.join(rootDir, "docs");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
fs.writeFileSync(path.join(outDir, "extracted_strings.json"), JSON.stringify(sortedReport, null, 2), "utf-8");
console.log(`Detailed string extraction with line numbers written to docs/extracted_strings.json\n`);
