# Changelog

## 0.2.0

- Add browser OAuth using oidc-provider: required S256 PKCE, ChatGPT CIMD/signed-client support, exact-callback public-client fallback, owner login and consent.
- Persist OAuth tokens/grants and signing/session keys across restarts; rotate refresh tokens and revoke on replay or configuration changes.
- Enforce token audience, scope, owner and live grant before MCP access; add CSRF protections, strict redirects and login rate limits.
- Default new installations to read-only; legacy bearer-key access now requires explicit opt-in.
- Add public URL/callback options, web-only setup instructions, a locked dependency install and HTTP integration tests.

## 0.1.1

- Preserve an explicit `write_access: false` when loading add-on options. The previous startup expression incorrectly enabled writes for that value.
- Correct setup documentation: distinguish built-in OAuth MCP from the custom bearer-only bridge, and document the ChatGPT web compatibility gap.

## 0.1.0

- Initial private MVP.
- Read areas, devices, entities, automations, scripts, and dashboards.
- Create/update automations and scripts.
- Create and save storage-mode Lovelace dashboards.
- Home Assistant configuration validation.
- Bearer authentication and optional write lock.
