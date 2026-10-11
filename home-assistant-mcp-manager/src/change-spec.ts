import * as z from "zod/v4";

export const helperDomains = [
  "input_boolean",
  "input_number",
  "input_text",
  "input_select",
  "input_datetime",
  "counter",
  "timer",
] as const;
const object = z.record(z.string(), z.unknown());
export const changeSchema = z
  .object({
    kind: z.enum([
      "automation",
      "script",
      "scene",
      "dashboard",
      "dashboard_create",
      "area",
      "floor",
      "device",
      "entity",
      "label",
      "helper",
      "zone",
      "automation_enabled",
      "blueprint",
    ]),
    action: z.enum(["create", "update"]),
    id: z.string().max(250).optional(),
    domain: z.enum(helperDomains).optional(),
    data: object,
  })
  .strict();
export type ChangeSpec = z.infer<typeof changeSchema>;
export type Json = Record<string, any>;
const text = z.string().min(1).max(250);
const nullableText = text.nullable().optional();
const strings = z.array(text).max(100).optional();
const named = { name: text.optional(), icon: nullableText };
export const editableFields: Record<string, string[]> = {
  area: [
    "name",
    "icon",
    "aliases",
    "floor_id",
    "labels",
    "picture",
    "temperature_entity_id",
    "humidity_entity_id",
  ],
  floor: ["name", "icon", "aliases", "level"],
  device: ["name_by_user", "area_id", "labels"],
  entity: ["name", "new_entity_id", "labels"],
  label: ["name", "icon", "color", "description"],
  zone: ["name", "icon", "latitude", "longitude", "radius", "passive"],
};
const schemas: Record<string, z.ZodType> = {
  area: z
    .object({
      ...named,
      aliases: strings,
      floor_id: nullableText,
      labels: strings,
      picture: nullableText,
      temperature_entity_id: nullableText,
      humidity_entity_id: nullableText,
    })
    .strict(),
  floor: z
    .object({
      ...named,
      aliases: strings,
      level: z.number().int().nullable().optional(),
    })
    .strict(),
  device: z
    .object({
      name_by_user: nullableText,
      area_id: nullableText,
      labels: strings,
    })
    .strict(),
  entity: z
    .object({
      name: nullableText,
      new_entity_id: z
        .string()
        .regex(/^[a-z_]+\.[a-z0-9_]+$/)
        .optional(),
      labels: strings,
    })
    .strict(),
  label: z
    .object({
      ...named,
      color: nullableText,
      description: z.string().max(2000).nullable().optional(),
    })
    .strict(),
  zone: z
    .object({
      ...named,
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      radius: z.number().nonnegative().optional(),
      passive: z.boolean().optional(),
    })
    .strict(),
  automation_enabled: z.object({ enabled: z.boolean() }).strict(),
  dashboard_create: z
    .object({
      url_path: z.string().regex(/^[a-z0-9][a-z0-9_-]*-[a-z0-9_-]+$/),
      title: text,
      icon: text.optional(),
      show_in_sidebar: z.boolean(),
      require_admin: z.boolean(),
      config: object.optional(),
    })
    .strict(),
  blueprint: z
    .object({
      domain: z.literal("automation"),
      path: z.string().regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.yaml$/),
      yaml: z.string().min(1).max(100000),
      source_url: z.url().optional(),
    })
    .strict(),
};
const helperFields: Record<string, string[]> = {
  input_boolean: ["name", "icon", "initial"],
  input_number: [
    "name",
    "icon",
    "min",
    "max",
    "step",
    "mode",
    "unit_of_measurement",
    "initial",
  ],
  input_text: ["name", "icon", "min", "max", "pattern", "mode", "initial"],
  input_select: ["name", "icon", "options", "initial"],
  input_datetime: ["name", "icon", "has_date", "has_time", "initial"],
  counter: ["name", "icon", "initial", "minimum", "maximum", "step", "restore"],
  timer: ["name", "icon", "duration", "restore"],
};
export function writable(kind: string, data: Json, domain?: string): Json {
  const fields =
    kind === "helper" ? helperFields[domain!] : editableFields[kind];
  return fields
    ? Object.fromEntries(
        Object.entries(data).filter(([k]) => fields.includes(k)),
      )
    : data;
}
export function validateSpec(input: unknown): ChangeSpec {
  const s = changeSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(s)) > 200000)
    throw new Error("Change exceeds 200 KB.");
  if (
    ["device", "entity", "dashboard", "automation_enabled"].includes(s.kind) &&
    s.action !== "update"
  )
    throw new Error("This target only supports updates.");
  if (
    ["blueprint", "dashboard_create"].includes(s.kind) &&
    s.action !== "create"
  )
    throw new Error("This target only supports creation.");
  if (s.kind !== "dashboard" && s.action === "update" && !s.id)
    throw new Error("An existing target id is required.");
  if (["automation", "script", "scene"].includes(s.kind) && !s.id)
    throw new Error("A configuration id is required.");
  if (
    ["automation", "script", "scene"].includes(s.kind) &&
    s.data.id !== undefined &&
    s.data.id !== s.id
  )
    throw new Error("Configuration id must match the target id.");
  if (s.id && !/^[a-zA-Z0-9_.-]+$/.test(s.id))
    throw new Error("Invalid target id.");
  if (!Object.keys(s.data).length)
    throw new Error("Change data cannot be empty.");
  if (schemas[s.kind]) schemas[s.kind].parse(s.data);
  if (
    s.action === "create" &&
    ["area", "floor", "label", "helper", "zone"].includes(s.kind)
  )
    text.parse(s.data.name);
  if (s.kind === "zone" && s.action === "create")
    for (const k of ["latitude", "longitude"])
      if (s.data[k] === undefined) throw new Error(`${k} is required.`);
  if (s.kind === "automation_enabled" && !s.id?.startsWith("automation."))
    throw new Error("An automation entity id is required.");
  if (s.kind === "helper") {
    if (!s.domain) throw new Error("Helper domain is required.");
    if (Object.keys(s.data).some((k) => !helperFields[s.domain!].includes(k)))
      throw new Error("Unsupported helper field.");
    if (
      s.action === "create" &&
      s.domain === "input_number" &&
      (typeof s.data.min !== "number" ||
        typeof s.data.max !== "number" ||
        s.data.min > s.data.max)
    )
      throw new Error("Number helpers require min <= max.");
    if (
      s.domain === "input_select" &&
      (s.action === "create" || s.data.options !== undefined)
    )
      z.array(text).min(1).parse(s.data.options);
    if (
      s.domain === "input_datetime" &&
      s.action === "create" &&
      !s.data.has_date &&
      !s.data.has_time
    )
      throw new Error("Datetime helpers need has_date or has_time.");
  }
  if (s.kind === "automation" && !s.data.use_blueprint) {
    text.parse(s.data.alias);
    if (s.data.triggers === undefined && s.data.trigger === undefined)
      throw new Error("Automation triggers are required.");
    if (s.data.actions === undefined && s.data.action === undefined)
      throw new Error("Automation actions are required.");
  }
  if (s.kind === "script" && !s.data.use_blueprint)
    z.array(z.unknown()).parse(s.data.sequence);
  if (s.kind === "scene") {
    text.parse(s.data.name);
    object.parse(s.data.entities);
  }
  if (s.kind === "dashboard") z.array(object).parse(s.data.views);
  if (s.kind === "dashboard_create" && s.data.config)
    z.array(object).parse((s.data.config as Json).views);
  return s;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function diff(before: unknown, after: unknown, path = ""): Json[] {
  if (canonical(before) === canonical(after)) return [];
  if (
    before &&
    after &&
    !Array.isArray(before) &&
    !Array.isArray(after) &&
    typeof before === "object" &&
    typeof after === "object"
  ) {
    const a = before as Json,
      b = after as Json;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) =>
      diff(a[k], b[k], `${path}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`),
    );
  }
  return [{ path: path || "/", before: before ?? null, after: after ?? null }];
}
