// i18n Internationalization & Unit Formatting Engine (English + Hindi)
// WCAG AA Compliant Locale & Unit Conversion Utility
import enJson from "../locales/en.json";
import hiJson from "../locales/hi.json";

export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "हिन्दी" },
];

export const UNITS = [
  { id: "metric", label: "Metric (m, km², km/h)", sys: "SI" },
  { id: "imperial", label: "Imperial (ft, sq mi, mph)", sys: "US" },
];

// Helper to flatten nested object into dot-notation map
function flattenDict(obj, prefix = "") {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenDict(value, fullKey));
    } else {
      result[fullKey] = value;
      // Also register bare key if not conflicting
      if (!result[key]) {
        result[key] = value;
      }
    }
  }
  return result;
}

const flatEn = flattenDict(enJson);
const flatHi = flattenDict(hiJson);

export const TRANSLATIONS = {
  en: { ...flatEn },
  hi: { ...flatHi },
};

/**
 * Universal translation resolver supporting:
 * - Nested keys: t("nav.dashboard")
 * - Flat keys: t("dashboard")
 * - Interpolation: t("itemCount", { count: 5 })
 */
export function translate(key, params = {}, lang = "en", fallback = null) {
  if (!key) return "";
  let f = fallback;
  let p = params;
  if (typeof params === "string") {
    f = params;
    p = {};
  }
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  let text = dict[key];

  if (!text) {
    text = TRANSLATIONS.en[key] || f || key;
  }

  if (typeof text === "string" && p && typeof p === "object") {
    for (const [pKey, pVal] of Object.entries(p)) {
      text = text.replace(new RegExp(`\\{${pKey}\\}`, "g"), String(pVal));
    }
  }

  return text;
}

/**
 * Locale-aware number formatter
 */
export function formatNumber(num, lang = "en", options = {}) {
  if (num === null || num === undefined || isNaN(num)) return "0";
  try {
    return new Intl.NumberFormat(lang === "hi" ? "hi-IN" : "en-US", options).format(num);
  } catch {
    return String(num);
  }
}

/**
 * Format length or distance into current active unit system (Metric vs Imperial)
 */
export function formatDistance(meters, unitSystem = "metric", lang = "en") {
  if (meters === null || meters === undefined || isNaN(meters)) return "—";
  if (unitSystem === "imperial") {
    const feet = meters * 3.28084;
    return `${formatNumber(feet, lang, { maximumFractionDigits: 2 })} ft`;
  }
  return `${formatNumber(meters, lang, { maximumFractionDigits: 2 })} m`;
}

/**
 * Format area into active unit system
 */
export function formatArea(sqMeters, unitSystem = "metric", lang = "en") {
  if (sqMeters === null || sqMeters === undefined || isNaN(sqMeters)) return "—";
  if (unitSystem === "imperial") {
    const sqFt = sqMeters * 10.7639;
    if (sqFt > 27878400) {
      const sqMi = sqMeters / 2589988.11;
      return `${formatNumber(sqMi, lang, { maximumFractionDigits: 2 })} sq mi`;
    }
    return `${formatNumber(sqFt, lang, { maximumFractionDigits: 2 })} sq ft`;
  }
  if (sqMeters > 1000000) {
    const sqKm = sqMeters / 1000000;
    return `${formatNumber(sqKm, lang, { maximumFractionDigits: 2 })} km²`;
  }
  return `${formatNumber(sqMeters, lang, { maximumFractionDigits: 2 })} m²`;
}

/**
 * Format timestamp in locale-aware format
 */
export function formatDateTime(isoString, lang = "en") {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return isoString;
  }
}
