import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = path.join(frontendRoot, "src");
const localePath = (name) => path.join(sourceRoot, "locales", `${name}.json`);

function flattenPaths(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const current = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child)
      ? flattenPaths(child, current)
      : [current];
  });
}

async function sourceFiles(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(target));
    else if (/\.(?:js|jsx|ts|tsx|css|json)$/u.test(entry.name)) result.push(target);
  }
  return result;
}

const [enJson, hiJson] = await Promise.all([
  readFile(localePath("en"), "utf8").then(JSON.parse),
  readFile(localePath("hi"), "utf8").then(JSON.parse),
]);
const enKeys = new Set(flattenPaths(enJson));
const hiKeys = new Set(flattenPaths(hiJson));
const missingInHindi = [...enKeys].filter((key) => !hiKeys.has(key));
const missingInEnglish = [...hiKeys].filter((key) => !enKeys.has(key));
const localeKeys = { en: enKeys, hi: hiKeys };

const allSourceFiles = await sourceFiles(sourceRoot);
const codeFiles = allSourceFiles.filter((file) => /\.(?:js|jsx|ts|tsx)$/u.test(file));
const usedKeys = new Set();
const translationCall = /\bt\s*\(\s*(["'])([^"']+)\1/gu;
for (const file of codeFiles) {
  const text = (await readFile(file, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|\s)\/\/.*$/gmu, "$1");
  for (const match of text.matchAll(translationCall)) {
    const key = match[2];
    if (!key.includes("${") && !key.endsWith(".")) usedKeys.add(key);
  }
}
const missingUsedKeys = [...usedKeys].flatMap((key) =>
  ["en", "hi"].filter((language) => !localeKeys[language].has(key)).map((language) => `${language}: ${key}`),
);

const filesToInspect = [...allSourceFiles, path.join(frontendRoot, "index.html")];
const mojibake = /(?:\u00c2[\u0080-\u00ff]|\u00c3[\u0080-\u00ff]|\u00e2(?:\u20ac|\u2018|\u2019|\u201c|\u201d|\u20ac)|\u00e0\u00a4|\u00e0\u00a5)/u;
const badEncodingFiles = [];
const bomFiles = [];
for (const file of filesToInspect) {
  const buffer = await readFile(file);
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) bomFiles.push(path.relative(frontendRoot, file));
  const text = buffer.toString("utf8");
  if (mojibake.test(text)) badEncodingFiles.push(path.relative(frontendRoot, file));
}

const html = await readFile(path.join(frontendRoot, "index.html"), "utf8");
const missingCharset = !/<meta\s+charset=["']utf-8["']/iu.test(html);
const errors = [];
if (missingInHindi.length) errors.push(`Missing in Hindi: ${missingInHindi.join(", ")}`);
if (missingInEnglish.length) errors.push(`Missing in English: ${missingInEnglish.join(", ")}`);
if (missingUsedKeys.length) errors.push(`t() keys missing from locale files: ${missingUsedKeys.join(", ")}`);
if (badEncodingFiles.length) errors.push(`Mojibake patterns found in: ${badEncodingFiles.join(", ")}`);
if (bomFiles.length) errors.push(`UTF-8 BOM found in: ${bomFiles.join(", ")}`);
if (missingCharset) errors.push("index.html is missing <meta charset=\"utf-8\">");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Locale parity passed (${enKeys.size} keys per locale); ${usedKeys.size} static t() keys exist in both locales.`);
console.log(`Encoding checks passed (${filesToInspect.length} source/HTML files, UTF-8 without BOM, no mojibake).`);
