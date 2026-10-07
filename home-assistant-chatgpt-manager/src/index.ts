import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { loadConfig } from "./config.js";
import { HomeAssistantClient } from "./home-assistant.js";
import { buildMcpServer } from "./mcp.js";

const config = loadConfig();

const homeAssistant = new HomeAssistantClient(
  config.homeAssistantBaseUrl,
  config.homeAssistantWebSocketUrl,
  config.homeAssistantToken,
);

const mcpHandler = createMcpHandler(() =>
  buildMcpServer(homeAssistant, config.writeAccess),
);
const nodeMcpHandler = toNodeHandler(mcpHandler);

function secureEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(request: IncomingMessage): boolean {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return false;
  return secureEquals(value.slice("Bearer ".length), config.apiKey);
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  if (url.pathname === "/health" && request.method === "GET") {
    sendJson(response, 200, {
      status: "ok",
      service: "home-assistant-chatgpt-manager",
      version: "0.1.0",
      write_access: config.writeAccess,
    });
    return;
  }

  if (url.pathname === "/" && request.method === "GET") {
    sendJson(response, 200, {
      name: "Home Assistant ChatGPT Manager",
      mcp: "/mcp",
      health: "/health",
    });
    return;
  }

  if (url.pathname !== "/mcp") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (!isAuthorized(request)) {
    response.setHeader("WWW-Authenticate", "Bearer");
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  void nodeMcpHandler(request, response);
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(
    `[home-assistant-chatgpt-manager] listening on 0.0.0.0:${config.port}; write_access=${config.writeAccess}`,
  );
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[home-assistant-chatgpt-manager] received ${signal}, shutting down`);
  await mcpHandler.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
