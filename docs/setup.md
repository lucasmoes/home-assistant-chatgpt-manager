# Installation and setup

## Install the add-on

In Home Assistant, open **Settings → Apps → App store → Repositories** (older versions use **Add-ons**), add `https://github.com/lucasmoes/home-assistant-mcp-manager`, and install **Home Assistant MCP Manager**. Supported architectures are `amd64` and `aarch64`.

## Route a public HTTPS hostname

Use a dedicated hostname for the manager, such as `ha-manager.example.com`. Route it through an HTTPS tunnel or reverse proxy to the add-on's HTTP listener on port **8765**.

For a Cloudflare Tunnel published application route:

| Field | Example |
| --- | --- |
| Public hostname | `ha-manager.example.com` |
| Service type | HTTP |
| Service URL | `http://YOUR-HA-LAN-IP:8765` |
| Path filter | Empty — route the entire hostname |

Use the Home Assistant address reachable from the tunnel connector. If Type and URL are separate fields, enter only `YOUR-HA-LAN-IP:8765` in URL.

Route `/mcp`, `/oauth/*`, `/interaction/*` and `/.well-known/*`. Preserve methods, query strings, cookies and Authorization headers. A separate proxy sign-in page can block AI clients; this server provides its own OAuth login. Keep port 8765 behind HTTPS termination rather than exposing it directly to the internet.

Home Assistant Cloud and the main dashboard normally reach Core on port 8123. They do not automatically expose this add-on. Core's built-in `/api/mcp` is a separate integration with different tools.

## Configure and connect

Set `api_key` to a unique random password of at least 32 characters and `public_url` to your HTTPS origin, without `/mcp`. Start with `write_access: false` and `allow_legacy_api_key: false`. Enable `oauth_dynamic_registration` only if using DCR. See [all options](../home-assistant-mcp-manager/DOCS.md).

Save and start/restart the add-on. Check:

- `https://YOUR-MANAGER-HOST/health` returns JSON with `oauth_enabled: true`.
- `https://YOUR-MANAGER-HOST/.well-known/oauth-authorization-server` returns your issuer, OAuth endpoints and S256 PKCE support.

Connect the client to `https://YOUR-MANAGER-HOST/mcp`: [ChatGPT](chatgpt.md), [Claude](claude.md), [Gemini CLI](gemini.md) or [another client](clients.md). `/oauth/authorize` belongs in OAuth settings, never in the MCP URL.

Enter the connection password only on your manager's HTTPS sign-in page. Review the client, callback and permissions before approving. Refresh tools and request a read-only `get_home_overview` check. Health and successful login alone do not confirm Home Assistant data access.

## Enable configuration changes

Set `write_access: true`, save/restart and reconnect your AI clients to approve the changed access. This permits creating/updating automations, scripts and dashboards for all authorized clients. Dashboard saves replace the complete storage-mode configuration; inspect and preserve it before editing.

## Existing installations

The repository and source directory are now named `home-assistant-mcp-manager`. Use the new repository URL for setup and development. The internal add-on slug remains `home_assistant_chatgpt_manager` to preserve its installed identity; OAuth client IDs, plugin ID and `/data/oauth` storage are also unchanged. Do not uninstall a working add-on just to change its visible name. Keep a backup when changing Home Assistant repository entries.

Ordinary restarts preserve connections. Changing the password, public URL, legacy callback, additional clients, DCR setting or write access revokes OAuth state at restart. Reconnect affected clients. Changing the password and restarting is the “disconnect all” operation.

For old connections, check the saved endpoint: `/api/mcp` points to Core; `/oauth/authorize` is an authorization endpoint. Replace either with the manager's `/mcp` connection. Keep the working add-on while replacing obsolete client entries.

## Verification status

Automated tests cover ChatGPT CIMD, Claude and generic public clients, DCR, loopback callbacks, token isolation, persistence and write gating. Prior live ChatGPT authentication/tool discovery used version 0.2.2. Live upgraded-client checks, Claude/Gemini CLI connections and real Home Assistant read/write acceptance remain to be verified after deployment.
