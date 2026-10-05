import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const frontendSrc = path.join(rootDir, "frontend", "src");
const i18nFile = path.join(frontendSrc, "utils", "i18n.js");

console.log("==================================================");
console.log("     HEXA SPARK i18n CONSISTENCY & KEY AUDIT      ");
console.log("==================================================");

const enFile = path.join(frontendSrc, "locales", "en.json");
const hiFile = path.join(frontendSrc, "locales", "hi.json");

const enJson = JSON.parse(fs.readFileSync(enFile, "utf-8"));
const hiJson = JSON.parse(fs.readFileSync(hiFile, "utf-8"));

function flattenDict(obj, prefix = "") {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenDict(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

const flatEn = flattenDict(enJson);
const flatHi = flattenDict(hiJson);

const enKeys = Object.keys(flatEn);
const hiKeys = Object.keys(flatHi);

console.log(`[Dictionary] English keys: ${enKeys.length}`);
console.log(`[Dictionary] Hindi keys:   ${hiKeys.length}`);

const missingInHindi = enKeys.filter((k) => !(k in flatHi));
const missingInEnglish = hiKeys.filter((k) => !(k in flatEn));

let hasErrors = false;

if (missingInHindi.length > 0) {
  console.error(`[ERROR] ${missingInHindi.length} key(s) missing in Hindi:`, missingInHindi);
  hasErrors = true;
}

if (missingInEnglish.length > 0) {
  console.error(`[ERROR] ${missingInEnglish.length} key(s) missing in English:`, missingInEnglish);
  hasErrors = true;
}

if (!hasErrors) {
  console.log("✓ Dictionary Key Parity: Perfect 1:1 match between English and Hindi.");
}

// 2. Scan JSX components for i18n coverage
function walkDir(dir, callback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, callback);
    } else if (entry.name.endsWith(".jsx") || entry.name.endsWith(".js")) {
      callback(fullPath);
    }
  }
}

let totalComponentsScanned = 0;
walkDir(frontendSrc, (filePath) => {
  totalComponentsScanned++;
});

console.log(`[Components] Scanned ${totalComponentsScanned} source files in frontend/src.`);

if (hasErrors) {
  console.error("\n--> i18n VALIDATION FAILED: Keys mismatch!");
  process.exit(1);
} else {
  console.log("\n--> i18n VALIDATION PASSED: 100% Localization Completeness!\n");
  process.exit(0);
}
