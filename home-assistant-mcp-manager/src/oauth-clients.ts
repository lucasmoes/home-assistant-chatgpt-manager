import type { ClientMetadata } from "oidc-provider";

export const CLIENT_ID = "home-assistant-manager";
export const CLAUDE_CLIENT_ID = "home-assistant-manager-claude";
export const CLAUDE_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

export function chatGptRedirect(value: string): boolean {
  try {
    const u = new URL(value);
    return u.origin === "https://chatgpt.com" && !u.username && !u.password && !u.search && !u.hash &&
      (u.pathname === "/connector_platform_oauth_redirect" || /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname));
  } catch { return false; }
}
export function chatGptMetadata(value: string): boolean {
  try {
    const u = new URL(value);
    return u.origin === "https://chatgpt.com" && !u.username && !u.password && !u.search && !u.hash &&
      (u.pathname === "/oauth/client.json" || /^\/oauth\/[A-Za-z0-9_-]+\/client\.json$/.test(u.pathname));
  } catch { return false; }
}

/** Compatibility presets are isolated from the provider-neutral OAuth server. */
export function builtinClients(chatGptCallback: string): ClientMetadata[] {
  return [
    { client_id: CLIENT_ID, client_name: "ChatGPT", redirect_uris: [chatGptCallback] },
    { client_id: CLAUDE_CLIENT_ID, client_name: "Claude", redirect_uris: [CLAUDE_REDIRECT_URI] },
  ].map(client => ({ ...client, grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"], token_endpoint_auth_method: "none" }));
}

export function validRedirect(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\*#]/.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !!url.hostname &&
      (url.protocol === "https:" || (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { return false; }
}

export function parseClients(value: string): ClientMetadata[] {
  const clients: unknown = JSON.parse(value);
  if (!Array.isArray(clients) || clients.length > 32) throw new Error("OAUTH_CLIENTS must be an array of at most 32 public clients");
  const ids = new Set([CLIENT_ID, CLAUDE_CLIENT_ID]);
  return clients.map(client => {
    if (!client || typeof client !== "object" || Array.isArray(client) ||
        Object.keys(client).some(k => !["client_id", "client_name", "redirect_uris"].includes(k)) ||
        typeof client.client_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(client.client_id) ||
        ids.has(client.client_id) || typeof client.client_name !== "string" ||
        !client.client_name.trim() || client.client_name.length > 128 ||
        !Array.isArray(client.redirect_uris) || !client.redirect_uris.length || client.redirect_uris.length > 10 ||
        !client.redirect_uris.every(validRedirect)) {
      throw new Error("Invalid OAUTH_CLIENTS entry: unique client_id, client_name and exact HTTPS/loopback redirect_uris required");
    }
    ids.add(client.client_id);
    return { client_id: client.client_id, client_name: client.client_name,
      redirect_uris: client.redirect_uris, grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none" };
  });
}
