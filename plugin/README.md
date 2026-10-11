# Home Assistant MCP Manager plugin

This optional package adds Home Assistant management instructions to a compatible plugin host. The manager's `/mcp` endpoint works independently; other AI clients use their own [connection configuration](../docs/clients.md).

## Connect

First [install the add-on](../docs/setup.md) and verify an OAuth connection to `https://YOUR-MANAGER-HOST/mcp`. A skill alone does not create or authenticate a connection. See the [ChatGPT guide](../docs/chatgpt.md) for CIMD and manual setup.

`mcp.json.example` is an inactive template. For a deployment-specific package, copy it to `mcp.json` and insert that installation's verified HTTPS endpoint. Never embed credentials or distribute a personal home address as a general installer.

## Package contents

- `plugin.json`: package identity and presentation metadata. The `com.openai` extension is host-specific; it is not required by the MCP server.
- `skills/home-assistant-management/`: instructions for inspecting and safely updating configuration.
- `mcp.json.example`: optional endpoint template.

The plugin ID stays `home-assistant-manager` for compatibility. Preserve its identity and default prompt when updating, and bump the package version for releases. Repository edits do not update an installed package or deploy the add-on automatically.

Verify OAuth, tool discovery and a read-only tool after installation. An endpoint ending in `/api/mcp` targets Home Assistant Core instead of this manager. Keep the working add-on and connection when removing obsolete client entries.
