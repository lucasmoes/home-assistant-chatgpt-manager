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
| `/oauth/token` | Authorization-code exchange and refresh |
| `/oauth/revoke` | Client-bound revocation |
| `/oauth/jwks` | Public signing keys |
| `/mcp` | Protected management MCP endpoint |

## Clients and privileges

- Automatic CIMD fetching is allowlisted to `https://chatgpt.com/oauth/client.json` and the callback-specific `/oauth/{id}/client.json` shape. All advertised redirects must be ChatGPT OAuth callback paths. Arbitrary client URLs are denied before fetching.
- Signed `private_key_jwt` assertions are verified by the provider against the client's published JWKS. A test serves simulated metadata/JWKS and signs a real RSA assertion; it does not impersonate the live ChatGPT service.
- A fallback static public client (`home-assistant-manager`, auth method `none`) uses the exact `oauth_redirect_uri` option. A public client has no secret and still must prove PKCE possession and obtain owner consent.
- DCR and client-credentials grants are not enabled. No arbitrary client registrations or wildcard redirects are accepted.
- OAuth access requires a valid opaque access token issued by this provider, the `owner` account, exact MCP audience, `ha:manage` scope, and a live matching grant.
- `ha:manage` authorizes the configured management capabilities. `write_access` is an additional server-side gate. Increasing or decreasing it invalidates sessions/grants at restart, so approval cannot silently gain write privileges.
- `allow_legacy_api_key` is false by default. When explicitly enabled, the connection password also works as a bearer key and has the same configured management access. This compatibility option bypasses OAuth login by design; ChatGPT web does not need it.

## Storage, expiry, and revocation

The SQLite adapter stores provider records and private signing/session keys at `/data/oauth/oauth.sqlite` (directory mode 0700; file mode 0600). It supports expiry, consumption, UID lookup, and grant-wide revocation. Expired rows are purged periodically. Do not share or commit this database or add-on backups.

Access tokens expire after 600 seconds, authorization codes after 60 seconds, interactions after 600 seconds, browser sessions after one day, and grants/refresh tokens after 30 days. Refresh tokens rotate; reuse revokes the token family. The resource gate also checks the grant, preventing access after grant expiry or revocation.

The stored configuration fingerprint includes public URL, connection password, manual redirect, and write policy. A change invalidates all records and rotates signing/cookie keys at startup. Ordinary restarts retain them. Changing the connection password and restarting is the owner-operated “disconnect all” action.

## Browser boundary

Login/consent submissions require the canonical Origin, an interaction-bound HMAC CSRF value, and the provider's signed interaction cookie. Password comparisons use constant-time hashes. Cookies are Secure, HttpOnly, and SameSite=Lax. Interaction pages are not frameable and do not load third-party assets. HTML values are escaped. Only same-origin form actions and the ChatGPT return origin are permitted by CSP.

Form bodies are capped at 4 KiB, authorization starts at 60/minute, and interaction POSTs at 20/minute across the instance. These fixed global counters deliberately do not trust caller-supplied IP headers. Users sharing an instance share these limits.

The provider sees the configured canonical HTTPS host/protocol rather than caller-controlled forwarded headers. This does not provide TLS on port 8765: TLS termination at the tunnel remains required. Requests to MCP with an unrelated browser Origin are denied. Server-to-server clients normally omit Origin.

## Validation

Run `npm ci && npm test` in the add-on directory with Node 24+ and `jq` available. Tests run a real local HTTP bridge with temporary databases and no production Home Assistant credentials. They cover positive OAuth/MCP flows and security failures. The write test uses an unreachable Home Assistant target and must be rejected by the write gate before any HA request.

Live acceptance after installation:

1. Check public health/discovery through the actual tunnel.
2. Complete ChatGPT OAuth login and consent.
3. Call `get_home_overview` against the real Home Assistant installation.
4. Confirm writes are blocked with `write_access: false`.
5. If writes are desired, enable them, restart/reconnect, and perform a user-approved configuration change with read-back.

References: [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth), [oidc-provider documentation](https://github.com/panva/node-oidc-provider/tree/main/docs), [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization).
