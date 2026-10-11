# Authentication implementation

## Deployment boundary

This is a self-hosted, single-household OAuth authorization/resource server. The owner proves access with the add-on connection password (`api_key`) on a browser page. Home Assistant account authentication and multi-user roles are not part of this version. Keep the plaintext HTTP listener behind the configured HTTPS tunnel/reverse proxy. `public_url` is a dedicated origin, not a path on the existing Home Assistant site.

`oidc-provider` is pinned in `package-lock.json`. Its OAuth implementation enforces authorization codes with S256 PKCE, exact registered redirects, issuer identification, client authentication, token expiry, refresh rotation, and replay detection. The bridge supplies the owner login/consent UI, persistent SQLite adapter, resource/scope checks, and MCP authorization gate.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `/health` | Liveness and OAuth/write configuration flags; no credentials |
| `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` | Resource metadata for the canonical `public_url + /mcp` resource |
| `/.well-known/oauth-authorization-server` | Alias to provider-generated discovery |
| `/.well-known/openid-configuration` | Provider discovery |
| `/oauth/authorize` | Authorization code + required S256 PKCE |
| `/interaction/:uid` | Browser login and explicit consent |
| `/oauth/register` | Optional RFC 7591 registration; absent from discovery when disabled |
| `/oauth/token` | Authorization-code exchange and refresh |
| `/oauth/revoke` | Client-bound revocation |
| `/oauth/jwks` | Public signing keys |
| `/mcp` | Protected management MCP endpoint |

## Clients and privileges

- Automatic CIMD fetching is allowlisted to `https://chatgpt.com/oauth/client.json` and the callback-specific `/oauth/{id}/client.json` shape. All advertised redirects must be ChatGPT OAuth callback paths. Arbitrary client URLs are denied before fetching.
- Signed `private_key_jwt` assertions are verified by the provider against the client's published JWKS. A test serves simulated metadata/JWKS and signs a real RSA assertion; it does not impersonate the live ChatGPT service.
- The Claude preset (`home-assistant-manager-claude`) uses its own exact callback; neither preset accepts the other’s callback.
- A fallback static public client (`home-assistant-manager`, auth method `none`) uses the exact `oauth_redirect_uri` option. A public client has no secret and still must prove PKCE possession and obtain owner consent.
- Provider-neutral public clients come from `oauth_clients`. Optional DCR supports public and generated-secret clients using the same OAuth pipeline. See [registration policy and limits](clients.md). Client-credentials/implicit grants, arbitrary remote metadata fetches and wildcard redirects are rejected.
- OAuth access requires a valid opaque access token issued by this provider, the `owner` account, exact MCP audience, `ha:manage` scope, and a live matching grant.
- `ha:manage` authorizes the configured management capabilities. `write_access` is an additional server-side gate. Increasing or decreasing it invalidates sessions/grants at restart, so approval cannot silently gain write privileges.
- `allow_legacy_api_key` is false by default. When explicitly enabled, the connection password also works as a bearer key and has the same configured management access. This compatibility option bypasses OAuth login by design; ChatGPT web does not need it.

## Storage, expiry, and revocation

The SQLite adapter stores provider records and private signing/session keys at `/data/oauth/oauth.sqlite` (directory mode 0700; file mode 0600). It supports expiry, consumption, UID lookup, and grant-wide revocation. Expired rows are purged periodically. Do not share or commit this database or add-on backups.

Access tokens expire after 600 seconds, authorization codes after 60 seconds, interactions after 600 seconds, browser sessions after one day, and grants/refresh tokens after 30 days. Refresh tokens rotate; reuse revokes the token family. The resource gate also checks the grant, preventing access after grant expiry or revocation.

The stored configuration fingerprint includes public URL, connection password, manual redirect, and write policy, plus additional clients/DCR policy when configured. Empty/disabled defaults preserve the old fingerprint. A change invalidates all records and rotates signing/cookie keys at startup. Ordinary restarts retain them. Changing the connection password and restarting is the owner-operated “disconnect all” action.

## Browser boundary

Login/consent pages use `Referrer-Policy: same-origin` so browser form submissions retain their Origin without leaking referrers to other origins. Other OAuth endpoints retain `no-referrer`. Login/consent submissions require the canonical Origin, an interaction-bound HMAC CSRF value, and the provider's signed interaction cookie. Password comparisons use constant-time hashes. Cookies are Secure, HttpOnly, and SameSite=Lax. Interaction pages are not frameable and do not load third-party assets. HTML values are escaped. Form actions permit the manager origin and the current interaction’s validated callback origin. Consent shows the escaped client label, ID and callback; labels are not verified identities.

Form bodies are capped at 4 KiB, authorization starts at 60/minute, and interaction POSTs at 20/minute across the instance. These fixed global counters deliberately do not trust caller-supplied IP headers. DCR adds a 10/minute global attempt limit, a 100-client persistent cap and the provider’s 56 KiB JSON body limit. Users sharing an instance share these limits.

The provider sees the configured canonical HTTPS host/protocol rather than caller-controlled forwarded headers. This does not provide TLS on port 8765: TLS termination at the tunnel remains required. Requests to MCP with an unrelated browser Origin are denied. Server-to-server clients normally omit Origin.

## MCP connection diagnostics

Version 0.2.2 logs `[mcp]` request/response lines with fixed method/origin categories, authentication outcome and HTTP status. It never logs Authorization values, cookies, URLs, RPC bodies or Home Assistant data. For action-discovery failures, retry once and inspect these lines: `missing-token`, `token-rejected`, `origin-rejected`, or `accepted` plus response status distinguish authentication from transport failures. If no request lines appear, check the saved MCP URL and tunnel/security routing. HTTP 200 confirms a transport response, not acceptance of tool schemas by the client.

### Diagnosing the saved server URL

The ChatGPT **Server URL** and MCP **Resource** must be `public_url + /mcp`. The **Auth URL** is `public_url + /oauth/authorize`; using it as the Server URL can allow OAuth to finish while action discovery fails. In the 2026-10-11 live setup, replacing that incorrect connector with an automatic-CIMD connection to `/mcp` resolved the discovery error.

A sequence of unauthenticated `401 access=missing-token` requests followed by authenticated `200 access=accepted` responses can occur during discovery. Distinguish that from repeated requests with no accepted response. Do not weaken authentication to make an unauthenticated probe succeed.

The live check confirmed a connected account, successful tool refresh and tools becoming available. It did not complete a Home Assistant data read or configuration write; see [verification status](../README.md#verification-status).

## Validation

Run `npm ci && npm test` in the add-on directory with Node 24+ and `jq` available. Tests run a real local HTTP bridge with temporary databases and no production Home Assistant credentials. They cover positive OAuth/MCP flows and security failures. The write test uses an unreachable Home Assistant target and must be rejected by the write gate before any HA request.

Live acceptance after installation:

1. Check public health/discovery through the actual tunnel.
2. Complete OAuth login and consent separately in every target client (ChatGPT, Claude, Gemini CLI or another MCP client).
3. Call `get_home_overview` against the real Home Assistant installation.
4. Confirm writes are blocked with `write_access: false`.
5. If writes are desired, enable them, restart/reconnect, and perform a user-approved configuration change with read-back.

References: [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth), [oidc-provider documentation](https://github.com/panva/node-oidc-provider/tree/main/docs), [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization).
