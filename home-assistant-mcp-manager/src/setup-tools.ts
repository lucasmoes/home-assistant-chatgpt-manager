import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { changeSchema, helperDomains, type Json } from "./change-spec.js";
import type { ChangeManager } from "./changes.js";
import {
  redact,
  references,
  scanConfigurations,
  validateReferences,
} from "./diagnostics.js";

export function registerSetupTools(server: McpServer, manager: ChangeManager) {
  const ha = manager.targets.ha;
  const str = z.string().min(1),
    obj = z.record(z.string(), z.unknown()),
    domain = z.enum(helperDomains);
  const paging = {
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().nonnegative().default(0),
  };
  const tool = (
    name: string,
    description: string,
    shape: z.ZodRawShape,
    fn: (args: any) => Promise<unknown> | unknown,
  ) =>
    server.registerTool(
      name,
      { description, inputSchema: z.object(shape) },
      async (args) => {
        try {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(await fn(args), null, 2),
              },
            ],
          };
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: (e as Error).message }],
          };
        }
      },
    );
  const proposal =
    "Prepare a change for owner review; does not write to Home Assistant. After approval, use apply_approved_change. ";
  tool(
    "preview_configuration_change",
    proposal +
      "Supported typed targets only; updates replace configuration documents or patch registry fields.",
    { change: changeSchema },
    (a) => manager.propose(a.change),
  );
  tool(
    "validate_configuration_change",
    "Recheck a saved proposal's structure, literal references and staleness. Does not apply.",
    { change_id: str },
    (a) => manager.validateChange(a.change_id),
  );
  tool(
    "apply_approved_change",
    "Apply an unexpired owner-approved proposal once, only from its original authenticated client. Rejects changed originals.",
    { change_id: str },
    (a) => manager.apply(a.change_id),
  );
  tool(
    "list_configuration_versions",
    "List manager-created snapshots, newest first. These are not full Home Assistant backups.",
    paging,
    (a) => manager.versions(a.limit, a.offset),
  );
  tool(
    "preview_configuration_restore",
    proposal +
      "Restore a saved configuration snapshot; creation/deletion rollback is not supported.",
    { version_id: str },
    (a) => manager.restore(a.version_id),
  );
  tool(
    "get_change_history",
    "Read the persistent audit trail, including authenticated client, owner approval and apply outcome.",
    paging,
    (a) => manager.history(a.limit, a.offset),
  );
  tool(
    "get_automation_traces",
    "List stored automation traces, or read one run. Trace retention depends on Home Assistant.",
    { id: str, run_id: str.optional() },
    async (a) => {
      const id = a.id.startsWith("automation.")
        ? (await ha.getState(a.id)).attributes.id
        : a.id;
      if (typeof id !== "string")
        throw new Error("Automation has no configuration id.");
      return ha.websocketCommand({
        type: a.run_id ? "trace/get" : "trace/list",
        domain: "automation",
        item_id: id,
        ...(a.run_id ? { run_id: a.run_id } : {}),
      });
    },
  );
  tool(
    "get_entity_history",
    "Read recorder history for specified entities in a window of at most 7 days; no recorder data is changed.",
    {
      entity_ids: z.array(str).min(1).max(20),
      start_time: z.iso.datetime({ offset: true }),
      end_time: z.iso.datetime({ offset: true }),
    },
    (a) => {
      const start = Date.parse(a.start_time),
        end = Date.parse(a.end_time);
      if (end <= start || end - start > 7 * 86400000)
        throw new Error("History window must be positive and at most 7 days.");
      const query = new URLSearchParams({
        filter_entity_id: a.entity_ids.join(","),
        end_time: a.end_time,
        minimal_response: "",
        no_attributes: "",
      });
      return ha.request(
        `/history/period/${encodeURIComponent(a.start_time)}?${query}`,
      );
    },
  );
  tool(
    "get_system_health",
    "Read a basic health summary: HA version, loaded components and unavailable/unknown entities. Does not restart or repair HA.",
    {},
    async () => {
      const [config, states] = await Promise.all([
        ha.getConfig(),
        ha.getStates(),
      ]);
      return {
        version: config.version,
        state: config.state,
        components: config.components,
        entity_count: states.length,
        unavailable: states
          .filter((s) => s.state === "unavailable" || s.state === "unknown")
          .map((s) => ({ entity_id: s.entity_id, state: s.state })),
        scope:
          "Core configuration and entity availability; not full integration diagnostics or Supervisor health",
      };
    },
  );
  tool(
    "get_error_logs",
    "Read recent system_log records with optional text filter and best-effort secret scrubbing. Free-form logs can still contain personal data.",
    {
      search: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async (a) => {
      const records = await ha.websocketCommand<Json[]>({
        type: "system_log/list",
      });
      const clean = redact(records, [
        manager.config.apiKey,
        manager.config.approvalPassword ?? "",
        manager.config.homeAssistantToken,
      ]) as Json[];
      return clean
        .filter(
          (r) =>
            !a.search ||
            JSON.stringify(r).toLowerCase().includes(a.search.toLowerCase()),
        )
        .slice(-a.limit);
    },
  );
  tool(
    "find_entity_references",
    "Find literal references in readable automations, scripts and dashboards; reports skipped configurations and limited template coverage.",
    { entity_id: str },
    async (a) => {
      const scan = await scanConfigurations(ha);
      return {
        matches: scan.entries.filter((e) =>
          references(e.config).entities.includes(a.entity_id),
        ),
        skipped: scan.skipped,
        scope: scan.scope,
      };
    },
  );
  tool(
    "check_configuration_references",
    "Check literal entity/service references in readable automations, scripts and dashboards; no writes.",
    {},
    async () => {
      const scan = await scanConfigurations(ha);
      const checks = [];
      for (const e of scan.entries)
        checks.push({
          target: e.target,
          ...(await validateReferences(ha, e.config)),
        });
      return { checks, skipped: scan.skipped, scope: scan.scope };
    },
  );
  tool(
    "list_helpers",
    "List editable storage helpers for one supported domain. YAML helpers and other helper types are excluded.",
    { domain },
    (a) => manager.targets.list("helper", a.domain),
  );
  tool(
    "get_helper",
    "Read one editable storage helper by its storage id, without a domain prefix.",
    { domain, id: str },
    (a) =>
      manager.targets.read({
        kind: "helper",
        action: "update",
        domain: a.domain,
        id: a.id,
        data: {},
      }),
  );
  for (const name of [
    "propose_helper_change",
    "create_helper",
    "update_helper",
  ])
    tool(
      name,
      proposal +
        "Supported storage helper domains only; Home Assistant validates domain-specific fields on save.",
      { domain, id: str.optional(), config: obj },
      (a) => {
        const action =
          name === "create_helper"
            ? "create"
            : name === "update_helper"
              ? "update"
              : a.id
                ? "update"
                : "create";
        if (action === "create" && a.id)
          throw new Error("Home Assistant assigns new helper ids; omit id.");
        return manager.propose({
          kind: "helper",
          action,
          domain: a.domain,
          id: a.id,
          data: a.config,
        });
      },
    );
  tool(
    "list_scenes",
    "List scene entities. Use the configuration id for editable UI-managed scenes.",
    {},
    async () => {
      const [states, registry] = await Promise.all([
        ha.getStates(),
        ha.listEntityRegistry(),
      ]);
      return states
        .filter((s) => s.entity_id.startsWith("scene."))
        .map((s) => ({
          ...s,
          configuration_id:
            registry.find((e) => e.entity_id === s.entity_id)?.unique_id ??
            null,
        }));
    },
  );
  tool(
    "get_scene",
    "Read a UI-managed scene by configuration id.",
    { id: str },
    (a) =>
      manager.targets.read({
        kind: "scene",
        action: "update",
        id: a.id,
        data: {},
      }),
  );
  for (const name of ["propose_scene_change", "create_scene", "update_scene"])
    tool(
      name,
      proposal +
        "Create or replace a UI-managed scene. Provide a configuration id, name and entities.",
      {
        id: str,
        config: obj,
        ...(name === "propose_scene_change"
          ? { action: z.enum(["create", "update"]) }
          : {}),
      },
      (a) =>
        manager.propose({
          kind: "scene",
          action: a.action ?? (name === "create_scene" ? "create" : "update"),
          id: a.id,
          data: a.config,
        }),
    );
  tool("list_floors", "List floor registry entries.", {}, () =>
    manager.targets.list("floor"),
  );
  tool("list_labels", "List label registry entries.", {}, () =>
    manager.targets.list("label"),
  );
  tool(
    "list_zones",
    "List editable storage zones, excluding YAML and the home zone.",
    {},
    () => manager.targets.list("zone"),
  );
  for (const kind of ["area", "floor", "label", "zone"] as const) {
    tool(
      `create_${kind}`,
      proposal +
        `Create a ${kind}; name is required. Zones also require latitude and longitude.`,
      { config: obj },
      (a) => manager.propose({ kind, action: "create", data: a.config }),
    );
    if (kind === "area" || kind === "zone")
      tool(
        `update_${kind}`,
        proposal + `Patch editable ${kind} fields.`,
        { id: str, config: obj },
        (a) =>
          manager.propose({ kind, action: "update", id: a.id, data: a.config }),
      );
  }
  tool(
    "assign_area_to_floor",
    proposal + "Set or clear an area's floor.",
    { area_id: str, floor_id: str.nullable() },
    (a) =>
      manager.propose({
        kind: "area",
        action: "update",
        id: a.area_id,
        data: { floor_id: a.floor_id },
      }),
  );
  tool(
    "assign_device_to_area",
    proposal + "Set or clear a device's area.",
    { device_id: str, area_id: str.nullable() },
    (a) =>
      manager.propose({
        kind: "device",
        action: "update",
        id: a.device_id,
        data: { area_id: a.area_id },
      }),
  );
  tool(
    "rename_device",
    proposal + "Change or clear a device's user-visible name.",
    { device_id: str, name: str.nullable() },
    (a) =>
      manager.propose({
        kind: "device",
        action: "update",
        id: a.device_id,
        data: { name_by_user: a.name },
      }),
  );
  tool(
    "rename_entity",
    proposal +
      "Change the display name and optionally entity id. Renaming an id may leave external/YAML/template references unchanged; inspect references first.",
    {
      entity_id: str,
      name: str.nullable().optional(),
      new_entity_id: str.optional(),
    },
    (a) =>
      manager.propose({
        kind: "entity",
        action: "update",
        id: a.entity_id,
        data: {
          ...(a.name !== undefined ? { name: a.name } : {}),
          ...(a.new_entity_id ? { new_entity_id: a.new_entity_id } : {}),
        },
      }),
  );
  tool(
    "assign_label",
    proposal +
      "Add a label to an area, device or entity while preserving existing labels.",
    {
      target_type: z.enum(["area", "device", "entity"]),
      target_id: str,
      label_id: str,
    },
    async (a) => {
      const spec = {
        kind: a.target_type,
        action: "update" as const,
        id: a.target_id,
        data: {},
      };
      const current = await manager.targets.read(spec);
      return manager.propose(
        {
          ...spec,
          data: {
            labels: [...new Set([...(current.labels ?? []), a.label_id])],
          },
        },
        current,
      );
    },
  );
  tool(
    "set_automation_enabled",
    proposal +
      "Enable or disable an automation. Disabling does not stop an already-running action sequence.",
    { entity_id: str, enabled: z.boolean() },
    (a) =>
      manager.propose({
        kind: "automation_enabled",
        action: "update",
        id: a.entity_id,
        data: { enabled: a.enabled },
      }),
  );
  tool("list_blueprints", "List installed automation blueprints.", {}, () =>
    ha.websocketCommand({ type: "blueprint/list", domain: "automation" }),
  );
  tool(
    "import_blueprint",
    proposal +
      "Fetch an automation blueprint from a supported HTTPS source and freeze its YAML in the proposal. Saving requires owner approval; existing paths are never overwritten.",
    {
      url: z.url(),
      path: z.string().regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.yaml$/),
    },
    async (a) => {
      manager.requireWrites();
      const url = new URL(a.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        ![
          "github.com",
          "raw.githubusercontent.com",
          "community.home-assistant.io",
        ].includes(url.hostname)
      )
        throw new Error(
          "Use an HTTPS GitHub or Home Assistant Community blueprint URL.",
        );
      const imported = await ha.websocketCommand<Json>({
        type: "blueprint/import",
        url: a.url,
      });
      if (imported.blueprint?.metadata?.domain !== "automation")
        throw new Error("Only automation blueprints are supported.");
      if (imported.validation_errors?.length)
        throw new Error(
          "Home Assistant reports invalid blueprint inputs/configuration.",
        );
      return manager.propose({
        kind: "blueprint",
        action: "create",
        data: {
          domain: "automation",
          path: a.path,
          yaml: imported.raw_data,
          source_url: a.url,
        },
      });
    },
  );
  tool(
    "create_automation_from_blueprint",
    proposal +
      "Create an automation using an installed blueprint; validate input substitution before review.",
    { id: str, alias: str, blueprint_path: str, input: obj },
    (a) =>
      manager.propose({
        kind: "automation",
        action: "create",
        id: a.id,
        data: {
          alias: a.alias,
          use_blueprint: { path: a.blueprint_path, input: a.input },
        },
      }),
  );
  const dashboard = { url_path: z.string().optional() },
    location = {
      view_index: z.number().int().nonnegative(),
      section_index: z.number().int().nonnegative().optional(),
    };
  const cards = (config: Json, view: number, section?: number): Json[] => {
    const v = config.views?.[view];
    if (!v) throw new Error("View index not found.");
    if (section === undefined && v.type === "sections")
      throw new Error("Sections views require section_index.");
    const container = section === undefined ? v : v.sections?.[section];
    if (!container) throw new Error("Section index not found.");
    if (!Array.isArray(container.cards)) container.cards = [];
    return container.cards;
  };
  tool(
    "add_dashboard_view",
    proposal + "Append a view to a storage-mode dashboard.",
    { ...dashboard, view: obj },
    async (a) => {
      const config = await ha.getDashboard(a.url_path),
        before = structuredClone(config);
      if (!Array.isArray(config.views))
        throw new Error("Dashboard views are unavailable.");
      config.views.push(a.view);
      return manager.propose(
        { kind: "dashboard", action: "update", id: a.url_path, data: config },
        before,
      );
    },
  );
  tool(
    "add_dashboard_card",
    proposal +
      "Append a card to a classic view or a section, using zero-based indexes.",
    { ...dashboard, ...location, card: obj },
    async (a) => {
      const config = await ha.getDashboard(a.url_path),
        before = structuredClone(config);
      cards(config, a.view_index, a.section_index).push(a.card);
      return manager.propose(
        { kind: "dashboard", action: "update", id: a.url_path, data: config },
        before,
      );
    },
  );
  tool(
    "update_dashboard_card",
    proposal +
      "Replace one card, preserving the rest of the dashboard. Indexes are zero-based.",
    {
      ...dashboard,
      ...location,
      card_index: z.number().int().nonnegative(),
      card: obj,
    },
    async (a) => {
      const config = await ha.getDashboard(a.url_path),
        before = structuredClone(config),
        list = cards(config, a.view_index, a.section_index);
      if (a.card_index >= list.length) throw new Error("Card index not found.");
      list[a.card_index] = a.card;
      return manager.propose(
        { kind: "dashboard", action: "update", id: a.url_path, data: config },
        before,
      );
    },
  );
  tool(
    "move_dashboard_card",
    proposal +
      "Move a card within/between views or sections. Destination index refers to the list after removing the source card.",
    {
      ...dashboard,
      ...location,
      card_index: z.number().int().nonnegative(),
      to_view_index: z.number().int().nonnegative(),
      to_section_index: z.number().int().nonnegative().optional(),
      to_card_index: z.number().int().nonnegative(),
    },
    async (a) => {
      const config = await ha.getDashboard(a.url_path),
        before = structuredClone(config),
        source = cards(config, a.view_index, a.section_index);
      if (a.card_index >= source.length)
        throw new Error("Card index not found.");
      const [card] = source.splice(a.card_index, 1),
        dest = cards(config, a.to_view_index, a.to_section_index);
      if (a.to_card_index > dest.length)
        throw new Error("Destination index is out of range.");
      dest.splice(a.to_card_index, 0, card);
      return manager.propose(
        { kind: "dashboard", action: "update", id: a.url_path, data: config },
        before,
      );
    },
  );
}
