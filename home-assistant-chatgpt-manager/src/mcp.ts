import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type {
  HomeAssistantState,
  RegistryArea,
  RegistryDevice,
  RegistryEntity,
} from "./home-assistant.js";
import { HomeAssistantClient } from "./home-assistant.js";

type JsonObject = Record<string, unknown>;

const automationConfigSchema = z
  .object({
    alias: z.string().min(1),
    description: z.string().optional(),
    triggers: z.unknown(),
    conditions: z.unknown(),
    actions: z.unknown(),
  })
  .catchall(z.unknown());

const scriptConfigSchema = z
  .object({
    alias: z.string().optional(),
    sequence: z.unknown(),
  })
  .catchall(z.unknown());

function result(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text:
          error instanceof Error
            ? error.message
            : `Unknown error: ${String(error)}`,
      },
    ],
  };
}

function requireWriteAccess(writeAccess: boolean): void {
  if (!writeAccess) {
    throw new Error(
      "Write access is disabled in the Home Assistant app configuration.",
    );
  }
}

function scriptObjectId(value: string): string {
  return value.startsWith("script.") ? value.slice("script.".length) : value;
}

async function resolveAutomationId(
  client: HomeAssistantClient,
  value: string,
): Promise<string> {
  if (!value.startsWith("automation.")) return value;

  const state = await client.getState(value);
  const id = state.attributes.id;

  if (typeof id !== "string" || id.length === 0) {
    throw new Error(
      `Automation ${value} does not expose a configuration id. It may not be UI-managed.`,
    );
  }

  return id;
}

function areaForEntity(
  registryEntity: RegistryEntity | undefined,
  devices: Map<string, RegistryDevice>,
): string | null {
  if (!registryEntity) return null;
  if (registryEntity.area_id) return registryEntity.area_id;
  if (registryEntity.device_id) {
    return devices.get(registryEntity.device_id)?.area_id ?? null;
  }
  return null;
}

