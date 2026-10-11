# Gemini CLI setup

This guide is for **Gemini CLI**, whose remote MCP configuration supports OAuth. It makes no claim about custom connector support in the consumer Gemini web/mobile app.

After [installing the manager](setup.md), enable `oauth_dynamic_registration: true` and restart. In Gemini CLI's `settings.json`, add:

```json
{
  "mcpServers": {
    "home-assistant-manager": {
      "httpUrl": "https://YOUR-MANAGER-HOST/mcp",
      "oauth": {
        "enabled": true,
        "scopes": ["ha:manage"]
      }
    }
  }
}
```

Run `/mcp auth home-assistant-manager`, finish browser sign-in/consent and then use `/mcp` to check tool discovery. Request `get_home_overview` without changes. The CLI needs a local browser and a reachable loopback callback.

For manual registration with DCR disabled, configure a public client in the add-on:

```yaml
oauth_clients:
  - client_id: gemini-cli
    client_name: Gemini CLI
    redirect_uris:
      - http://localhost:8766/oauth/callback
```

Add `"clientId": "gemini-cli"` and `"redirectUri": "http://localhost:8766/oauth/callback"` to the CLI's `oauth` object, save/restart the add-on, and authenticate again. Use the same free port in both places. No client secret or Google API credential is required for the manager's OAuth flow.

The generic and loopback OAuth flows have automated coverage. An actual Gemini CLI connection has not yet been verified live. Consult the [official Gemini CLI MCP documentation](https://geminicli.com/docs/tools/mcp-server/) for version-specific configuration and troubleshooting.
