import { HomeAssistantClient, HomeAssistantError } from "./home-assistant.js";
import {
  canonical,
  writable,
  type ChangeSpec,
  type Json,
} from "./change-spec.js";

export class ChangeTargets {
  constructor(readonly ha: HomeAssistantClient) {}
  async list(kind: string, domain?: string): Promise<Json[]> {
    if (["area", "floor", "device", "entity", "label"].includes(kind))
      return this.ha.websocketCommand({ type: `config/${kind}_registry/list` });
    if (kind === "helper" || kind === "zone")
      return this.ha.websocketCommand({
        type: `${kind === "zone" ? "zone" : domain}/list`,
      });
    throw new Error("Unsupported collection.");
  }
  async read(s: ChangeSpec): Promise<any> {
    if (["automation", "script", "scene"].includes(s.kind)) {
      try {
        const value = await this.ha.request<Json>(
          `/config/${s.kind}/config/${encodeURIComponent(s.id!)}`,
        );
        if (s.action === "create")
          throw new Error("Target already exists; use an update.");
        return value;
      } catch (e) {
        if (
          e instanceof HomeAssistantError &&
          e.code === 404 &&
          s.action === "create"
        )
          return null;
        throw e;
      }
    }
    if (s.kind === "dashboard") return this.ha.getDashboard(s.id);
    if (s.kind === "dashboard_create") {
      const all = (await this.ha.listDashboards()) as Json[];
      if (all.some((d) => d.url_path === s.data.url_path))
        throw new Error("Dashboard already exists.");
      return null;
    }
    if (s.kind === "blueprint") {
      const all = await this.ha.websocketCommand<Json>({
        type: "blueprint/list",
        domain: "automation",
      });
      if (all[String(s.data.path)])
        throw new Error(
          "Blueprint already exists; overwriting is not supported.",
        );
      return null;
    }
    if (s.kind === "automation_enabled") {
      const state = (await this.ha.getState(s.id!)).state;
      if (!["on", "off"].includes(state))
        throw new Error("Automation is not available.");
      return { enabled: state === "on" };
    }
    const all = await this.list(s.kind, s.domain);
    const key =
      s.kind === "device" || s.kind === "helper" || s.kind === "zone"
        ? "id"
        : `${s.kind}_id`;
    if (s.action === "create") {
      if (all.some((v) => v.name === s.data.name))
        throw new Error("An item with this name already exists.");
      return null;
    }
    const item = all.find((v) => v[key] === s.id);
    if (!item)
      throw new Error(
        "Target was not found in the editable registry/storage collection.",
      );
    return item;
  }
  desired(s: ChangeSpec, before: any): any {
    return [
      "area",
      "floor",
      "device",
      "entity",
      "label",
      "helper",
      "zone",
    ].includes(s.kind) && s.action === "update"
      ? { ...before, ...s.data }
      : s.data;
  }
  async write(s: ChangeSpec): Promise<any> {
    if (["automation", "script", "scene"].includes(s.kind))
      return this.ha.request(
        `/config/${s.kind}/config/${encodeURIComponent(s.id!)}`,
        { method: "POST", body: JSON.stringify(s.data) },
      );
    if (s.kind === "dashboard") return this.ha.saveDashboard(s.data, s.id);
    if (s.kind === "dashboard_create") {
      const { config, ...metadata } = s.data;
      const created = await this.ha.createDashboard(metadata as any);
      if (config)
        await this.ha.saveDashboard(config as Json, String(metadata.url_path));
      return created;
    }
    if (s.kind === "blueprint")
      return this.ha.websocketCommand({
        type: "blueprint/save",
        ...s.data,
        allow_override: false,
      });
    if (s.kind === "automation_enabled")
      return this.ha.request(
        `/services/automation/${s.data.enabled ? "turn_on" : "turn_off"}`,
        {
          method: "POST",
          body: JSON.stringify({
            entity_id: s.id,
            ...(!s.data.enabled ? { stop_actions: false } : {}),
          }),
        },
      );
    const prefix = ["area", "floor", "device", "entity", "label"].includes(
      s.kind,
    )
      ? `config/${s.kind}_registry`
      : s.kind === "helper"
        ? s.domain!
        : "zone";
    const key = s.kind === "helper" ? `${s.domain}_id` : `${s.kind}_id`;
    return this.ha.websocketCommand({
      type: `${prefix}/${s.action}`,
      ...(s.action === "update" ? { [key]: s.id } : {}),
      ...s.data,
    });
  }
  async verify(
    s: ChangeSpec,
    response: any,
  ): Promise<{ verified: boolean; snapshot: any; target: ChangeSpec }> {
    let target = { ...s, action: "update" as const };
    if (s.kind === "blueprint")
      return {
        verified: !!(
          await this.ha.websocketCommand<Json>({
            type: "blueprint/list",
            domain: "automation",
          })
        )[String(s.data.path)],
        snapshot: s.data,
        target: s,
      };
    if (s.kind === "dashboard_create")
      target = {
        kind: "dashboard",
        action: "update",
        id: String(s.data.url_path),
        data: (s.data.config ?? { views: [] }) as Json,
      };
    else if (
      s.action === "create" &&
      !["automation", "script", "scene"].includes(s.kind)
    )
      target.id =
        response?.[
          s.kind === "helper" || s.kind === "zone" ? "id" : `${s.kind}_id`
        ];
    if (s.kind === "entity" && s.data.new_entity_id)
      target.id = String(s.data.new_entity_id);
    if (target.kind !== "dashboard" && !target.id)
      throw new Error("Home Assistant returned no created target id.");
    const snapshot = await this.read(target);
    const expected = { ...target.data };
    if (s.kind === "entity" && expected.new_entity_id) {
      expected.entity_id = expected.new_entity_id;
      delete expected.new_entity_id;
    }
    const verified = Object.entries(expected).every(
      ([k, v]) => canonical(snapshot[k]) === canonical(v),
    );
    return { verified, snapshot, target };
  }
  restore(s: ChangeSpec, snapshot: Json): ChangeSpec {
    if (["blueprint", "dashboard_create"].includes(s.kind))
      throw new Error("This operation does not support restoration.");
    if (s.kind === "entity" && s.data.new_entity_id)
      return {
        ...s,
        action: "update",
        id: String(s.data.new_entity_id),
        data: {
          ...writable(s.kind, snapshot),
          new_entity_id: snapshot.entity_id,
        },
      };
    return {
      ...s,
      action: "update",
      data: writable(s.kind, snapshot, s.domain),
    };
  }
}
