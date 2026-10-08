import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Adapter, AdapterPayload, Configuration } from "oidc-provider";

/** Single-process persistent adapter. Token material must be treated as a secret. */
export class OAuthStore {
  private db: DatabaseSync;
  readonly keys: { cookies: string[]; jwks: NonNullable<Configuration["jwks"]> };

  constructor(directory: string, credentialContext: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const path = join(directory, "oauth.sqlite");
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        model TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
        expires INTEGER, grant_id TEXT, uid TEXT, user_code TEXT,
        PRIMARY KEY(model, id)
      );
      CREATE INDEX IF NOT EXISTS grant_idx ON records(grant_id);
      CREATE INDEX IF NOT EXISTS uid_idx ON records(model, uid);
      CREATE INDEX IF NOT EXISTS code_idx ON records(model, user_code);
      CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const fingerprint = createHash("sha256").update(credentialContext).digest("hex");
    const previous = this.db.prepare("SELECT value FROM settings WHERE id = 'context'").get();
    if (previous?.value !== fingerprint) {
      // Password, URL, redirect or write policy changes invalidate every existing grant.
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const key = { ...privateKey.export({ format: "jwk" }), kid: randomBytes(16).toString("hex"), use: "sig", alg: "RS256" };
      const keys = { cookies: [randomBytes(32).toString("hex")], jwks: { keys: [key] } };
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec("DELETE FROM records; DELETE FROM settings;");
        const put = this.db.prepare("INSERT INTO settings VALUES (?, ?)");
        put.run("context", fingerprint);
        put.run("keys", JSON.stringify(keys));
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    }
    this.keys = JSON.parse(String(this.db.prepare("SELECT value FROM settings WHERE id = 'keys'").get()!.value));
    this.purge();
  }

  purge(): void {
    this.db.prepare("DELETE FROM records WHERE expires IS NOT NULL AND expires <= ?").run(Math.floor(Date.now() / 1000));
  }

  adapter(model: string): Adapter {
    const db = this.db;
    const find = (column: "id" | "uid" | "user_code", value: string): AdapterPayload | undefined => {
      const row = db.prepare(`SELECT payload FROM records WHERE model = ? AND ${column} = ? AND (expires IS NULL OR expires > ?)`).get(model, value, Math.floor(Date.now() / 1000));
      return row ? JSON.parse(String(row.payload)) : undefined;
    };
    return {
      async upsert(id, payload, expiresIn) {
        db.prepare(`INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(model, id) DO UPDATE SET payload=excluded.payload, expires=excluded.expires,
          grant_id=excluded.grant_id, uid=excluded.uid, user_code=excluded.user_code`).run(
          model, id, JSON.stringify(payload), expiresIn === undefined ? null : Math.floor(Date.now() / 1000) + expiresIn,
          payload.grantId ?? null, payload.uid ?? null, payload.userCode ?? null,
        );
      },
      async find(id) { return find("id", id); },
      async findByUid(uid) { return find("uid", uid); },
      async findByUserCode(code) { return find("user_code", code); },
      async consume(id) {
        db.prepare("UPDATE records SET payload = json_set(payload, '$.consumed', ?) WHERE model = ? AND id = ?")
          .run(Math.floor(Date.now() / 1000), model, id);
      },
      async destroy(id) { db.prepare("DELETE FROM records WHERE model = ? AND id = ?").run(model, id); },
      async revokeByGrantId(id) { db.prepare("DELETE FROM records WHERE grant_id = ?").run(id); },
    };
  }

  close(): void { this.db.close(); }
}
