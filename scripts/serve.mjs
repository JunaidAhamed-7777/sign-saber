#!/usr/bin/env node
/** Serve a prepared production build locally, with privacy CSP on worker responses. */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./security-headers.mjs";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".tflite": "application/octet-stream",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};
const within = (root, path) => path === root || path.startsWith(root + sep);
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !size || (!match[1] && !match[2])) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return false;
  return { start, end: Math.min(size - 1, end) };
}
export function createStaticHandler({ root }) {
  const absoluteRoot = resolve(root);
  const rootPromise = realpath(absoluteRoot).then(
    (path) => ({ path }),
    (error) => ({ error }),
  );
  return async (request, response) => {
    for (const [name, value] of Object.entries(securityHeaders))
      response.setHeader(name, value);
    response.setHeader("Cache-Control", "no-store");
    const fail = (status, message) => {
      response.statusCode = status;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      const body = `${message}\n`;
      response.setHeader("Content-Length", Buffer.byteLength(body));
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      fail(405, "Only GET and HEAD are supported.");
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
    } catch {
      fail(400, "Malformed URL.");
      return;
    }
    if (pathname.includes("\0") || pathname.includes("\\")) {
      fail(400, "Invalid asset path.");
      return;
    }
    let candidate = resolve(absoluteRoot, "." + pathname);
    if (!within(absoluteRoot, candidate)) {
      fail(403, "Asset path is outside the prepared build.");
      return;
    }
    try {
      const rootResult = await rootPromise;
      if (rootResult.error) throw rootResult.error;
      const canonicalRoot = rootResult.path;
      let info;
      try {
        info = await stat(candidate);
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
        if (
          !extname(pathname) &&
          request.headers.accept?.includes("text/html")
        ) {
          candidate = resolve(absoluteRoot, "index.html");
          info = await stat(candidate);
        } else {
          fail(404, "Asset not found.");
          return;
        }
      }
      if (info.isDirectory()) {
        candidate = resolve(candidate, "index.html");
        info = await stat(candidate);
      }
      const canonicalFile = await realpath(candidate);
      if (!within(canonicalRoot, canonicalFile)) {
        fail(403, "Asset path is outside the prepared build.");
        return;
      }
      if (!info.isFile()) {
        fail(404, "Asset not found.");
        return;
      }
      const range = parseRange(request.headers.range, info.size);
      if (range === false) {
        response.setHeader("Content-Range", `bytes */${info.size}`);
        fail(416, "Requested byte range is not available.");
        return;
      }
      const start = range ? range.start : 0;
      const end = range ? range.end : info.size - 1;
      response.statusCode = range ? 206 : 200;
      response.setHeader(
        "Content-Type",
        mimeTypes[extname(canonicalFile).toLowerCase()] ??
          "application/octet-stream",
      );
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Length", range ? end - start + 1 : info.size);
      if (range)
        response.setHeader(
          "Content-Range",
          `bytes ${start}-${end}/${info.size}`,
        );
      if (request.method === "HEAD" || !info.size) {
        response.end();
        return;
      }
      const stream = createReadStream(canonicalFile, { start, end });
      stream.on("error", () => {
        if (!response.headersSent)
          fail(500, "Could not read the prepared asset.");
        else response.destroy();
      });
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      fail(
        error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 500,
        error.code === "ENOENT"
          ? "Prepared asset not found. Run the production build first."
          : "Could not read the prepared build.",
      );
    }
  };
}
export function createStaticServer(options) {
  return createServer(createStaticHandler(options));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  let port = 4173;
  let host = "127.0.0.1";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port") port = Number(args[++i]);
    else if (args[i] === "--host") host = args[++i];
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new Error("Choose a valid local port.");
  if (!["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error("The prepared server only binds to loopback addresses.");
  const root = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "app",
    "dist",
  );
  await stat(resolve(root, "index.html"));
  const server = createStaticServer({ root });
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(
      `Sign Saber prepared build: http://${host === "::1" ? "[::1]" : host}:${port}`,
    ),
  );
}
