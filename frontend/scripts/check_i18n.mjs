// Script to verify i18n dictionary key consistency and translation completeness
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const flattenKeys = (value, prefix = "") => Object.entries(value).flatMap(([key, child]) => {
  const path = prefix ? `${prefix}.${key}` : key;
  return child && typeof child === "object" && !Array.isArray(child)
    ? [path, ...flattenKeys(child, path), key]
    : [path, key];
});
const localePath = (name) => new URL(`../src/locales/${name}.json`, import.meta.url);
const [enJson, hiJson] = await Promise.all([
  readFile(fileURLToPath(localePath("en")), "utf8").then(JSON.parse),
  readFile(fileURLToPath(localePath("hi")), "utf8").then(JSON.parse),
]);

console.log("=== CHECKING i18n LOCALIZATION CONSISTENCY ===");

const enKeys = [...new Set(flattenKeys(enJson))];
const hiKeys = [...new Set(flattenKeys(hiJson))];

console.log(`English keys count: ${enKeys.length}`);
console.log(`Hindi keys count:   ${hiKeys.length}`);

const missingInHindi = enKeys.filter((k) => !hiKeys.includes(k));
const missingInEnglish = hiKeys.filter((k) => !enKeys.includes(k));

if (missingInHindi.length > 0) {
  console.error("Missing in Hindi:", missingInHindi);
}
if (missingInEnglish.length > 0) {
  console.error("Missing in English:", missingInEnglish);
}

if (missingInHindi.length === 0 && missingInEnglish.length === 0) {
  console.log("--> i18n VALIDATION PASSED: Perfect key parity between English and Hindi!");
  process.exit(0);
} else {
  console.error("--> i18n VALIDATION FAILED: Keys mismatch!");
  process.exit(1);
}
