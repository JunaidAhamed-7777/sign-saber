import type { IncomingMessage, Server, ServerResponse } from "node:http";
export function createStaticHandler(options: {
  root: string;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
export function createStaticServer(options: { root: string }): Server;
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | false | null;
