#!/usr/bin/env node
/** Direct client for the official Blender MCP add-on JSON TCP API, protocol15.
 * Upstream: ahujasid/blender-mcp@febcd90ece59c3416d7c55fd3723cea46bcaa59d.
 * Does not install a tool, proxy telemetry or enable third-party asset services.
 */
import { connect } from "node:net";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
export function blenderCommand(type, params = {}, timeoutMs = 55000) {
  return new Promise((accept, reject) => {
    const socket = connect({ host: "127.0.0.1", port: 9876 });
    let data = "";
    const decoder = new StringDecoder("utf8");
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => socket.write(JSON.stringify({ type, params })));
    socket.on("data", (chunk) => {
      data += decoder.write(chunk);
      if (data.length > 4 * 1024 * 1024) {
        socket.destroy();
        reject(new Error("Oversized Blender MCP response"));
        return;
      }
      let response;
      try {
        response = JSON.parse(data);
      } catch {
        return;
      }
      socket.end();
      if (response.status === "error") reject(new Error(response.message));
      else accept(response.result);
    });
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Blender MCP command timed out"));
    });
    socket.on("end", () => {
      if (!data) reject(new Error("Blender MCP closed before responding"));
    });
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command = "get_scene_info", path] = process.argv.slice(2);
  const params =
    command === "execute_code" ? { code: await readFile(path, "utf8") } : {};
  console.log(JSON.stringify(await blenderCommand(command, params), null, 2));
}
