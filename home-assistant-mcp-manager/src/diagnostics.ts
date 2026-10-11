import { HomeAssistantClient } from "./home-assistant.js";
import type { Json } from "./change-spec.js";

export function redact(value: unknown, secrets: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /token|password|secret|authorization|api.?key|cookie/i.test(k)
          ? "[redacted]"
          : redact(v, secrets),
      ]),
    );
  if (typeof value !== "string") return value;
  let out = value;
  for (const secret of secrets)
    if (secret) out = out.split(secret).join("[redacted]");
  return out
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(
      /((?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, "https://[redacted]@")
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[redacted]",
    );
}
export function references(value: unknown): {
  entities: string[];
  services: string[];
  templates: boolean;
} {
  const entities = new Set<string>(),
    services = new Set<string>();
  let templates = false;
  function visit(v: unknown, key = "") {
    if (typeof v === "string") {
      if (v.includes("{{") || v.includes("{%")) templates = true;
      if (
        ["service", "action"].includes(key) &&
        /^[a-z_]+\.[a-z0-9_]+$/.test(v)
      )
        services.add(v);
      else if (["entity_id", "entity", "entities"].includes(key))
        for (const id of v.split(/[,\s]+/))
          if (/^[a-z_]+\.[a-z0-9_]+$/.test(id)) entities.add(id);
    } else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (key === "entities" && /^[a-z_]+\.[a-z0-9_]+$/.test(k))
          entities.add(k);
        visit(x, k);
      }
  }
  visit(value);
  return { entities: [...entities], services: [...services], templates };
}
export async function validateReferences(
  ha: HomeAssistantClient,
  data: unknown,
) {
  const refs = references(data);
  const [states, registry, services] = await Promise.all([
    ha.getStates(),
    ha.listEntityRegistry(),
    ha.request<Json[]>("/services"),
  ]);
  const known = new Set([...states, ...registry].map((s) => s.entity_id));
  const knownServices = new Set(
    services.flatMap((d) =>
      Object.keys(d.services).map((s) => `${d.domain}.${s}`),
    ),
  );
  return {
    missing_entities: refs.entities.filter((id) => !known.has(id)),
    missing_services: refs.services.filter((id) => !knownServices.has(id)),
    templates_unchecked: refs.templates,
  };
}
export async function scanConfigurations(ha: HomeAssistantClient) {
  const entries: { target: string; config: unknown }[] = [],
    skipped: { target: string; reason: string }[] = [];
  const states = await ha.getStates();
  for (const state of states.filter((s) =>
    /^(automation|script)\./.test(s.entity_id),
  )) {
    const kind = state.entity_id.split(".")[0],
      id = kind === "script" ? state.entity_id.slice(7) : state.attributes.id;
    try {
      if (typeof id !== "string")
        throw new Error("No editable configuration id");
      entries.push({
        target: state.entity_id,
        config: await ha.request(
          `/config/${kind}/config/${encodeURIComponent(id)}`,
        ),
      });
    } catch {
      skipped.push({
        target: state.entity_id,
        reason: "Configuration unavailable or not UI-managed",
      });
    }
  }
  const dashboards = (await ha.listDashboards()) as Json[];
  for (const id of [undefined, ...dashboards.map((d) => String(d.url_path))]) {
    try {
      entries.push({
        target: `dashboard:${id ?? "default"}`,
        config: await ha.getDashboard(id),
      });
    } catch {
      skipped.push({
        target: `dashboard:${id ?? "default"}`,
        reason: "Dashboard unavailable or not storage-managed",
      });
    }
  }
  return {
    entries,
    skipped,
    scope:
      "UI-managed automations, scripts and readable dashboards; templates and external YAML may contain additional references",
  };
}