export function buildMcpServer(
  client: HomeAssistantClient,
  writeAccess: boolean,
): McpServer {
  const server = new McpServer({
    name: "home-assistant-chatgpt-manager",
    version: "0.1.0",
  });

  server.registerTool(
    "get_home_overview",
    {
      description:
        "Get a compact overview of this Home Assistant installation before making configuration decisions.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const [config, areas, devices, registry, states, dashboards] =
          await Promise.all([
            client.getConfig(),
            client.listAreas(),
            client.listDevices(),
            client.listEntityRegistry(),
            client.getStates(),
            client.listDashboards(),
          ]);

        const domains: Record<string, number> = {};
        for (const state of states) {
          const domain = state.entity_id.split(".", 1)[0] ?? "unknown";
          domains[domain] = (domains[domain] ?? 0) + 1;
        }

        return result({
          home_assistant: {
            version: config.version,
            location_name: config.location_name,
            time_zone: config.time_zone,
          },
          counts: {
            areas: areas.length,
            devices: devices.length,
            entity_registry_entries: registry.length,
            states: states.length,
            automations: states.filter((item) =>
              item.entity_id.startsWith("automation."),
            ).length,
            scripts: states.filter((item) =>
              item.entity_id.startsWith("script."),
            ).length,
            dashboards: dashboards.length,
          },
          domains,
          write_access: writeAccess,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_areas",
    {
      description: "List Home Assistant areas.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return result(await client.listAreas());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_devices",
    {
      description:
        "List registered Home Assistant devices, optionally filtered by area.",
      inputSchema: z.object({
        area_id: z.string().optional(),
        search: z.string().optional(),
      }),
    },
    async ({ area_id, search }) => {
      try {
        const [devices, areas] = await Promise.all([
          client.listDevices(),
          client.listAreas(),
        ]);
        const areaNames = new Map(areas.map((area) => [area.area_id, area.name]));
        const needle = search?.toLowerCase();

        return result(
          devices
            .filter((device) => !area_id || device.area_id === area_id)
            .filter((device) => {
              if (!needle) return true;
              return [
                device.name,
                device.name_by_user,
                device.manufacturer,
                device.model,
                device.id,
              ]
                .filter((value): value is string => typeof value === "string")
                .some((value) => value.toLowerCase().includes(needle));
            })
            .map((device) => ({
              id: device.id,
              name: device.name_by_user ?? device.name,
              manufacturer: device.manufacturer,
              model: device.model,
              area_id: device.area_id ?? null,
              area_name: device.area_id
                ? areaNames.get(device.area_id) ?? null
                : null,
              disabled_by: device.disabled_by ?? null,
            })),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_entities",
    {
      description:
        "List Home Assistant entities using real registry/state data. Use filters instead of requesting every entity when possible.",
      inputSchema: z.object({
        domain: z.string().optional(),
        area_id: z.string().optional(),
        search: z.string().optional(),
        include_attributes: z.boolean().default(false),
        limit: z.number().int().min(1).max(500).default(100),
      }),
    },
    async ({ domain, area_id, search, include_attributes, limit }) => {
      try {
        const [states, registry, devices, areas] = await Promise.all([
          client.getStates(),
          client.listEntityRegistry(),
          client.listDevices(),
          client.listAreas(),
        ]);

        const registryByEntity = new Map(
          registry.map((entry) => [entry.entity_id, entry]),
        );
        const devicesById = new Map(devices.map((device) => [device.id, device]));
        const areaNames = new Map(areas.map((area) => [area.area_id, area.name]));
        const needle = search?.toLowerCase();

        const matches = states
          .filter((state) => {
            if (domain && !state.entity_id.startsWith(`${domain}.`)) {
              return false;
            }

            const registryEntity = registryByEntity.get(state.entity_id);
            const resolvedArea = areaForEntity(registryEntity, devicesById);
            if (area_id && resolvedArea !== area_id) return false;

            if (needle) {
              const friendlyName =
                typeof state.attributes.friendly_name === "string"
                  ? state.attributes.friendly_name
                  : "";
              if (
                !state.entity_id.toLowerCase().includes(needle) &&
                !friendlyName.toLowerCase().includes(needle)
              ) {
                return false;
              }
            }

            return true;
          })
          .slice(0, limit)
          .map((state) => {
            const registryEntity = registryByEntity.get(state.entity_id);
            const resolvedArea = areaForEntity(registryEntity, devicesById);

            return {
              entity_id: state.entity_id,
              state: state.state,
              friendly_name: state.attributes.friendly_name ?? null,
              domain: state.entity_id.split(".", 1)[0],
              area_id: resolvedArea,
              area_name: resolvedArea
                ? areaNames.get(resolvedArea) ?? null
                : null,
              device_id: registryEntity?.device_id ?? null,
              disabled_by: registryEntity?.disabled_by ?? null,
              last_changed: state.last_changed,
              ...(include_attributes ? { attributes: state.attributes } : {}),
            };
          });

        return result({
          count: matches.length,
          entities: matches,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_entity",
    {
      description:
        "Get the current state, attributes, registry metadata, device, and area for one entity.",
      inputSchema: z.object({
        entity_id: z.string().min(3),
      }),
    },
    async ({ entity_id }) => {
      try {
        const [state, registry, devices, areas] = await Promise.all([
          client.getState(entity_id),
          client.listEntityRegistry(),
          client.listDevices(),
          client.listAreas(),
        ]);

        const registryEntity = registry.find(
          (entry) => entry.entity_id === entity_id,
        );
        const device = registryEntity?.device_id
          ? devices.find((entry) => entry.id === registryEntity.device_id)
          : undefined;
        const resolvedArea =
          registryEntity?.area_id ?? device?.area_id ?? null;
        const area = resolvedArea
          ? areas.find((entry) => entry.area_id === resolvedArea)
          : undefined;

        return result({
          state,
          registry: registryEntity ?? null,
          device: device ?? null,
          area: area ?? null,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_automations",
    {
      description:
        "List automation entities and their configuration ids. Use get_automation before editing an existing automation.",
      inputSchema: z.object({
        search: z.string().optional(),
      }),
    },
    async ({ search }) => {
      try {
        const needle = search?.toLowerCase();
        const states = await client.getStates();

        return result(
          states
            .filter((state) => state.entity_id.startsWith("automation."))
            .filter((state) => {
              if (!needle) return true;
              const name =
                typeof state.attributes.friendly_name === "string"
                  ? state.attributes.friendly_name
                  : "";
              return (
                state.entity_id.toLowerCase().includes(needle) ||
                name.toLowerCase().includes(needle)
              );
            })
            .map((state) => ({
              entity_id: state.entity_id,
              id: state.attributes.id ?? null,
              name: state.attributes.friendly_name ?? null,
              state: state.state,
              last_triggered: state.attributes.last_triggered ?? null,
              mode: state.attributes.mode ?? null,
            })),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_automation",
    {
      description:
        "Read the full Home Assistant automation configuration. Accepts either the automation configuration id or an automation.* entity id.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
    },
    async ({ id }) => {
      try {
        const resolvedId = await resolveAutomationId(client, id);
        return result({
          id: resolvedId,
          config: await client.getAutomation(resolvedId),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "create_automation",
    {
      description:
        "Create a UI-managed Home Assistant automation. Inspect entities and existing automations first. Home Assistant validates the submitted configuration.",
      inputSchema: z.object({
        id: z.string().min(1).optional(),
        config: automationConfigSchema,
      }),
    },
    async ({ id, config }) => {
      try {
        requireWriteAccess(writeAccess);
        const newId = id ?? randomUUID();
        await client.saveAutomation(newId, config as JsonObject);
        return result({
          id: newId,
          config: await client.getAutomation(newId),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "update_automation",
    {
      description:
        "Replace one UI-managed automation configuration. Read the existing automation first and preserve unrelated fields.",
      inputSchema: z.object({
        id: z.string().min(1),
        config: automationConfigSchema,
      }),
    },
    async ({ id, config }) => {
      try {
        requireWriteAccess(writeAccess);
        const resolvedId = await resolveAutomationId(client, id);
        await client.saveAutomation(resolvedId, config as JsonObject);
        return result({
          id: resolvedId,
          config: await client.getAutomation(resolvedId),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_scripts",
    {
      description:
        "List Home Assistant script entities. Use get_script before editing an existing script.",
      inputSchema: z.object({
        search: z.string().optional(),
      }),
    },
    async ({ search }) => {
      try {
        const needle = search?.toLowerCase();
        const states = await client.getStates();

        return result(
          states
            .filter((state) => state.entity_id.startsWith("script."))
            .filter((state) => {
              if (!needle) return true;
              const name =
                typeof state.attributes.friendly_name === "string"
                  ? state.attributes.friendly_name
                  : "";
              return (
                state.entity_id.toLowerCase().includes(needle) ||
                name.toLowerCase().includes(needle)
              );
            })
            .map((state) => ({
              entity_id: state.entity_id,
              object_id: scriptObjectId(state.entity_id),
              name: state.attributes.friendly_name ?? null,
              state: state.state,
              last_triggered: state.attributes.last_triggered ?? null,
              mode: state.attributes.mode ?? null,
            })),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_script",
    {
      description:
        "Read the full Home Assistant script configuration. Accepts either a script object id or script.* entity id.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
    },
    async ({ id }) => {
      try {
        const objectId = scriptObjectId(id);
        return result({
          id: objectId,
          config: await client.getScript(objectId),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "create_script",
    {
      description:
        "Create a UI-managed Home Assistant script. Inspect existing scripts and target entities first.",
      inputSchema: z.object({
        object_id: z
          .string()
          .regex(/^[a-z0-9_]+$/)
          .describe("Home Assistant script object id, without the script. prefix."),
        config: scriptConfigSchema,
      }),
    },
    async ({ object_id, config }) => {
      try {
        requireWriteAccess(writeAccess);
        await client.saveScript(object_id, config as JsonObject);
        return result({
          id: object_id,
          config: await client.getScript(object_id),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "update_script",
    {
      description:
        "Replace one UI-managed Home Assistant script configuration. Read the existing script first and preserve unrelated fields.",
      inputSchema: z.object({
        id: z.string().min(1),
        config: scriptConfigSchema,
      }),
    },
    async ({ id, config }) => {
      try {
        requireWriteAccess(writeAccess);
        const objectId = scriptObjectId(id);
        await client.saveScript(objectId, config as JsonObject);
        return result({
          id: objectId,
          config: await client.getScript(objectId),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_dashboards",
    {
      description:
        "List Home Assistant Lovelace dashboards. The default dashboard may be represented separately from custom dashboard entries.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return result(await client.listDashboards());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "create_dashboard",
    {
      description:
        "Create a new storage-mode Home Assistant Lovelace dashboard and optionally write its initial configuration.",
      inputSchema: z.object({
        url_path: z
          .string()
          .regex(/^[a-z0-9][a-z0-9_-]*$/)
          .describe("Dashboard URL path, for example downstairs."),
        title: z.string().min(1),
        icon: z.string().optional(),
        show_in_sidebar: z.boolean().default(true),
        require_admin: z.boolean().default(false),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    async ({
      url_path,
      title,
      icon,
      show_in_sidebar,
      require_admin,
      config,
    }) => {
      try {
        requireWriteAccess(writeAccess);
        await client.createDashboard({
          url_path,
          title,
          ...(icon ? { icon } : {}),
          show_in_sidebar,
          require_admin,
        });

        if (config) {
          await client.saveDashboard(config, url_path);
        }

        return result({
          url_path,
          dashboard: await client.getDashboard(url_path),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_dashboard",
    {
      description:
        "Read the complete storage-mode Lovelace dashboard configuration. Omit url_path for the default dashboard.",
      inputSchema: z.object({
        url_path: z.string().optional(),
      }),
    },
    async ({ url_path }) => {
      try {
        return result({
          url_path: url_path ?? null,
          config: await client.getDashboard(url_path),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "save_dashboard",
    {
      description:
        "Replace the complete configuration of a storage-mode Lovelace dashboard. Always read the dashboard first and preserve views/cards that should remain.",
      inputSchema: z.object({
        url_path: z.string().optional(),
        config: z.record(z.string(), z.unknown()),
      }),
    },
    async ({ url_path, config }) => {
      try {
        requireWriteAccess(writeAccess);
        await client.saveDashboard(config, url_path);
        return result({
          url_path: url_path ?? null,
          config: await client.getDashboard(url_path),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "validate_config",
    {
      description:
        "Run Home Assistant's configuration validation and return the result.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return result(await client.validateConfig());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
