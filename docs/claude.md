# Connect Claude to Home Assistant Manager

Claude web and desktop support custom remote MCP connectors. This project offers a dedicated **public OAuth client** for Claude alongside the existing ChatGPT client; the Home Assistant tools and authentication password are shared.

## Requirements

- Home Assistant ChatGPT Manager add-on built from this Claude-support branch (until released).
- Your existing dedicated HTTPS hostname pointing to the add-on port **8765**, not Home Assistant Core.
- Add-on setting `public_url: https://ha-manager.YOUR-DOMAIN` (origin only) and a strong `api_key`. Keep `allow_legacy_api_key: false`.
- Claude account with custom connector support. If you plan to edit automations, enable `write_access: true` in the add-on before connecting.

## Claude setup

1. Update/rebuild the add-on with this change, then restart. The server will **not** use new code until it is deployed.
2. In Claude web or desktop open **Settings → Connectors → Add custom connector** (the menu may differ by plan).
3. Set the server name to `Home Assistant Manager` and the remote MCP URL to `https://ha-manager.YOUR-DOMAIN/mcp`.
4. Under **Advanced OAuth settings**, if Claude requests manual client details, enter:
   - **Client ID:** `home-assistant-manager-claude`
   - **Client secret:** leave blank (public OAuth client / PKCE); **never** paste your add-on `api_key` here.
   - **Authorization URL:** `https://ha-manager.YOUR-DOMAIN/oauth/authorize`
   - **Token URL:** `https://ha-manager.YOUR-DOMAIN/oauth/token`
   - **Scope (if requested):** `ha:manage`
   - **Redirect/callback URL (server-registered):** `https://claude.ai/api/mcp/auth_callback`
5. Connect and approve the add-on's password login and consent screen.
6. In a Claude chat, request: *Use get_home_overview to inspect my Home Assistant. Do not change anything.*

If Claude requires an OAuth client secret and will not accept a blank one, **this release cannot complete that connection**. It does not implement Dynamic Client Registration (DCR), and its Claude client is public/PKCE-only. Do not enable legacy API keys to work around that. Claude also has reported callback problems with some third-party OAuth MCP connectors.

## Troubleshooting

- The MCP endpoint is `/mcp`, not `/oauth/authorize` or Home Assistant Core's `/api/mcp`.
- Open `https://ha-manager.YOUR-DOMAIN/health` and `/.well-known/oauth-authorization-server` to verify routing/discovery.
- If Claude reports `invalid_client`, check the exact client ID above and whether its advanced OAuth settings actually allow public clients.
- If consent succeeds but Claude cannot exchange the code, inspect sanitized add-on logs and the Claude connector error; this does not prove the Home Assistant API is broken.
- ChatGPT remains configured with its existing OAuth client and URL. Do not change `oauth_redirect_uri` to Claude's callback.

**Security:** The connection password belongs only on the add-on's own HTTPS login page. Each assistant receives its own scoped, short-lived OAuth token. An accepted connector with `write_access: true` can modify Home Assistant configuration.
