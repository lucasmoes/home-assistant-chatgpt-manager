export interface BridgeConfig {
  port: number;
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

export function loadConfig(): BridgeConfig {
  const token = process.env.HA_TOKEN ?? process.env.SUPERVISOR_TOKEN;

  return {
    port: Number(process.env.PORT ?? "8765"),
    apiKey: required("BRIDGE_API_KEY", process.env.BRIDGE_API_KEY),
    writeAccess: asBoolean(process.env.WRITE_ACCESS, true),
    logLevel: process.env.LOG_LEVEL ?? "info",
    homeAssistantBaseUrl:
      process.env.HA_BASE_URL ?? "http://supervisor/core/api",
    homeAssistantWebSocketUrl:
      process.env.HA_WS_URL ?? "ws://supervisor/core/websocket",
    homeAssistantToken: required("HA_TOKEN or SUPERVISOR_TOKEN", token),
  };
}
