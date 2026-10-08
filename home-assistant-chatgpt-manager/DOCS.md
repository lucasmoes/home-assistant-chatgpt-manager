# Home Assistant ChatGPT Manager

This app runs the custom MCP management bridge next to Home Assistant.

**ChatGPT web is not yet supported by this bridge:** it uses a bearer API key and has no OAuth implementation. See the [main setup guide](../README.md) for the separate built-in Home Assistant OAuth connection, installation steps, and troubleshooting.

## Configuration

### `api_key`

Required. Use a long random value. Clients must send it as a bearer token to `/mcp`.

### `write_access`

When `false`, write tools remain visible but return a permission error. Read tools continue to work. Save and restart after changing it; verify the value at `/health`. Use version 0.1.1 or later: 0.1.0 incorrectly treated an explicit `false` as `true` at startup.

### `log_level`

Accepted logging preference. The current bridge loads this value but does not yet use it to filter log output.

## Endpoints

- `GET /health` — unauthenticated liveness check
- `/mcp` — authenticated Streamable HTTP MCP endpoint

## Home Assistant access

When installed as a Home Assistant app, the bridge talks to Home Assistant Core through:

- REST: `http://supervisor/core/api`
- WebSocket: `ws://supervisor/core/websocket`

It authenticates with the `SUPERVISOR_TOKEN` injected by Home Assistant.

## Development outside Home Assistant

You can run the bridge outside Home Assistant by setting:

```text
HA_BASE_URL=http://homeassistant.local:8123/api
HA_WS_URL=ws://homeassistant.local:8123/api/websocket
HA_TOKEN=<long-lived-access-token>
BRIDGE_API_KEY=<development-key>
WRITE_ACCESS=true
PORT=8765
```

Then run `npm install && npm run dev`.
