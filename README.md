# Home Assistant ChatGPT Manager

Connect **ChatGPT web** to a Home Assistant add-on that can inspect entities and manage automations, scripts, and dashboards. Your laptop does not run the connection. No desktop ChatGPT app, local MCP proxy, or terminal is required for normal setup.

**Version 0.2.0 adds browser-based OAuth authentication.** Install/update the add-on, give it a public HTTPS address, and sign in from ChatGPT. Each person connects to their own Home Assistant installation.

> The implementation is covered by automated OAuth/MCP integration tests. A live ChatGPT connection to a user's installed add-on still needs to be verified after deployment. The shared multi-household gateway remains a separate future feature.

## What you need

- Home Assistant with the app/add-on store (usually Home Assistant OS), on `amd64` or `aarch64`.
- ChatGPT web with **Add custom MCP server** available on your account/workspace.
- A dedicated public HTTPS address routed to the add-on on **port 8765**, for example through Cloudflare Tunnel. An existing Home Assistant Cloud URL routes to Core; it does not automatically expose this add-on.
- A password manager to generate a unique connection password of at least 32 random characters.

## Set up in the browser

### 1. Install or update the add-on

In Home Assistant:

1. Go to **Settings → Apps → App store → menu → Repositories**. Older releases call Apps “Add-ons.”
2. Add `https://github.com/lucasmoes/home-assistant-chatgpt-manager`.
3. Install **Home Assistant ChatGPT Manager**, or refresh/check for updates and update your existing installation to **0.2.1 or later**.
4. Open **Configuration** and set the connection password (`api_key`). Keep it in your password manager. Do not paste it into a ChatGPT message.

### 2. Route a dedicated HTTPS hostname to the add-on

For example, if you already use Cloudflare Tunnel, add a published application route to your existing tunnel:

| Route field | Example |
| --- | --- |
| Public hostname | `ha-manager.YOUR-DOMAIN` |
| Service type | HTTP |
| Service URL | `http://YOUR-HA-LAN-IP:8765` |
| Path filter | Leave blank: route the entire hostname |

Use the Home Assistant address reachable **from the tunnel connector**. If its dashboard provides separate Type and URL fields, select HTTP and enter only `YOUR-HA-LAN-IP:8765` in URL. Keep the existing Home Assistant dashboard route separate.

The whole hostname must reach this add-on: `/mcp`, `/oauth/*`, `/interaction/*`, and `/.well-known/*` are all needed. Preserve request methods, query strings, cookies, and Authorization headers. A separate Cloudflare Access sign-in page can block ChatGPT’s server-to-server requests; this endpoint uses the add-on’s own OAuth login. Do not expose port 8765 directly to the public internet.

### 3. Configure and start the add-on

Fill in these settings through Home Assistant’s configuration form:

| Setting | Value |
| --- | --- |
| `api_key` / Connection password | Your generated password, at least 32 characters |
| `public_url` / Public HTTPS address | `https://ha-manager.YOUR-DOMAIN` — **no `/mcp` suffix** |
| `oauth_redirect_uri` | Leave the default for now |
| `allow_legacy_api_key` | `false` |
| `write_access` | `false` for read-only access; `true` to allow configuration changes |

Save and start/restart the add-on. Open `https://ha-manager.YOUR-DOMAIN/health` in your browser. Confirm `version` is `0.2.0` or later and `oauth_enabled` is `true`.

Also open `https://ha-manager.YOUR-DOMAIN/.well-known/oauth-authorization-server`. It should return JSON with your HTTPS issuer, OAuth endpoints, and `code_challenge_methods_supported: ["S256"]`.

These checks show that routing and discovery work; the next step verifies login and MCP access.

### 4. Connect in ChatGPT web

Open **Plugins → Add custom MCP server**. Some surfaces call this **Settings → Apps → Advanced settings / Developer mode → Create**.

| Field | Value |
| --- | --- |
| Name | Home Assistant Manager — My Home |
| MCP URL | `https://ha-manager.YOUR-DOMAIN/mcp` |
| Authentication | OAuth |
| Client registration, if offered | Automatic / Client ID Metadata Document (CIMD) |

Save/install the connection. Choose **Connect** when prompted. Your browser opens the add-on’s **Connect your home** page:

1. Check that the address is your dedicated add-on hostname.
2. Enter the connection password from `api_key`. This is **not** your Home Assistant account password.
3. Review the access requested and choose **Allow connection**.
4. Return to ChatGPT and start a new chat with the connected plugin selected.

The add-on fetches ChatGPT’s published client metadata and validates signed client assertions when requested. You do not need to create a client secret or install desktop software.

#### Manual OAuth fallback

If automatic client registration is unavailable, use **User-defined OAuth client**:

| Field | Value |
| --- | --- |
| Client ID | `home-assistant-manager` |
| Client secret | Leave empty |
| Token endpoint auth method | `none` (public client with required PKCE) |
| Authorization URL | `https://ha-manager.YOUR-DOMAIN/oauth/authorize` |
| Token URL | `https://ha-manager.YOUR-DOMAIN/oauth/token` |
| Authorization server / issuer | `https://ha-manager.YOUR-DOMAIN` |
| Scope, if requested | `ha:manage` |

