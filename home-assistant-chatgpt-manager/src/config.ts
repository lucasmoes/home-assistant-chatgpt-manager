export interface BridgeConfig {
  port: number;
  publicUrl: string;
  oauthRedirectUri: string;
  oauthDataDir: string;
  allowLegacyApiKey: boolean;
  apiKey: string;
  writeAccess: boolean;
  logLevel: string;
  homeAssistantBaseUrl: string;
  homeAssistantWebSocketUrl: string;
  homeAssistantToken: string;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

export function validatePublicUrl(value: string): string {
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("PUBLIC_URL must be a public HTTPS origin without a path, query or credentials");
  }
  return url.origin;
}

export function loadConfig(): BridgeConfig {
  const token = process.env.HA_TOKEN ?? process.env.SUPERVISOR_TOKEN;

  const publicUrl = validatePublicUrl(process.env.PUBLIC_URL ?? "");
  const apiKey = required("BRIDGE_API_KEY", process.env.BRIDGE_API_KEY);
  if (publicUrl && apiKey.length < 32) throw new Error("OAuth requires an api_key of at least 32 characters");
  const oauthRedirectUri = process.env.OAUTH_REDIRECT_URI || "https://chatgpt.com/connector_platform_oauth_redirect";
  // Exact ChatGPT callbacks only. Never allow arbitrary redirects or wildcard domains.
  const redirect = new URL(oauthRedirectUri);
  if (redirect.origin !== "https://chatgpt.com" || redirect.username || redirect.password || redirect.search || redirect.hash ||
      !(redirect.pathname === "/connector_platform_oauth_redirect" || /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(redirect.pathname))) {
    throw new Error("OAUTH_REDIRECT_URI must be the exact ChatGPT OAuth callback URL");
  }
  return {
    publicUrl,
    oauthRedirectUri,
    oauthDataDir: process.env.OAUTH_DATA_DIR ?? "/data/oauth",
    allowLegacyApiKey: asBoolean(process.env.ALLOW_LEGACY_API_KEY, false),
    port: Number(process.env.PORT ?? "8765"),
    apiKey,
    writeAccess: asBoolean(process.env.WRITE_ACCESS, false),
    logLevel: process.env.LOG_LEVEL ?? "info",
    homeAssistantBaseUrl:
      process.env.HA_BASE_URL ?? "http://supervisor/core/api",
    homeAssistantWebSocketUrl:
      process.env.HA_WS_URL ?? "ws://supervisor/core/websocket",
    homeAssistantToken: required("HA_TOKEN or SUPERVISOR_TOKEN", token),
  };
}
