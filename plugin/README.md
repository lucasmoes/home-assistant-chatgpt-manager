# ChatGPT plugin source

This folder contains the ChatGPT-side plugin package.

## Current private MVP

The plugin manifest and Home Assistant management skill can be installed privately now.

The actual MCP server URL is **not** committed because there is not yet a stable public endpoint. `mcp.json.example` documents the binding.

For the first end-to-end test:

1. Install/start the Home Assistant app.
2. Expose port `8765` through a secure HTTPS tunnel.
3. In ChatGPT, add a custom MCP server using `https://<tunnel>/mcp`.
4. Configure bearer authentication with the app's `api_key`.
5. Use the Home Assistant Manager plugin/skill in the same workflow.

After the LLabs gateway is deployed, copy `mcp.json.example` to `mcp.json`, replace the URL with the real stable HTTPS MCP endpoint, and update the private plugin. That final package will be shareable without each user editing plugin files.
