import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BridgeConfig } from "./config.js";
import {
  canonical,
  diff,
  validateSpec,
  type ChangeSpec,
  type Json,
} from "./change-spec.js";
import { ChangeTargets } from "./change-targets.js";
import { validateReferences } from "./diagnostics.js";

export const clientContext = new AsyncLocalStorage<string>();
export interface ChangeRecord {
  id: string;
  spec: ChangeSpec;
  before: any;
  after: any;
  changes: Json[];
  status: string;
  proposer: string;
  created: number;
  expires: number;
  validation: any;
  approved_at?: number;
  applied_by?: string;
  outcome?: string;
}
export class ChangeManager {
  private db: DatabaseSync;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly targets: ChangeTargets,
    readonly config: BridgeConfig,
  ) {
    const dir = join(config.oauthDataDir, "changes");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const file = join(dir, "changes.sqlite");
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS changes(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY, change_id TEXT NOT NULL, created INTEGER NOT NULL, payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    const context = createHash("sha256")
      .update(
        canonical([
          config.homeAssistantBaseUrl,
          config.homeAssistantToken,
          config.publicUrl,
          config.approvalPassword,
          config.writeAccess,
          config.apiKey,
          config.oauthClients,
          config.oauthDynamicRegistration,
        ]),
      )
      .digest("hex");
    const old = this.db
      .prepare("SELECT value FROM settings WHERE id='context'")
      .get();
    // Interrupted writes are never automatically retried. Credential/policy changes revoke pending approvals.
    for (const row of this.db.prepare("SELECT payload FROM changes").all()) {
      const r = JSON.parse(String(row.payload)) as ChangeRecord;
      if (r.status === "applying") {
        r.status = "uncertain";
        r.outcome =
          "Server stopped during apply; inspect Home Assistant before proposing again.";
        this.save(r);
        this.event(r, "interrupted", "server");
      } else if (
        old?.value !== context &&
        ["pending", "approved"].includes(r.status)
      ) {
        r.status = "revoked";
        this.save(r);
      }
    }
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES ('context',?)")
      .run(context);
  }
  close() {
    this.db.close();
  }
  requireWrites() {
    if (!this.config.writeAccess)
      throw new Error(
        "Write access is disabled in the Home Assistant app configuration.",
      );
    if (!this.config.publicUrl || !this.config.approvalPassword)
      throw new Error(
        "Configure public_url and a separate approval_password before proposing writes.",
      );
  }
  private save(r: ChangeRecord) {
    this.db
      .prepare("INSERT OR REPLACE INTO changes VALUES (?,?)")
      .run(r.id, JSON.stringify(r));
  }
  private event(r: ChangeRecord, event: string, actor: string) {
    this.db
      .prepare("INSERT INTO events(created,payload) VALUES (?,?)")
      .run(
        Date.now(),
        JSON.stringify({
          change_id: r.id,
          event,
          actor,
          target: { kind: r.spec.kind, id: r.spec.id, domain: r.spec.domain },
          status: r.status,
        }),
      );
  }
  get(id: string): ChangeRecord {
    const row = this.db
      .prepare("SELECT payload FROM changes WHERE id=?")
      .get(id);
    if (!row) throw new Error("Unknown change id.");
    return JSON.parse(String(row.payload));
  }
  private owned(id: string) {
    const r = this.get(id);
    if (r.proposer !== (clientContext.getStore() ?? "internal"))
      throw new Error("This change belongs to another client.");
    return r;
  }
  private fresh(r: ChangeRecord) {
    if (r.expires <= Date.now())
      throw new Error("Change expired; create a new proposal.");
  }
  async validate(spec: ChangeSpec) {
    validateSpec(spec);
    const refs = await validateReferences(this.targets.ha, spec.data);
    if (refs.missing_entities.length || refs.missing_services.length)
      throw new Error(
        `Unknown references: ${[...refs.missing_entities, ...refs.missing_services].join(", ")}`,
      );
    if (spec.kind === "automation" && spec.data.use_blueprint) {
      const bp = spec.data.use_blueprint as Json;
      await this.targets.ha.websocketCommand({
        type: "blueprint/substitute",
        domain: "automation",
        path: bp.path,
        input: bp.input ?? {},
      });
    }
    for (const [field, kind, key] of [
      ["floor_id", "floor", "floor_id"],
      ["area_id", "area", "area_id"],
    ]) {
      if (
        typeof spec.data[field] === "string" &&
        !(await this.targets.list(kind)).some(
          (v) => v[key] === spec.data[field],
        )
      )
        throw new Error(`Unknown ${field}.`);
    }
    if (Array.isArray(spec.data.labels)) {
      const labels = await this.targets.list("label");
      if (spec.data.labels.some((id) => !labels.some((v) => v.label_id === id)))
        throw new Error("Unknown label id.");
    }
    return {
      valid: true,
      ...refs,
      scope:
        "Manager structure and literal entity/service references. Home Assistant performs authoritative validation on save; templates, custom cards and integration-specific fields are not fully validated.",
    };
  }
  async propose(input: unknown, expectedBefore?: unknown) {
    this.requireWrites();
    if (
      Number(this.db.prepare("SELECT COUNT(*) AS n FROM changes").get()!.n) >=
      10000
    )
      throw new Error(
        "Change store limit reached; archive the store before creating more proposals.",
      );
    const spec = validateSpec(input),
      validation = await this.validate(spec),
      before = await this.targets.read(spec),
      after = this.targets.desired(spec, before);
    if (
      expectedBefore !== undefined &&
      canonical(before) !== canonical(expectedBefore)
    )
      throw new Error(
        "Target changed while constructing the proposal; read it again.",
      );
    const changes = diff(before, after);
    if (!changes.length) throw new Error("No configuration changes detected.");
    const r: ChangeRecord = {
      id: randomUUID(),
      spec,
      before,
      after,
      changes,
      status: "pending",
      proposer: clientContext.getStore() ?? "internal",
      created: Date.now(),
      expires: Date.now() + 86400000,
      validation,
    };
    this.save(r);
    this.event(r, "proposed", r.proposer);
    return {
      ...r,
      review_url: `${this.config.publicUrl}/manage?change=${r.id}`,
      next: "Owner must review and approve in the browser, then this client may call apply_approved_change. No Home Assistant writes have been made.",
    };
  }
  async validateChange(id: string) {
    const r = this.owned(id);
    this.fresh(r);
    const validation = await this.validate(r.spec);
    return {
      change_id: id,
      validation,
      stale: canonical(await this.targets.read(r.spec)) !== canonical(r.before),
    };
  }
  approve(id: string, approve: boolean) {
    this.requireWrites();
    const r = this.get(id);
    this.fresh(r);
    if (r.status !== "pending") throw new Error("Change is no longer pending.");
    r.status = approve ? "approved" : "rejected";
    if (approve) r.approved_at = Date.now();
    this.save(r);
    this.event(r, approve ? "approved" : "rejected", "owner-browser");
    return r;
  }
  async apply(id: string) {
    const actor = clientContext.getStore() ?? "internal";
    const task = this.tail.then(async () => {
      this.requireWrites();
      const r = this.owned(id);
      this.fresh(r);
      if (r.status !== "approved")
        throw new Error(
          "Change needs owner approval or has already been attempted.",
        );
      await this.validate(r.spec);
      if (canonical(await this.targets.read(r.spec)) !== canonical(r.before)) {
        r.status = "stale";
        this.save(r);
        this.event(r, "conflict", actor);
        throw new Error(
          "Configuration changed since preview. Create a new proposal for owner review.",
        );
      }
      r.status = "applying";
      r.applied_by = actor;
      this.save(r);
      this.event(r, "apply_started", actor);
      // Persist the original before any mutation, including writes that may partially fail.
      if (r.before !== null) this.version(r, r.spec, r.before, "before");
      try {
        const response = await this.targets.write(r.spec);
        const verified = await this.targets.verify(r.spec, response);
        r.status = verified.verified ? "applied" : "applied_unverified";
        r.outcome = verified.verified
          ? "Saved and read back successfully."
          : "Saved but read-back differs from submitted fields. Inspect before further changes.";
        this.version(r, verified.target, verified.snapshot, "after");
      } catch {
        r.status = "uncertain";
        r.outcome =
          "Apply or verification failed; Home Assistant may have changed. Inspect the target before proposing again. This change cannot be retried.";
      }
      this.save(r);
      this.event(r, "apply_finished", actor);
      return r;
    });
    this.tail = task.catch(() => {});
    return task;
  }
  private version(
    r: ChangeRecord,
    spec: ChangeSpec,
    snapshot: any,
    phase: string,
  ) {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO versions VALUES (?,?,?,?)")
      .run(
        id,
        r.id,
        Date.now(),
        JSON.stringify({ id, change_id: r.id, spec, snapshot, phase }),
      );
  }
  versions(limit = 50, offset = 0) {
    return this.db
      .prepare(
        "SELECT id,change_id,created,payload FROM versions ORDER BY created DESC,id LIMIT ? OFFSET ?",
      )
      .all(limit, offset)
      .map((row) => {
        const v = JSON.parse(String(row.payload));
        return {
          id: v.id,
          change_id: v.change_id,
          created: row.created,
          phase: v.phase,
          target: { kind: v.spec.kind, id: v.spec.id, domain: v.spec.domain },
          restorable: !["blueprint", "dashboard_create"].includes(v.spec.kind),
        };
      });
  }
  async restore(id: string) {
    this.requireWrites();
    const row = this.db
      .prepare("SELECT payload FROM versions WHERE id=?")
      .get(id);
    if (!row) throw new Error("Version not found.");
    const v = JSON.parse(String(row.payload));
    return this.propose(this.targets.restore(v.spec, v.snapshot));
  }
  history(limit = 50, offset = 0) {
    return this.db
      .prepare(
        "SELECT sequence,created,payload FROM events ORDER BY sequence DESC LIMIT ? OFFSET ?",
      )
      .all(limit, offset)
      .map((r) => ({
        sequence: r.sequence,
        created: r.created,
        ...JSON.parse(String(r.payload)),
      }));
  }
}
