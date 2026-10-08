# Home Assistant Manager plugin

This package provides management instructions. It does not itself deploy an MCP server or authenticate a user.

## Connect from ChatGPT web

Follow the [browser setup in the main README](../README.md#browser-setup-home-assistants-built-in-mcp) to connect Home Assistant’s built-in MCP using OAuth. Use your own Home Assistant URL. The built-in tools are separate from this repository’s custom management tools.

The custom add-on only accepts a bearer API key today. ChatGPT web requires OAuth; do not enter that key as an OAuth client secret or suggest that a tunnel alone completes setup.

## Endpoint example

`mcp.json.example` is an inactive template for the **custom management bridge**. It is not loaded as a connection. Only copy it to `mcp.json` after you have a real endpoint compatible with your target client and have verified its authentication. A ChatGPT web deployment requires OAuth to be implemented first.

For the built-in server, create the connection in ChatGPT using your own `https://YOUR-HA-HOST/api/mcp` URL and the README’s OAuth instructions. Do not silently replace a custom management binding with the built-in endpoint: they expose different capabilities.

Never put API keys or tokens in the package. Never publish a reusable package bound to a personal Home Assistant hostname. The privately installed owner-specific plugin may retain its own binding; it is not the distribution template.

## Before release

- Preserve the plugin name and default prompt; bump its version for updates.
- Discover the actual connected tools before promising any capability.
- Test a read-only tool after login and verify the target household.
- Confirm that automation/script/dashboard tools really exist before testing writes.
- The planned multi-user OAuth/pairing gateway is not implemented. See [its roadmap](../gateway/README.md).
