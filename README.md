# Home Assistant MCP Manager

Connect your AI assistant to Home Assistant through [MCP](https://modelcontextprotocol.io/). Inspect your home and manage automations, scripts and dashboards from a conversation.

Runs as a self-hosted Home Assistant add-on. OAuth protects access, and configuration writes are disabled by default.

## What it can do

- Inspect entities, history, automation traces and error logs.
- Set up automations, scripts, helpers, scenes, areas, floors, labels and zones.
- Build dashboards and edit individual views or cards.
- Preview changes, approve them in your browser, and restore saved configuration versions.
- Connect multiple AI clients to the same installation.

## Supported clients

| Client | Connection guide |
| --- | --- |
| ChatGPT | [Automatic CIMD or manual OAuth](docs/chatgpt.md) |
| Claude | [Automatic registration or manual OAuth](docs/claude.md) |
| Gemini CLI | [Remote MCP with OAuth](docs/gemini.md) |
| Other MCP clients | [Client registration and requirements](docs/clients.md) |

Clients need Streamable HTTP MCP and OAuth support. Automated tests cover these authentication paths; live Claude and Gemini CLI verification is pending. Gemini CLI support does not imply support in the Gemini web or mobile app.

## Quick start

You need Home Assistant with the add-on store (`amd64` or `aarch64`), a compatible AI client, and a dedicated public HTTPS hostname.

1. Add this repository in **Settings → Apps → App store → Repositories** (called **Add-ons** in older Home Assistant versions):

   ```text
   https://github.com/lucasmoes/home-assistant-mcp-manager
   ```

2. Install **Home Assistant MCP Manager**.
3. Route your HTTPS hostname to the add-on on port **8765**, using a tunnel or reverse proxy. Route the entire hostname, including OAuth and discovery paths.
4. Configure the add-on:

   | Setting | Value |
   | --- | --- |
   | `api_key` | A unique random connection password, at least 32 characters |
   | `public_url` | Your HTTPS origin, such as `https://ha-manager.example.com` — no path |
   | `write_access` | `false` to start with read-only access |
   | `oauth_dynamic_registration` | Enable if your client uses automatic DCR registration |

   Leave other settings at their defaults unless your client guide says otherwise.

5. Start the add-on, then connect your AI client to **`https://ha-manager.example.com/mcp`** using OAuth. Follow its guide above and enter the password only on your manager's sign-in page.
6. Verify the connection with: **“Use get_home_overview to inspect my Home Assistant. Do not change anything.”**

See the [full setup guide](docs/setup.md) for routing, upgrades and enabling writes, or [troubleshooting](docs/troubleshooting.md) if the connection fails.

## Access and privacy

Each household hosts its own server. Home Assistant credentials stay inside the add-on; connected AI clients can receive home data through the tools you authorize. Anyone with the connection password can approve access, subject to the shared `write_access` setting.

To enable edits, configure a separate random `approval_password` (at least 32 characters), set `write_access: true`, restart and reconnect. Every write returns a preview and browser review link. Approve the exact change there, then ask the AI to apply it. Password or authorization-policy changes revoke existing connections. Never put passwords or tokens in chat or plugin files.

See the [62-tool guide](docs/tools.md) for supported operations and limitations.

## Development

Requires **Node.js 24+** and **jq**.

```sh
cd home-assistant-mcp-manager
npm ci
npm run typecheck
npm test
```

- [Add-on configuration and local development](home-assistant-mcp-manager/DOCS.md)
- [Authentication design](docs/authentication.md)
- [Optional plugin package](plugin/README.md)
