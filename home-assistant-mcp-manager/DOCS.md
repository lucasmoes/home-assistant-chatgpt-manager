# Home Assistant MCP Manager

Connect compatible AI clients over remote MCP with OAuth. See [client registration](../docs/clients.md), [ChatGPT](../docs/chatgpt.md), [Claude](../docs/claude.md) and [Gemini CLI](../docs/gemini.md). New 0.3.0 functionality requires updating the running add-on. The internal slug and data directory remain stable for upgrades.

## Configuration

| Option | Purpose |
| --- | --- |
| `api_key` | Connection password, at least 32 random characters with OAuth enabled. Enter it only on the add-on sign-in page. |
| `public_url` | Dedicated public HTTPS origin routed to port 8765, without a path. Enables OAuth; blank disables it. |
| `oauth_redirect_uri` | Exact ChatGPT callback for the fallback static client; automatic CIMD uses published ChatGPT metadata. |
| `oauth_clients` | Default `[]`. Additional public clients: `client_id`, `client_name`, `redirect_uris`; see client guide. |
| `oauth_dynamic_registration` | Default false. Advertise RFC 7591 registration for compatible clients when enabled. |
| `allow_legacy_api_key` | Default false. Explicitly allow bearer-password clients for developer compatibility. |
| `write_access` | Default false for new installations. Allow creating/updating configuration when true. |
| `log_level` | Reserved logging preference; currently loaded but not applied as a log filter. |

Save and restart after changes. Changes to the password, public URL, callback, client list, DCR setting, or write policy revoke all OAuth sessions/grants; reconnect your AI clients afterwards. `/health` reports the running OAuth/write state. It does not check Home Assistant API access.

## Connect an AI client

Use `https://YOUR-MANAGER-HOST/mcp` as the MCP URL with OAuth. Keep `public_url` as the origin without a path. Follow the [client guides](../README.md#supported-clients) for registration settings and verify a read-only tool after connecting. See [troubleshooting](../docs/troubleshooting.md) for login or discovery failures.

## Home Assistant access

The add-on uses Supervisor's injected `SUPERVISOR_TOKEN` with `http://supervisor/core/api` and `ws://supervisor/core/websocket`. The token stays inside Home Assistant. No long-lived Home Assistant token is required for the add-on installation.

## Development outside Home Assistant

Requires Node 24+. Supply environment variables using a private environment/secret configuration:

```text
HA_BASE_URL=http://homeassistant.local:8123/api
HA_WS_URL=ws://homeassistant.local:8123/api/websocket
HA_TOKEN=<your-home-assistant-token>
BRIDGE_API_KEY=<your-random-connection-password>
PUBLIC_URL=https://your-manager-host
OAUTH_DATA_DIR=./.oauth
OAUTH_REDIRECT_URI=https://chatgpt.com/connector_platform_oauth_redirect
OAUTH_CLIENTS=[]
OAUTH_DYNAMIC_REGISTRATION=false
ALLOW_LEGACY_API_KEY=false
WRITE_ACCESS=false
PORT=8765
```

Run `npm ci`, then `npm run dev`. OAuth requires an HTTPS tunnel to the local port. For a local bearer-only development client, omit `PUBLIC_URL` and explicitly set `ALLOW_LEGACY_API_KEY=true`. Never commit tokens, the `.oauth` directory, or add-on data.

Run `npm test` for the build, OAuth/MCP HTTP tests, and startup regression tests (`jq` required). See the [authentication design](https://github.com/lucasmoes/home-assistant-mcp-manager/blob/main/docs/authentication.md).
