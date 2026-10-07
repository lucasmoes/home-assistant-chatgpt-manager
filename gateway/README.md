# Gateway roadmap

The gateway is intentionally not implemented in v0.1.

## Goal

Allow one public ChatGPT plugin to connect securely to many users' Home Assistant installations without exposing each Home Assistant instance to the internet.

```text
ChatGPT
   |
   v
https://mcp.llabs.nl/mcp
   |
   v
LLabs gateway
   |
   | authenticated outbound session
   v
Home Assistant Manager app
   |
   v
Home Assistant Core
```

## Intended responsibilities

- User authentication
- Home Assistant installation pairing
- Per-installation public identity
- Outbound persistent connection from the Home Assistant app
- MCP request routing to the correct installation
- Short-lived authorization/session tokens
- Audit metadata for configuration writes
- No long-term persistence of entity/state/configuration payloads unless explicitly required

## Not for v0.1

For the private MVP use a temporary HTTPS tunnel directly to the Home Assistant app. This keeps the first milestone small and proves the MCP tool design before building multi-user infrastructure.
