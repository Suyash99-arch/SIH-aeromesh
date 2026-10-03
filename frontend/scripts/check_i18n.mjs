// Script to verify i18n dictionary key consistency and translation completeness
import { TRANSLATIONS, LANGUAGES } from "../src/utils/i18n.js";

console.log("=== CHECKING i18n LOCALIZATION CONSISTENCY ===");

const enKeys = Object.keys(TRANSLATIONS.en || {});
const hiKeys = Object.keys(TRANSLATIONS.hi || {});

console.log(`English keys count: ${enKeys.length}`);
console.log(`Hindi keys count:   ${hiKeys.length}`);

const missingInHindi = enKeys.filter((k) => !(k in TRANSLATIONS.hi));
const missingInEnglish = hiKeys.filter((k) => !(k in TRANSLATIONS.en));

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
