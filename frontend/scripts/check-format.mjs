import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const frontendDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceDir = path.join(frontendDir, "src");
const baselinePath = path.join(frontendDir, "scripts", "format-baseline.json");
const updateBaseline = process.argv.includes("--update-baseline");
const baseline = updateBaseline
  ? {}
  : JSON.parse(await readFile(baselinePath, "utf8"));
const failures = [];
let checked = 0;
let unchangedLegacy = 0;

async function* sourceFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(file);
    } else if (entry.isFile()) {
      yield file;
    }
  }
}

for await (const file of sourceFiles(sourceDir)) {
  const info = await prettier.getFileInfo(file);
  if (info.ignored || !info.inferredParser) continue;

  const relative = path.relative(sourceDir, file).replaceAll(path.sep, "/");
  const source = await readFile(file, "utf8");
  const options = { ...(await prettier.resolveConfig(file)), filepath: file };
  checked += 1;
  if (await prettier.check(source, options)) continue;

  // Git may check out CRLF on Windows and LF on CI. Hash canonical line endings.
  const digest = createHash("sha256")
    .update(source.replace(/\r\n?/g, "\n"))
    .digest("hex");
  if (updateBaseline) {
    baseline[relative] = digest;
  } else if (baseline[relative] === digest) {
    unchangedLegacy += 1;
  } else {
    failures.push(relative);
  }
}

if (updateBaseline) {
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `Recorded ${Object.keys(baseline).length} existing files needing formatting.`,
  );
} else if (failures.length) {
  console.error("Format these changed or new files with Prettier:");
  for (const file of failures) console.error(`  src/${file}`);
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${checked} source files; ${unchangedLegacy} unchanged files remain in the formatting baseline.`,
  );
}
