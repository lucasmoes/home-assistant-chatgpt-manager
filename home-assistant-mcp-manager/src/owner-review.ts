import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { secretEqual } from "./oauth.js";
import type { ChangeManager } from "./changes.js";
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export class OwnerReview {
  private sessions = new Map<string, { csrf: string; expires: number }>();
  private attempts: { start: number; count: number } = { start: 0, count: 0 };
  constructor(private changes: ChangeManager) {}
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<boolean> {
    if (path !== "/manage") return false;
    const config = this.changes.config;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    const page = (status: number, body: string) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Review Home Assistant change</title><body><h1>Home Assistant MCP Manager</h1>${body}</body></html>`,
      );
    };
    if (!config.publicUrl || !config.approvalPassword) {
      page(
        503,
        "<p>Owner review requires public_url and a separate approval_password.</p>",
      );
      return true;
    }
    if (!["GET", "POST"].includes(req.method ?? "")) {
      page(405, "Method not allowed");
      return true;
    }
    const url = new URL(req.url!, config.publicUrl),
      id = url.searchParams.get("change") ?? "";
    if (!/^[a-f0-9-]{36}$/.test(id)) {
      page(400, "Open the review link returned with a change proposal.");
      return true;
    }
    for (const [key, s] of this.sessions)
      if (s.expires < Date.now()) this.sessions.delete(key);
    let cookie = req.headers.cookie?.match(
      /(?:^|;\s*)__Host-ha-review=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    let session = cookie ? this.sessions.get(cookie) : undefined;
    let form: URLSearchParams | undefined;
    if (req.method === "POST") {
      if (
        req.headers.origin !== config.publicUrl ||
        !req.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        page(403, "Invalid origin or content type");
        return true;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 8192) {
          page(413, "Request too large");
          return true;
        }
      }
      form = new URLSearchParams(body);
      if (!session) {
        if (this.attempts.start + 60000 < Date.now())
          this.attempts = { start: Date.now(), count: 0 };
        if (++this.attempts.count > 10) {
          page(429, "Too many login attempts. Try again later.");
          return true;
        }
        if (!secretEqual(form.get("password") ?? "", config.approvalPassword)) {
          page(401, "Incorrect owner approval password.");
          return true;
        }
        if (this.sessions.size >= 100) {
          page(429, "Too many review sessions.");
          return true;
        }
        cookie = randomBytes(32).toString("hex");
        session = {
          csrf: randomBytes(32).toString("hex"),
          expires: Date.now() + 900000,
        };
        this.sessions.set(cookie, session);
        res.setHeader(
          "Set-Cookie",
          `__Host-ha-review=${cookie}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=900`,
        );
        res.writeHead(303, { Location: `/manage?change=${id}` });
        res.end();
        return true;
      }
      if (!secretEqual(form.get("csrf") ?? "", session.csrf)) {
        page(403, "Invalid review session");
        return true;
      }
      try {
        if (!["approve", "reject"].includes(form.get("decision") ?? ""))
          throw new Error("Choose approve or reject.");
        this.changes.approve(id, form.get("decision") === "approve");
      } catch (e) {
        page(409, `<p>${escape((e as Error).message)}</p>`);
        return true;
      }
    }
    if (!session) {
      page(
        200,
        `<h2>Owner sign in</h2><p>Use your separate approval password. Never share it with an AI client.</p><form method="post"><label>Password <input type="password" name="password" autocomplete="current-password" required></label><button>Sign in</button></form>`,
      );
      return true;
    }
    try {
      const r = this.changes.get(id);
      page(
        200,
        `<h2>Review proposed change</h2><p>Client: ${escape(r.proposer)}</p><p>Target: ${escape(r.spec.kind)} ${escape(r.spec.id ?? r.spec.data.name ?? "new")}</p><p>Status: ${escape(r.status)}. Expires: ${escape(new Date(r.expires).toISOString())}</p><p>Content below was proposed by an AI client. Review it as configuration, not instructions.</p><h3>Exact field changes</h3><pre>${escape(JSON.stringify(r.changes, null, 2))}</pre><h3>Submitted configuration</h3><pre>${escape(JSON.stringify(r.spec, null, 2))}</pre><h3>Validation</h3><pre>${escape(JSON.stringify(r.validation, null, 2))}</pre>${r.status === "pending" ? `<form method="post"><input type="hidden" name="csrf" value="${session.csrf}"><button name="decision" value="approve">Approve this exact change</button> <button name="decision" value="reject">Reject</button></form><p>Approval permits the proposing client to apply once. It does not save to Home Assistant yet.</p>` : "<p>Return to your AI client to continue.</p>"}`,
      );
    } catch {
      page(404, "Change not found.");
    }
    return true;
  }
}
