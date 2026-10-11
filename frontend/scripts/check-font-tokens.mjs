import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

async function cssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? cssFiles(target) : entry.name.endsWith(".css") ? [target] : [];
  }));
  return files.flat();
}

const files = await cssFiles(root);
const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));
const definedTokens = new Set();
for (const [, source] of sources) {
  for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) definedTokens.add(match[1]);
}

const errors = [];
for (const [file, source] of sources) {
  for (const declaration of source.matchAll(/(?:font-family|font)\s*:\s*([^;{}]+);/gi)) {
    for (const variable of declaration[1].matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!definedTokens.has(variable[1])) {
        errors.push(`${path.relative(process.cwd(), file)}: undefined ${variable[1]} in ${declaration[0].trim()}`);
      }
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Font token check passed (${files.length} CSS files scanned).`);
}