Copy the **exact callback URL shown by ChatGPT** into the add-on’s `oauth_redirect_uri`, save, and restart. The default is `https://chatgpt.com/connector_platform_oauth_redirect`; callback-specific `https://chatgpt.com/connector/oauth/...` URLs are also accepted. Wildcards and non-ChatGPT callbacks are rejected.

If your UI requires a client secret and cannot select `none`, use automatic CIMD instead. Do **not** substitute your connection password as an OAuth client secret. Dynamic Client Registration (DCR) is not exposed; choose CIMD or the manual public-client settings above.

### 5. Verify the connection

Ask ChatGPT:

> Use get_home_overview to inspect my Home Assistant. Do not change anything.

Confirm real tool results return. Then ask it to list existing automations or dashboards. A visible plugin card or generated YAML is not proof of a connection.

To allow edits, set `write_access: true`, save/restart, and reconnect OAuth so you can approve the increased access. The tools include `create_automation`, `update_automation`, `create_script`, `update_script`, `create_dashboard`, and `save_dashboard`.

## Upgrading an existing connection

- **Old URL ends with `/api/mcp`:** that is Home Assistant’s built-in MCP server, not this manager. Create/update the ChatGPT connection to your dedicated add-on address ending in `/mcp`. Updating the plugin’s instructions alone cannot change your tunnel or install the new add-on.
- **Old bearer client:** direct API-key authentication now requires `allow_legacy_api_key: true`. Leave it off for ChatGPT web.
- Existing Home Assistant settings may retain their previous values. Check `write_access` explicitly after updating.
- The built-in MCP Server integration is not required for this add-on. Do not change its OAuth settings using this guide: it is a different server.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| No custom MCP option in ChatGPT | Check account/workspace availability and developer/app settings. The add-on cannot enable a missing ChatGPT feature. |
| `/health` returns Home Assistant HTML, 404, or a proxy sign-in page | The hostname must reach the add-on on port **8765**, not Core on 8123, and all paths must be routed. |
| `oauth_enabled: false` | Set `public_url` to the dedicated HTTPS origin, save, and restart. |
| Startup rejects the password | Use at least 32 characters for `api_key`; generate a random password. |
| PKCE/S256 error | Check the discovery JSON at the add-on hostname. Version 0.2.0 advertises and enforces S256. If absent, check the route and installed version. |
| Registration endpoint missing | Select CIMD/automatic metadata or manual public client; this server does not implement DCR. |
| Invalid redirect/client | Use the custom manager’s client ID and endpoints above, not built-in Home Assistant OAuth settings. For manual setup copy the exact callback into `oauth_redirect_uri`. |
| `invalid_origin` when submitting sign-in or consent | Update the add-on to 0.2.1 or later, then start a fresh connection. Version 0.2.0 sent a referrer policy that caused browsers to submit `Origin: null`. |
| Login expired / interaction error | Enable cookies, use the public HTTPS hostname, and start Connect again. Login interactions expire after 10 minutes. |
| Wrong password | Enter the add-on’s connection password, not a Home Assistant account password. After 20 POST attempts in a minute, wait a minute. |
| Login works but MCP returns 401 | Reconnect after password, URL, callback, or write-permission changes. Verify you are still using the correct `/mcp` endpoint. |
| Health works but Home Assistant reads fail | Health is only a liveness check. Inspect add-on logs for Supervisor/Core API access problems. |
| Writes disabled | Enable `write_access`, save/restart, and reconnect OAuth to approve the change. |
| Changed the public URL | Update `public_url`, restart, and update/recreate the ChatGPT connection with the new address. |

Include versions, endpoint path, exact error, and sanitized logs when reporting issues. Never include passwords, tokens, cookies, or authorization codes.

## Authentication and access

The add-on uses the maintained [`oidc-provider`](https://github.com/panva/node-oidc-provider) library for authorization-code OAuth, S256 PKCE, token issuance, rotation, revocation, and client authentication. Access tokens last 10 minutes; refresh tokens rotate and grants expire after 30 days. Reusing a consumed refresh token revokes its grant. You may need to reconnect after grant expiry.

OAuth records, signing keys, and session keys persist in `/data/oauth/oauth.sqlite`, with owner-only permissions. Protect Home Assistant backups: they contain this authentication state and your add-on options. Ordinary restarts preserve connections. Changing the connection password, public URL, manual callback, or write permission and restarting revokes existing grants and browser sessions. To revoke all access, change the connection password and restart; turn off legacy API-key access if enabled.

This is a **single-household owner connection**. Anyone with its connection password can approve access to that home, subject to `write_access`; it is not Home Assistant user-level RBAC or a multi-tenant hosted service. Each household installs its own add-on and uses its own URL/password. The [future gateway](gateway/README.md) would remove the need for each household to configure a tunnel.

Home Assistant’s `SUPERVISOR_TOKEN` stays inside the add-on. There are no delete tools, arbitrary shell tools, or generic file-access tools. Dashboard saves replace the whole storage-mode configuration; always inspect and preserve it before editing.

## Developers

See [add-on configuration](home-assistant-chatgpt-manager/DOCS.md), [plugin packaging](plugin/README.md), and [authentication implementation](docs/authentication.md).

The automated suite exercises browser authorization through real HTTP requests, static and simulated ChatGPT CIMD/signed-client flows, MCP initialization, persistence, PKCE, replay, revocation, expiry, scope checks, CSRF, rate limits, redirect rejection, and write-access gating. It does not substitute for a live ChatGPT/Home Assistant deployment test.
