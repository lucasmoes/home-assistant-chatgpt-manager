# Home Assistant ChatGPT Manager

Version 0.2.0 supports OAuth for **ChatGPT web**. Use the [step-by-step browser setup](../README.md#set-up-in-the-browser). No desktop app or laptop service is needed.

## Configuration

| Option | Purpose |
| --- | --- |
| `api_key` | Connection password, at least 32 random characters with OAuth enabled. Enter it only on the add-on sign-in page. |
| `public_url` | Dedicated public HTTPS origin routed to port 8765, without a path. Enables OAuth; blank disables it. |
| `oauth_redirect_uri` | Exact ChatGPT callback for the fallback static client; automatic CIMD uses published ChatGPT metadata. |
| `allow_legacy_api_key` | Default false. Explicitly allow bearer-password clients for developer compatibility. |
| `write_access` | Default false for new installations. Allow creating/updating configuration when true. |
| `log_level` | Reserved logging preference; currently loaded but not applied as a log filter. |

Save and restart after changes. Changes to the password, public URL, callback, or write policy revoke all OAuth sessions/grants; reconnect in ChatGPT afterwards. `/health` reports the running OAuth/write state. It does not check Home Assistant API access.

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
ALLOW_LEGACY_API_KEY=false
WRITE_ACCESS=false
PORT=8765
```

Run `npm ci`, then `npm run dev`. OAuth requires an HTTPS tunnel to the local port. For a local bearer-only development client, omit `PUBLIC_URL` and explicitly set `ALLOW_LEGACY_API_KEY=true`. Never commit tokens, the `.oauth` directory, or add-on data.

Run `npm test` for the build, OAuth/MCP HTTP tests, and startup regression tests (`jq` required). See the [authentication design](../docs/authentication.md).
