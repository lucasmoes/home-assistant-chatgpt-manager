# Home Assistant ChatGPT Manager

Manage Home Assistant configuration with MCP tools for entities, automations, scripts, and dashboards.

> **Connection status:** the custom management add-on currently uses a bearer API key. It does **not** yet implement the OAuth flow required by ChatGPT web. Installing it and adding a tunnel is not enough to connect it to ChatGPT. The browser setup below connects **Home Assistant’s built-in MCP server**, which is a separate service with different tools.

## Choose your setup

| What you want | Setup | Current status |
| --- | --- | --- |
| Connect ChatGPT in a browser to Home Assistant’s exposed LLM tools | [Browser setup](#browser-setup-home-assistants-built-in-mcp) | Uses Home Assistant OAuth; compatibility depends on your Core version and the client’s OAuth requirements |
| Use this repository’s automation, script, and dashboard management tools | [Custom add-on](#custom-management-add-on) | Available to MCP clients that accept a bearer API key; ChatGPT web OAuth is not implemented |
| Give other people one plugin that connects to their own home | [Sharing](#sharing-with-other-people) | Requires the planned OAuth/pairing gateway; not available yet |

No terminal on your computer is needed for the browser setup if you already have a working public HTTPS Home Assistant address.

## Browser setup: Home Assistant’s built-in MCP

### 1. Prepare Home Assistant

1. Open Home Assistant in your browser. Record your **Home Assistant Core version** from Settings → About; use a supported, up-to-date release.
2. Open **Settings → Devices & services → Add integration** and add **Model Context Protocol Server**. Select the **Server** integration, not the “Model Context Protocol” client integration.
3. Review the integration’s configuration and select the LLM APIs/entities you want to expose. If the integration requires an administrator, use an administrator account when connecting.
4. You need a public HTTPS address that reaches Home Assistant, such as your Home Assistant Cloud remote URL or your own reverse proxy/tunnel. A local IP address or `homeassistant.local` is not reachable from ChatGPT’s servers.
5. For a custom domain, set Home Assistant’s **Settings → System → Network → Home Assistant URL / External URL** to that exact HTTPS origin. Configure trusted proxy headers according to the [HTTP integration documentation](https://www.home-assistant.io/integrations/http/#reverse-proxies) when using a reverse proxy.

In the examples below, replace `https://YOUR-HA-HOST` with **your own** public Home Assistant address. Do not use someone else’s server.

### 2. Add the MCP connection in ChatGPT

Open **Plugins → Add custom MCP server**. Some ChatGPT surfaces label this **Settings → Apps → Advanced settings / Developer mode → Create**. Availability and labels depend on your account/workspace. If the option is absent, check your workspace’s app/developer settings.

Enter:

| Field | Value |
| --- | --- |
| Name | Home Assistant — My Home |
| MCP server URL | `https://YOUR-HA-HOST/api/mcp` |
| Authentication | OAuth |

Try the advertised OAuth discovery first. If client registration fails and manual OAuth settings are available, use **Advanced OAuth settings → User-defined OAuth client**:

| Field | Value |
| --- | --- |
| OAuth client ID | `https://chatgpt.com` |
| OAuth client secret | Leave blank if optional; otherwise enter placeholder text such as `unused` |
| Token endpoint authentication method | `client_secret_post` |
| Authorization URL | `https://YOUR-HA-HOST/auth/authorize` |
| Token URL | `https://YOUR-HA-HOST/auth/token` |
| Authorization server base / issuer | `https://YOUR-HA-HOST` |

Home Assistant ignores the client secret. **Do not enter the add-on API key, a Home Assistant access token, or your Home Assistant password into that field.** The client ID is ChatGPT’s origin, not your Home Assistant URL.

These manual values address client-registration issues. They do not add missing PKCE support to the server. If ChatGPT reports a PKCE/S256 error, see [Troubleshooting](#troubleshooting) before retrying.

### 3. Authorize and verify

1. Create/save the connection and install or connect the resulting plugin when prompted.
2. Complete the sign-in on **your Home Assistant website**, then approve the connection and return to ChatGPT.
3. Start a new chat, select the connected Home Assistant plugin, and ask: **“List the available Home Assistant tools and show a read-only overview. Do not change anything.”**
4. Confirm that actual tool results come back from your home. A visible plugin card or a generated YAML suggestion alone does not prove that it is connected.

The built-in endpoint exposes the configured Home Assistant LLM APIs. Connecting it does **not** install this repository’s `create_automation`, `update_script`, or `save_dashboard` tools. Check the actual available tools before expecting those management features.

## Custom management add-on

Use this section for the custom tools implemented in this repository. It is currently a developer setup for an MCP client with bearer-header support, **not a working ChatGPT web connection recipe**.

### 1. Install

Requires Home Assistant with an app/add-on store (typically Home Assistant OS), on `amd64` or `aarch64`.

1. Open **Settings → Apps → App store → menu → Repositories**. Older releases call Apps “Add-ons.”
2. Add `https://github.com/lucasmoes/home-assistant-chatgpt-manager`.
3. Find **Home Assistant ChatGPT Manager** and install it.
4. In Configuration, set `api_key` to a unique random password generated by your password manager (at least 32 random characters is recommended).
5. Set `write_access: false` for the first connection test, save, and start the app.
6. Open the app’s Logs tab and confirm it is listening on port `8765`.

If the repository is private, the normal repository URL installation is not sufficient. A developer must copy the add-on folder into `/addons/home-assistant-chatgpt-manager` and reload the store. Do not embed GitHub credentials in the repository URL.

Home Assistant Container/Core installations without Supervisor cannot use this store installation. See [development configuration](home-assistant-chatgpt-manager/DOCS.md#development-outside-home-assistant).

### 2. Verify the add-on

From your local network, open `http://YOUR-HA-IP:8765/health` in a browser. It should return:

```json
{"status":"ok","service":"home-assistant-chatgpt-manager","version":"0.1.1","write_access":false}
```

This checks that the bridge is running; it does not prove that Home Assistant API calls or MCP authentication work.

In a compatible MCP client, set:

| Field | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `http://YOUR-HA-IP:8765/mcp` on a trusted local network |
| Request header | `Authorization: Bearer <the add-on api_key>` |

Use the client’s secure credential settings. Do not commit the key in `mcp.json` or share it in a chat. An unauthenticated request to `/mcp` should return `401`; that is expected.

Run `get_home_overview` as the first read-only test. Enable `write_access` in the add-on configuration and restart it only when you want to allow configuration changes. Confirm `/health` reports the intended value after a restart.

### 3. Remote access and ChatGPT web

For a bearer-capable remote client, a dedicated HTTPS tunnel hostname must route to the **add-on’s port 8765**, preserving `/mcp` and the Authorization header. A hostname routed to Home Assistant’s port 8123 reaches a different server. Use HTTPS for remote credentials; never forward an unauthenticated management endpoint to the internet.

For **ChatGPT web**, stop here: the add-on still needs an OAuth 2.1 authorization-code flow with S256 PKCE, discovery metadata, token validation, and an appropriate login/consent flow. A URL in the plugin manifest does not implement any of these. Do not disable authentication to make the connection succeed.

## Troubleshooting

| Symptom | Check / next action |
| --- | --- |
| Plugin appears, but no Home Assistant tools | Installing instructions is separate from connecting a server. Complete the MCP connection and use a new chat. |
| `/api/mcp` versus `/mcp` confusion | `/api/mcp` belongs to Home Assistant Core. `/mcp` on port 8765 belongs to this add-on. Their credentials and tools differ. |
| OAuth client registration / `invalid_client` error | For built-in MCP, use the manual settings above. Home Assistant advertises client-ID metadata documents rather than a DCR registration endpoint. |
| PKCE or `S256` error | Open `https://YOUR-HA-HOST/.well-known/oauth-authorization-server`. ChatGPT requires advertised `code_challenge_methods_supported` containing `S256`. Missing metadata is a compatibility blocker; check for a Core update that implements the required support. If still missing, direct connection remains blocked. Do not just inject the field into a proxy: the authorization/token implementation must enforce PKCE too. |
| Invalid issuer or relative OAuth URLs | Confirm External URL and forwarded headers. The discovery document must have the exact public HTTPS issuer and absolute authorization/token URLs. |
| Cloudflare login page instead of OAuth metadata | An extra proxy login can prevent ChatGPT from reaching MCP/discovery. Configure the intended authenticated MCP access path; a successful browser session alone does not prove server-to-server access. |
| `401 Unauthorized` before sign-in | Expected for a protected endpoint. After sign-in, check which server you connected to and its credential type. An add-on key will not authenticate built-in MCP. |
| Add-on `Missing ... BRIDGE_API_KEY` | Set its `api_key`, save, and restart. |
| `/health` works but tools fail | Check add-on logs for Supervisor/Core access errors; health is only a liveness check. |
| Writes disabled | Check `write_access`, save/restart the add-on, and read `/health` again. Version 0.1.1 fixes a startup bug that ignored an explicit `false`. |
| Login works but management tools are missing | Built-in MCP and the custom manager expose different tools. Connecting the former does not enable the latter. |

When reporting a problem, include Core version, add-on version, endpoint path, exact error, and sanitized logs. Never include passwords, API keys, access/refresh tokens, or OAuth authorization codes.

## Sharing with other people

Each household needs its **own** Home Assistant instance and authorization. Do not distribute a plugin bound to your personal hostname as a general installer.

The [`plugin/`](plugin/) folder contains reusable management instructions and an **inactive** endpoint example. It intentionally contains no live server binding or credentials. Users can follow the built-in MCP setup above with their own address; that still does not connect the custom manager.

The planned one-plugin setup is: install add-on → authorize/pair your home → use the management tools. It requires the [gateway implementation](gateway/README.md), per-user OAuth and installation isolation. Those components are not implemented or deployed, so the project is not yet a one-click public service.

## Tools and security

The custom bridge can inspect areas/devices/entities, read/create/update automations and scripts, manage storage-mode Lovelace dashboards, and run Home Assistant configuration validation. It has no delete tools, arbitrary shell access, or generic file access. Dashboard saves replace the complete dashboard configuration; read and preserve it before updating.

Home Assistant credentials stay in the add-on. It uses Supervisor’s injected `SUPERVISOR_TOKEN` internally; the separate `api_key` protects incoming MCP requests. `write_access` gates configuration changes.

## References

- [Home Assistant MCP Server setup and OAuth](https://www.home-assistant.io/integrations/mcp_server/)
- [OpenAI plugin authentication requirements](https://developers.openai.com/plugins/build/auth)
- [Connect a custom MCP server to ChatGPT](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [Add-on configuration and development](home-assistant-chatgpt-manager/DOCS.md)

Instructions reviewed against the official documentation on 2026-10-08. The current live connection has not been verified through a completed user OAuth login.
