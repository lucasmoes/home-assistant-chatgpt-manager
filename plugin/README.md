# Home Assistant Manager plugin

This optional instruction package complements the custom management add-on's MCP connection from **ChatGPT web**. The custom MCP plugin can connect without installing this separate package. A skill alone does not create or authenticate a connection. No desktop app is required.

Follow the [main setup guide](../README.md#set-up-in-the-browser): update the add-on to 0.2.2+, route a dedicated HTTPS hostname to port 8765, set its `public_url` and connection password, then connect `https://YOUR-MANAGER-HOST/mcp` using OAuth in ChatGPT. Prefer automatic CIMD; the README provides manual public-client settings as a fallback.

Use `/mcp` as the **Server URL**; `/oauth/authorize` belongs only in OAuth settings. The live setup on 2026-10-11 verified automatic CIMD, a connected account, tool refresh, and authenticated MCP responses with add-on 0.2.2. See the main guide's [verification status](../README.md#verification-status) for the limits of that check.

`mcp.json.example` is an inactive endpoint template. For a deployment-specific package, copy it to `mcp.json` only after verifying that installation's real HTTPS URL. Never embed a password/token in the package. Never distribute someone else's personal Home Assistant hostname as a general installer.

An already-installed private plugin may have an owner-specific binding. If that binding ends with `/api/mcp`, it targets Home Assistant Core's built-in MCP, not this custom manager. Update the connection to the verified add-on URL after deployment; updating skill instructions alone does not reroute the connection.

After verifying a replacement custom MCP connection, uninstall obsolete connectors and this separate instruction package if it is no longer wanted. Keep the running add-on and working connection. Uninstalling a package removes its installed bundled skill, not the source files here. Repository instruction changes do not update an already-installed package or its OAuth binding automatically.

The root package intentionally has no live binding, because each household hosts its own add-on. A single shared plugin with outbound pairing still requires the [future gateway](../gateway/README.md).

Before release, preserve plugin identity/default prompt, bump the version, verify OAuth login and a read-only tool, and confirm that the actual automation/script/dashboard tools are exposed before attempting writes.
