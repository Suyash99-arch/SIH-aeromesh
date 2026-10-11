import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const cssFiles = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith(".css")) cssFiles.push(path);
  }
}
await walk(root);
const sources = await Promise.all(cssFiles.map(async (path) => [path, await readFile(path, "utf8")]));
const declared = new Set(sources.flatMap(([, css]) => [...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1])));
const failures = [];
for (const [path, css] of sources) {
  for (const match of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    for (const variable of match[1].matchAll(/var\(\s*--([\w-]+)/g)) {
      if (!declared.has(variable[1])) failures.push(`${path}: font-family references undefined --${variable[1]}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Font token check passed (${sources.length} CSS files, ${declared.size} declared tokens).`);
}
