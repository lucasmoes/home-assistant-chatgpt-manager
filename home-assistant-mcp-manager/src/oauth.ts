import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import Provider, { errors } from "oidc-provider";
import type { BridgeConfig } from "./config.js";
import { builtinClients, chatGptMetadata, chatGptRedirect, validRedirect } from "./oauth-clients.js";
export { CLIENT_ID, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT_URI, chatGptRedirect } from "./oauth-clients.js";
import { OAuthStore } from "./oauth-store.js";

export const OAUTH_SCOPE = "ha:manage";
export function secretEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
function escape(value: unknown): string {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

export class OAuthServer {
  readonly provider: Provider;
  readonly resource: string;
  private store: OAuthStore;
  private cleanup: NodeJS.Timeout;
  private counts = new Map<string, { start: number; count: number }>();

  constructor(private config: BridgeConfig) {
    const issuer = config.publicUrl;
    this.resource = `${issuer}/mcp`;
    this.store = new OAuthStore(config.oauthDataDir, JSON.stringify([issuer, config.apiKey, config.oauthRedirectUri, config.writeAccess,
      ...((config.oauthClients?.length || config.oauthDynamicRegistration) ? [config.oauthClients ?? [], !!config.oauthDynamicRegistration] : []),
    ]));
    this.provider = new Provider(issuer, {
      adapter: model => this.store.adapter(model),
      jwks: this.store.keys.jwks,
      cookies: {
        keys: this.store.keys.cookies,
        long: { secure: true, httpOnly: true, sameSite: "lax" },
        short: { secure: true, httpOnly: true, sameSite: "lax" },
      },
      clients: [...builtinClients(config.oauthRedirectUri), ...(config.oauthClients ?? [])],
      extraClientMetadata: {
        // Run policy once for every registration, including metadata without this key.
        properties: ["manager_policy"],
        validator: (ctx, _key, _value, metadata) => {
          if (ctx?.oidc.route !== "registration") return;
          const allowed = ["client_name", "redirect_uris", "grant_types", "response_types",
            "token_endpoint_auth_method", "application_type", "scope", "client_uri", "logo_uri", "contacts"];
          if (Object.keys(ctx.oidc.body ?? {}).some(k => !allowed.includes(k)) ||
              !metadata.redirect_uris?.length || metadata.redirect_uris.length > 10 ||
              !metadata.redirect_uris.every(validRedirect) ||
              !["none", "client_secret_basic", "client_secret_post"].includes(metadata.token_endpoint_auth_method ?? "") ||
              !metadata.grant_types?.includes("authorization_code") ||
              metadata.grant_types.some(g => !["authorization_code", "refresh_token"].includes(g)) ||
              metadata.response_types?.some(r => r !== "code") ||
              (metadata.client_name !== undefined && metadata.client_name.length > 128) ||
              (metadata.scope && metadata.scope.split(" ").some(s => ![OAUTH_SCOPE, "openid", "offline_access"].includes(s)))) {
            throw new errors.InvalidClientMetadata("Only authorization-code MCP clients with HTTPS or loopback callbacks are supported");
          }
          if (this.store.clientCount() >= 100) throw new errors.InvalidClientMetadata("Client registration capacity reached");
        },
      },
      features: {
        registration: { enabled: !!config.oauthDynamicRegistration, initialAccessToken: false, issueRegistrationAccessToken: false },
        devInteractions: { enabled: false },
        userinfo: { enabled: false },
        rpInitiatedLogout: { enabled: false },
        revocation: { enabled: true, allowedPolicy: (_ctx, client, token) => token.clientId === client.clientId },
        clientIdMetadataDocument: {
          enabled: true, ack: "draft-02",
          allowFetch: (_ctx, id) => chatGptMetadata(id),
          allowClient: (_ctx, client) => chatGptMetadata(client.clientId) && !!client.redirectUris?.length && client.redirectUris.every(chatGptRedirect),
        },
        resourceIndicators: {
          enabled: true,
          defaultResource: () => this.resource,
          useGrantedResource: () => true,
          getResourceServerInfo: (_ctx, resource) => {
            if (resource !== this.resource) throw new errors.InvalidTarget();
            return { scope: OAUTH_SCOPE, audience: this.resource, accessTokenTTL: 600, accessTokenFormat: "opaque" };
          },
        },
      },
      clientBasedCORS: () => false,
      responseTypes: ["code"],
      pkce: { required: () => true },
      scopes: ["openid", "offline_access", OAUTH_SCOPE],
      issueRefreshToken: (_ctx, client) => client.grantTypeAllowed("refresh_token"),
      rotateRefreshToken: true,
      ttl: { AccessToken: 600, AuthorizationCode: 60, Interaction: 600, Session: 86400, Grant: 2592000, RefreshToken: 2592000 },
      routes: { registration: "/oauth/register", authorization: "/oauth/authorize", token: "/oauth/token", revocation: "/oauth/revoke", jwks: "/oauth/jwks" },
      interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
      findAccount: (_ctx, id) => id === "owner" ? { accountId: id, claims: () => ({ sub: id }) } : undefined,
      renderError: async (ctx, output) => {
        ctx.type = "html";
        ctx.body = this.page("Connection failed", `<p>${escape(output.error)}: ${escape(output.error_description)}</p><p>Return to your AI assistant and start the connection again.</p>`);
      },
    });
    this.provider.proxy = true;
    // Never log authorization URLs, codes, credentials or token response objects.
    this.provider.on("server_error", () => console.error("[oauth] internal error; connection failed"));
    this.cleanup = setInterval(() => this.store.purge(), 60000);
    this.cleanup.unref();
  }

  private page(title: string, body: string): string {
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Home Assistant MCP Manager</title><style>body{font:17px system-ui;background:#101827;color:#eef4ff;margin:0;padding:7vh 20px}main{max-width:480px;margin:auto;padding:30px;background:#1c283b;border-radius:18px}h1{font-size:26px}p{line-height:1.6}input,button{box-sizing:border-box;width:100%;font:inherit;padding:13px;border-radius:8px;margin:12px 0}input{background:#101827;color:white;border:1px solid #69809e}button{background:#6aa9ff;border:0;color:#071c36;cursor:pointer}.secondary{background:#344761;color:white}small{overflow-wrap:anywhere;color:#bbcde5}</style><main><small>HOME ASSISTANT MCP MANAGER</small><h1>${escape(title)}</h1>${body}</main></html>`;
  }

  private csrf(uid: string): string { return createHmac("sha256", this.store.keys.cookies[0]).update(uid).digest("hex"); }

  private limited(bucket: string, limit: number): boolean {
    const now = Date.now();
    let counter = this.counts.get(bucket);
    if (!counter || counter.start + 60000 <= now) {
      counter = { start: now, count: 0 }; this.counts.set(bucket, counter);
    }
    return ++counter.count > limit;
  }

  async identity(token: string): Promise<string | undefined> {
    const access = await this.provider.AccessToken.find(token);
    if (!access?.isValid || access.accountId !== "owner" || access.aud !== this.resource || !access.scopes.has(OAUTH_SCOPE)) return undefined;
    const grant = await this.provider.Grant.find(access.grantId);
    return grant?.isValid && grant.accountId === "owner" && grant.clientId === access.clientId ? access.clientId : undefined;
  }

  async accepts(token: string): Promise<boolean> { return !!(await this.identity(token)); }

  challenge(res: ServerResponse): void {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${this.config.publicUrl}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPE}"`);
    json(res, 401, { error: "unauthorized" });
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
      if (req.method !== "GET") { json(res, 405, { error: "method_not_allowed" }); return true; }
      json(res, 200, { resource: this.resource, authorization_servers: [this.config.publicUrl], scopes_supported: [OAUTH_SCOPE], bearer_methods_supported: ["header"] });
      return true;
    }
    if (!path.startsWith("/oauth/") && !path.startsWith("/.well-known/") && !path.startsWith("/interaction/") && !path.startsWith("/auth/")) return false;
    res.setHeader("cache-control", "no-store");
    // HTML form POSTs under no-referrer send Origin: null. Preserve the origin
    // for login/consent while suppressing referrers to other origins.
    res.setHeader("referrer-policy", path.startsWith("/interaction/") ? "same-origin" : "no-referrer");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    // This service is behind an HTTPS tunnel. Canonical origin comes exclusively
    // from configuration, never from untrusted Host/X-Forwarded-* headers.
    const canonical = new URL(this.config.publicUrl);
    req.headers.host = canonical.host;
    req.headers["x-forwarded-host"] = canonical.host;
    req.headers["x-forwarded-proto"] = "https";
    delete req.headers["x-forwarded-for"];
    // The provider router accepts case variants and a trailing slash. Do not
    // let aliases bypass the registration gate or its rate/capacity limits.
    if (path.toLowerCase().replace(/\/$/, "") === "/oauth/register" && path !== "/oauth/register") {
      json(res, 404, { error: "not_found" }); return true;
    }
    if (path === "/oauth/register") {
      if (!this.config.oauthDynamicRegistration) { json(res, 404, { error: "not_found" }); return true; }
      if (req.method !== "POST") { json(res, 405, { error: "method_not_allowed" }); return true; }
      if (this.limited("register", 10) || this.store.clientCount() >= 100) {
        res.setHeader("retry-after", "60"); json(res, 429, { error: "registration_limit" }); return true;
      }
    }
    if (path === "/oauth/authorize" && this.limited("authorize", 60)) {
      res.setHeader("retry-after", "60"); json(res, 429, { error: "slow_down" }); return true;
    }
    if (path.startsWith("/interaction/")) {
      await this.interaction(req, res, path); return true;
    }
    // RFC 8414 alias; the provider generates the actual discovery document.
    if (path === "/.well-known/oauth-authorization-server") req.url = "/.well-known/openid-configuration";
    await this.provider.callback()(req, res);
    return true;
  }

  private async interaction(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    try {
      const detail = await this.provider.interactionDetails(req, res);
      if (path !== `/interaction/${detail.uid}`) { json(res, 404, { error: "not_found" }); return; }
      const { uid, prompt, params } = detail;
      const client = await this.provider.Client.find(String(params.client_id));
      const callback = String(params.redirect_uri);
      if (!client || !client.redirectUriAllowed(callback) || !validRedirect(callback)) {
        json(res, 400, { error: "invalid_client" }); return;
      }
      // Browser form submissions may follow the OAuth redirect. Permit only
      // this interaction's validated callback origin, never an entire provider list.
      res.setHeader("content-security-policy", `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(callback).origin}; frame-ancestors 'none'; base-uri 'none'`);
      if (req.method === "GET") {
        const hidden = `<input type="hidden" name="csrf" value="${this.csrf(uid)}">`;
        let body: string;
        if (prompt.name === "login") {
          body = `<p>Enter the connection password from this add-on’s <strong>api_key</strong> setting. This is separate from your Home Assistant account password.</p><form method="post">${hidden}<label>Connection password<input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label><button name="action" value="login">Sign in</button></form>`;
        } else if (prompt.name === "consent") {
          body = `<p>Allow ${escape(client.clientName || "this MCP client")} to access this Home Assistant installation?</p><p>${this.config.writeAccess ? "Read entities and configuration, and create or update automations, scripts and dashboards." : "Read entities and configuration. Configuration changes are disabled in the add-on."}</p><small>Server: ${escape(this.config.publicUrl)}<br>Client: ${escape(params.client_id)}<br>Callback: ${escape(callback)}</small><p>Client names are labels, not verified identities. Approve only a connection you started and a callback you recognize.</p><form method="post">${hidden}<button name="action" value="allow">Allow connection</button><button class="secondary" name="action" value="deny">Cancel</button></form>`;
        } else { json(res, 400, { error: "unsupported_interaction" }); return; }
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(this.page(prompt.name === "login" ? "Connect your home" : "Approve connection", body));
        return;
      }
      if (req.method !== "POST") { json(res, 405, { error: "method_not_allowed" }); return; }
      if (req.headers.origin !== this.config.publicUrl || req.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") {
        json(res, 403, { error: "invalid_origin" }); return;
      }
      if (this.limited("login", 20)) { res.setHeader("retry-after", "60"); json(res, 429, { error: "slow_down" }); return; }
      let body = "";
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 4096) { json(res, 413, { error: "body_too_large" }); return; }
      }
      const form = new URLSearchParams(body);
      if (!secretEqual(form.get("csrf") ?? "", this.csrf(uid))) { json(res, 403, { error: "invalid_csrf" }); return; }
      if (form.get("action") === "deny") {
        await this.provider.interactionFinished(req, res, { error: "access_denied", error_description: "The owner declined the connection." }, { mergeWithLastSubmission: false });
      } else if (prompt.name === "login" && form.get("action") === "login") {
        if (!secretEqual(form.get("password") ?? "", this.config.apiKey)) {
          res.statusCode = 401; res.setHeader("content-type", "text/html; charset=utf-8");
          res.end(this.page("Password not accepted", "<p>Go back and enter the connection password configured in the add-on.</p>")); return;
        }
        await this.provider.interactionFinished(req, res, { login: { accountId: "owner" } }, { mergeWithLastSubmission: false });
      } else if (prompt.name === "consent" && form.get("action") === "allow" && detail.session?.accountId === "owner") {
        const grant = (detail.grantId ? await this.provider.Grant.find(detail.grantId) : undefined) ?? new this.provider.Grant({ accountId: "owner", clientId: String(params.client_id) });
        const details = prompt.details;
        if (details.missingOIDCScope) grant.addOIDCScope((details.missingOIDCScope as string[]).join(" "));
        if (details.missingOIDCClaims) grant.addOIDCClaims(details.missingOIDCClaims as string[]);
        if (details.missingResourceScopes) {
          for (const [resource, scopes] of Object.entries(details.missingResourceScopes as Record<string, string[]>)) {
            if (resource !== this.resource || scopes.some(s => s !== OAUTH_SCOPE)) throw new Error("Invalid resource scope");
            grant.addResourceScope(resource, scopes.join(" "));
          }
        }
        await this.provider.interactionFinished(req, res, { consent: { grantId: await grant.save() } }, { mergeWithLastSubmission: true });
      } else json(res, 400, { error: "invalid_interaction" });
    } catch {
      if (!res.headersSent) json(res, 400, { error: "interaction_expired", message: "Return to your AI client and connect again." });
      else res.end();
    }
  }

  close(): void { clearInterval(this.cleanup); this.store.close(); }
}
