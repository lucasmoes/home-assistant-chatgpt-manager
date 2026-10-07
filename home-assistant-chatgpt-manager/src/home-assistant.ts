import WebSocket from "ws";

export interface HomeAssistantState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_reported?: string;
  last_updated: string;
  context?: Record<string, unknown>;
}

export interface RegistryEntity {
  entity_id: string;
  id?: string;
  device_id?: string | null;
  area_id?: string | null;
  disabled_by?: string | null;
  hidden_by?: string | null;
  name?: string | null;
  original_name?: string | null;
  platform?: string;
  [key: string]: unknown;
}

export interface RegistryDevice {
  id: string;
  area_id?: string | null;
  name?: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  disabled_by?: string | null;
  [key: string]: unknown;
}

export interface RegistryArea {
  area_id: string;
  name: string;
  floor_id?: string | null;
  [key: string]: unknown;
}

type JsonObject = Record<string, unknown>;

export class HomeAssistantClient {
  constructor(
    private readonly baseUrl: string,
    private readonly webSocketUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Home Assistant ${init.method ?? "GET"} ${path} failed (${response.status}): ${text}`,
      );
    }

    if (!text) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  getConfig(): Promise<JsonObject> {
    return this.request<JsonObject>("/config");
  }

  getStates(): Promise<HomeAssistantState[]> {
    return this.request<HomeAssistantState[]>("/states");
  }

  async getState(entityId: string): Promise<HomeAssistantState> {
    return this.request<HomeAssistantState>(
      `/states/${encodeURIComponent(entityId)}`,
    );
  }

  getAutomation(id: string): Promise<JsonObject> {
    return this.request<JsonObject>(
      `/config/automation/config/${encodeURIComponent(id)}`,
    );
  }

  saveAutomation(id: string, config: JsonObject): Promise<JsonObject> {
    return this.request<JsonObject>(
      `/config/automation/config/${encodeURIComponent(id)}`,
      {
        method: "POST",
        body: JSON.stringify(config),
      },
    );
  }

  getScript(objectId: string): Promise<JsonObject> {
    return this.request<JsonObject>(
      `/config/script/config/${encodeURIComponent(objectId)}`,
    );
  }

  saveScript(objectId: string, config: JsonObject): Promise<JsonObject> {
    return this.request<JsonObject>(
      `/config/script/config/${encodeURIComponent(objectId)}`,
      {
        method: "POST",
        body: JSON.stringify(config),
      },
    );
  }

  validateConfig(): Promise<JsonObject> {
    return this.request<JsonObject>("/config/core/check_config", {
      method: "POST",
      body: "{}",
    });
  }

  listAreas(): Promise<RegistryArea[]> {
    return this.websocketCommand<RegistryArea[]>({
      type: "config/area_registry/list",
    });
  }

  listDevices(): Promise<RegistryDevice[]> {
    return this.websocketCommand<RegistryDevice[]>({
      type: "config/device_registry/list",
    });
  }

  listEntityRegistry(): Promise<RegistryEntity[]> {
    return this.websocketCommand<RegistryEntity[]>({
      type: "config/entity_registry/list",
    });
  }

  listDashboards(): Promise<unknown[]> {
    return this.websocketCommand<unknown[]>({
      type: "lovelace/dashboards/list",
    });
  }

  createDashboard(input: {
    url_path: string;
    title: string;
    icon?: string;
    show_in_sidebar: boolean;
    require_admin: boolean;
  }): Promise<unknown> {
    return this.websocketCommand<unknown>({
      type: "lovelace/dashboards/create",
      mode: "storage",
      ...input,
    });
  }

  getDashboard(urlPath?: string): Promise<JsonObject> {
    return this.websocketCommand<JsonObject>({
      type: "lovelace/config",
      ...(urlPath ? { url_path: urlPath } : {}),
    });
  }

  saveDashboard(config: JsonObject, urlPath?: string): Promise<unknown> {
    return this.websocketCommand<unknown>({
      type: "lovelace/config/save",
      config,
      ...(urlPath ? { url_path: urlPath } : {}),
    });
  }

  private websocketCommand<T>(command: JsonObject): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const socket = new WebSocket(this.webSocketUrl);
      const id = 1;
      let settled = false;

      const finish = (error?: Error, result?: T): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.close();

        if (error) reject(error);
        else resolve(result as T);
      };

      const timeout = setTimeout(() => {
        finish(new Error("Home Assistant WebSocket request timed out."));
      }, 15_000);

      socket.on("error", (error) => finish(error));

      socket.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as Record<string, unknown>;

          if (message.type === "auth_required") {
            socket.send(
              JSON.stringify({
                type: "auth",
                access_token: this.token,
              }),
            );
            return;
          }

          if (message.type === "auth_invalid") {
            finish(
              new Error(
                `Home Assistant WebSocket authentication failed: ${String(
                  message.message ?? "unknown error",
                )}`,
              ),
            );
            return;
          }

          if (message.type === "auth_ok") {
            socket.send(JSON.stringify({ id, ...command }));
            return;
          }

          if (message.id === id) {
            if (message.success === true) {
              finish(undefined, message.result as T);
            } else {
              finish(
                new Error(
                  `Home Assistant WebSocket command failed: ${JSON.stringify(
                    message.error ?? message,
                  )}`,
                ),
              );
            }
          }
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error("Invalid WebSocket response from Home Assistant."),
          );
        }
      });
    });
  }
}
