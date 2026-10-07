# Home Assistant ChatGPT Manager

Private MVP for managing a Home Assistant installation from ChatGPT through an MCP server.

This project is intentionally focused on **configuration and maintenance**, not on replacing Home Assistant Assist or acting as a voice assistant.

## What the MVP can manage

- Discover Home Assistant areas, devices, and entities
- Inspect entity state and metadata
- Inspect, create, and update automations
- Inspect, create, and update scripts
- List, create, inspect, and replace storage-mode Lovelace dashboard configuration
- Run Home Assistant's configuration validation
- Keep write operations behind an explicit bridge setting

Delete/destructive tools and arbitrary shell/file access are intentionally not included in the first version.

## Architecture

```text
ChatGPT
   |
   | MCP over HTTPS
   v
public URL / tunnel (development)
   |
   v
Home Assistant ChatGPT Manager app
   |
   | Home Assistant Core REST + WebSocket APIs
   | SUPERVISOR_TOKEN
   v
Home Assistant
```

For the first private test, expose port `8765` with a secure HTTPS tunnel and connect ChatGPT to `<public-url>/mcp`.

The later multi-user version will replace the development tunnel with an LLabs gateway. The Home Assistant app will keep an outbound authenticated connection to that gateway, so users do not need to expose Home Assistant itself.

## Repository layout

```text
home-assistant-chatgpt-manager/
├── home-assistant-chatgpt-manager/   # Home Assistant app/add-on + MCP bridge
├── plugin/                           # ChatGPT plugin package source
├── gateway/                          # Multi-user gateway design/roadmap
├── .github/workflows/
└── repository.yaml
```

## Install the Home Assistant app

### While this GitHub repository is private

Use Home Assistant's local app/add-on development path: copy the `home-assistant-chatgpt-manager/` folder into the Home Assistant local apps directory (`/addons/home-assistant-chatgpt-manager`), reload the app store, and install **Home Assistant ChatGPT Manager** from the local apps section.

Do not put a GitHub personal access token in documentation or commit it to the repository just to make a private app-store URL work.

### After the repository is shareable/public

1. In Home Assistant, open **Settings → Apps → App store**.
2. Open **Repositories**.
3. Add:
   `https://github.com/lucasmoes/home-assistant-chatgpt-manager`
4. Install **Home Assistant ChatGPT Manager**.

Then set a strong `api_key`, leave `write_access` enabled if ChatGPT should be allowed to create/update configuration, and start the app.

The app uses Home Assistant's internal Supervisor proxy and `SUPERVISOR_TOKEN`; no Home Assistant long-lived access token is required when installed through Home Assistant.

## Local/development test

The MCP endpoint is:

```text
http://<HOME_ASSISTANT_IP>:8765/mcp
```

Health check:

```text
http://<HOME_ASSISTANT_IP>:8765/health
```

The MCP endpoint requires:

```http
Authorization: Bearer <your api_key>
```

ChatGPT requires a public HTTPS MCP endpoint. During development, expose port `8765` with a temporary HTTPS tunnel such as Cloudflare Tunnel or ngrok, then connect ChatGPT to:

```text
https://<your-tunnel-host>/mcp
```

Use the same `api_key` as the bearer credential.

## ChatGPT plugin

`plugin/` contains the private plugin instructions and manifest.

The private plugin can be installed as a skills-only plugin immediately. Its MCP binding is deliberately not hard-coded until a real public HTTPS endpoint exists. `plugin/mcp.json.example` shows the final binding.

For quick MCP testing, ChatGPT can also create a custom MCP plugin directly from the public `/mcp` endpoint. Once the hosted gateway exists, the final plugin will include `mcp.json` and users will only need to install one plugin.

## Security model

- Home Assistant credentials stay inside the Home Assistant app.
- The external MCP endpoint is protected by a separate bearer API key.
- No generic REST proxy, shell command, or arbitrary filesystem tool is exposed.
- No delete tools in v0.1.
- Write tools respect the `write_access` app setting.
- The model is instructed to inspect existing configuration before changing it.
- The final public version should use per-user OAuth/pairing through the LLabs gateway rather than a shared static token.

## Next milestones

1. Install and test the app on one Home Assistant instance.
2. Verify the read tools with MCP Inspector.
3. Expose the MCP endpoint through a temporary HTTPS tunnel.
4. Connect ChatGPT and test automation/script/dashboard writes.
5. Add automated integration tests.
6. Build the outbound LLabs gateway/pairing flow.
7. Replace the development bearer-key connection with OAuth.
8. Prepare the plugin for sharing/public submission.
