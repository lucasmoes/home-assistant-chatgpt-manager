# ChatGPT setup

Use the [shared add-on installation](setup.md), then connect the remote MCP URL `https://YOUR-MANAGER-HOST/mcp` in ChatGPT's custom MCP settings.

Choose OAuth and automatic **CIMD** for the existing ChatGPT integration. Its allowlisted metadata and signed client authentication remain supported. DCR can stay disabled. For manual public-client setup use `home-assistant-manager`, no client secret, scope `ha:manage`, and copy ChatGPT's exact callback to `oauth_redirect_uri`. That legacy option remains ChatGPT-specific; other clients belong in `oauth_clients`.

Authorization: `/oauth/authorize`; token: `/oauth/token`; resource: `/mcp`, all on the configured public origin. Enter the connection password only on the manager's own HTTPS sign-in page. Approve consent, refresh tools, and request a read-only `get_home_overview` check.

If choosing DCR instead of CIMD, enable `oauth_dynamic_registration` and restart before registering. Changing registration policy revokes existing connections; reconnect them.

[Official authentication requirements](https://developers.openai.com/plugins/build/auth). Prior live authentication/discovery used 0.2.2; the new version has automated regression coverage but still needs a live deployment check.
