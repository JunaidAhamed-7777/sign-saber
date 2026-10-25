#!/usr/bin/env node
/** Production JavaScript budgets: docs/16-performance-budget.md §Bundle-size budget. */
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const MAX_JS_CHUNK_BYTES = 500_000;

/** Parse the optional assets directory; unknown flags must not silently disable checks. */
export function parseArguments(args) {
  if (args.length > 1 || args.some((arg) => arg.startsWith("-")))
    throw new Error("Usage: node scripts/check-bundle.mjs [assets-directory]");
  return resolve(
    args[0] ?? fileURLToPath(new URL("../app/dist/assets", import.meta.url)),
  );
}

export function checkChunks(chunks, budget = MAX_JS_CHUNK_BYTES) {
  if (!Number.isSafeInteger(budget) || budget <= 0)
    throw new Error("Invalid bundle budget");
  if (!chunks.length)
    throw new Error("No JavaScript chunks found. Run npm run build first.");
  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.bytes) || chunk.bytes < 0)
      throw new Error(`Invalid size for ${chunk.file}`);
  }
  return chunks.filter((chunk) => chunk.bytes > budget);
}

/** Read emitted bytes, including worker and nested chunks; maps/CSS are not JavaScript. */
export async function readChunks(directory) {
  const chunks = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && /\.(?:m?js)$/.test(entry.name)) {
        const bytes = await readFile(file);
        chunks.push({
          file: relative(directory, file).replaceAll("\\", "/"),
          bytes: bytes.length,
          gzipBytes: gzipSync(bytes).length,
        });
      }
    }
  }
  await walk(directory);
  return chunks.sort((a, b) => a.file.localeCompare(b.file));
}

export async function main(args = process.argv.slice(2)) {
  const chunks = await readChunks(parseArguments(args));
  const violations = checkChunks(chunks);
  for (const chunk of chunks)
    console.log(
      `${chunk.file}: ${chunk.bytes} bytes (${chunk.gzipBytes} gzip)${chunk.bytes > MAX_JS_CHUNK_BYTES ? " OVER BUDGET" : ""}`,
    );
  if (violations.length)
    throw new Error(
      `${violations.length} JavaScript chunk(s) exceed ${MAX_JS_CHUNK_BYTES} bytes.`,
    );
  console.log(
    `Bundle budget passed: ${chunks.length} JavaScript chunks, each ≤ ${MAX_JS_CHUNK_BYTES} bytes.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
