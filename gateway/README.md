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

A temporary HTTPS tunnel to the add-on works only with clients that can supply its bearer API key. It does not make the add-on compatible with ChatGPT web.

Before advertising a working ChatGPT connection, implement and test OAuth discovery, authorization-code flow with S256 PKCE, login/consent, token expiry/revocation, and protected-resource validation. Before sharing one plugin across households, also implement pairing, installation isolation, and disconnect/revocation. Use an established OAuth provider where possible. The diagram above describes a planned service, not a deployed endpoint.
