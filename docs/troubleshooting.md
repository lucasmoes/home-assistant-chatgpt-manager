# Troubleshooting

| Symptom | Check |
| --- | --- |
| Health returns HTML, 404 or a proxy login | Route the entire hostname to add-on port **8765**, not Home Assistant Core on 8123. |
| `oauth_enabled: false` | Set `public_url` to the dedicated HTTPS origin, save and restart. |
| Startup rejects the password | Use at least 32 random characters for `api_key`. |
| Registration endpoint missing | Enable `oauth_dynamic_registration` for DCR, or use your client's manual/CIMD setup. |
| Invalid client or callback | Follow the client guide. `oauth_redirect_uri` is the legacy ChatGPT callback; generic clients belong in `oauth_clients`. |
| Login expired or password rejected | Use the manager's HTTPS page, allow cookies and enter the add-on password, not your Home Assistant password. Restart the connection after expiry. |
| Sign-in returns `invalid_origin` | Use the configured public origin and a current add-on version; do not strip the browser's Origin header. |
| Authentication succeeds but tools do not load | The MCP URL must end in `/mcp`. Refresh tools or recreate a wrongly addressed connection. |
| MCP returns 401 after configuration changes | Reconnect OAuth; password and authorization-policy changes invalidate grants. |
| Health works but Home Assistant reads fail | Check Supervisor/Core API access in the add-on logs. Health is a liveness check only. |
| Writes are disabled | Configure a separate `approval_password`, set `write_access: true`, save/restart and reconnect. Follow the browser review link before applying. |
| A create/update tool returns a proposal | Expected since 0.4.0. The owner approves the exact change at `/manage`; the proposing client then calls `apply_approved_change`. |
| Change is stale or expired | Read the latest configuration and create a fresh proposal for owner review. |
| Apply is uncertain or unverified | Inspect the actual Home Assistant target. Do not assume failure means no write. Use a saved version to propose restoration if appropriate. |
| Your AI app has no custom MCP option | Check account/workspace support. Server configuration cannot add a missing client feature. |

The logs report fixed categories without credentials or home data:

- `missing-token`: unauthenticated request; initial discovery probes can be normal.
- `token-rejected`: invalid, expired or revoked credentials.
- `origin-rejected`: a browser request came from another origin.
- `accepted`: authentication succeeded; check the response and tool result next.

Repeated 401s without an accepted response indicate an authentication problem. If no MCP requests appear, check the URL and tunnel. Do not disable authentication to satisfy an unauthenticated probe.

Login POSTs are limited to 20/minute; registration attempts to 10/minute. Wait before retrying. For registration capacity and other limits, see [client registration](clients.md).

When reporting a problem, include the add-on/client versions, endpoint path, exact error and sanitized logs. Never include passwords, tokens, cookies, authorization codes or the OAuth database.
