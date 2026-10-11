import { ChangeManager, clientContext } from "./changes.js";
import { ChangeTargets } from "./change-targets.js";
import { OwnerReview } from "./owner-review.js";
import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { BridgeConfig } from "./config.js";
import { HomeAssistantClient } from "./home-assistant.js";
import { buildMcpServer } from "./mcp.js";
import { OAuthServer, secretEqual } from "./oauth.js";

export function createBridge(config: BridgeConfig) {
  const ha = new HomeAssistantClient(
    config.homeAssistantBaseUrl,
    config.homeAssistantWebSocketUrl,
    config.homeAssistantToken,
  );
  const changes = new ChangeManager(new ChangeTargets(ha), config);
  const review = new OwnerReview(changes);
  const mcp = createMcpHandler(() =>
    buildMcpServer(ha, config.writeAccess, changes),
  );
  const handler = toNodeHandler(mcp);
  const oauth = config.publicUrl ? new OAuthServer(config) : undefined;
  const server = createServer(async (req, res) => {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "GET" && (path === "/health" || path === "/")) {
        json(200, {
          status: "ok",
          service: "home-assistant-mcp-manager",
          version: "0.4.0",
          write_access: config.writeAccess,
          oauth_enabled: !!oauth,
          mcp: "/mcp",
        });
        return;
      }
      if (await review.handle(req, res, path)) return;
      if (oauth && (await oauth.handle(req, res, path))) return;
      if (path !== "/mcp") {
        json(404, { error: "not_found" });
        return;
      }
      // Log only fixed categories and HTTP status: never bodies, URLs, headers,
      // entity data, cookies or credentials. This makes discovery failures visible.
      const method = ["GET", "POST", "DELETE", "OPTIONS"].includes(
        req.method ?? "",
      )
        ? req.method
        : "OTHER";
      let access = "pending";
      const origin = !req.headers.origin
        ? "absent"
        : req.headers.origin === config.publicUrl
          ? "matching"
          : "rejected";
      console.info(`[mcp] request method=${method} origin=${origin}`);
      let logged = false;
      const logOutcome = (event: "finish" | "close") => {
        if (logged) return;
        logged = true;
        console.info(
          `[mcp] response method=${method} status=${res.statusCode} access=${access} event=${event}`,
        );
      };
      res.once("finish", () => logOutcome("finish"));
      res.once("close", () => logOutcome("close"));
      // Browser requests must originate from this deployment; server-to-server
      // MCP clients normally omit Origin. Never use wildcard CORS for credentials.
      if (req.headers.origin && req.headers.origin !== config.publicUrl) {
        access = "origin-rejected";
        json(403, { error: "invalid_origin" });
        return;
      }
      const token = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : "";
      const identity =
        token.length > 0 && token.length <= 2048
          ? config.allowLegacyApiKey && secretEqual(token, config.apiKey)
            ? "legacy-api-key"
            : await oauth?.identity(token)
          : undefined;
      const allowed = !!identity;
      access = allowed
        ? "accepted"
        : token
          ? "token-rejected"
          : "missing-token";
      if (!allowed) {
        if (oauth) oauth.challenge(res);
        else {
          res.setHeader("WWW-Authenticate", "Bearer");
          json(401, { error: "unauthorized" });
        }
        return;
      }
      await clientContext.run(identity!, () => handler(req, res));
    } catch {
      console.error("[bridge] request failed");
      if (!res.headersSent) json(500, { error: "internal_error" });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return {
    server,
    oauth,
    async close() {
      await mcp.close();
      oauth?.close();
      changes.close();
    },
  };
}
