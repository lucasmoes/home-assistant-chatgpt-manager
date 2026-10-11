# Changelog

## 0.3.0

- Present the server/add-on as Home Assistant MCP Manager while retaining the installed slug, directory, plugin identity, repository URL and existing OAuth client IDs.
- Isolate ChatGPT/Claude presets and add configurable public OAuth clients.
- Add opt-in RFC 7591 dynamic registration with public or generated-secret authentication, registration limits and metadata validation.
- Show actual client labels and callbacks in consent, with an interaction-specific form CSP.
- Preserve ChatGPT CIMD/signed assertions, PKCE, resource binding, persistent tokens, refresh rotation and write gating.
- Add multi-client setup guides and HTTP regression tests. Live Claude/Gemini CLI deployment verification is still pending.

## 0.2.2

- Add safe MCP connection diagnostics: request method, origin category, authentication outcome and response status, without credentials or request contents.
- Test OAuth-authenticated initialization, notifications and discovery of all 18 tools across separate stateless requests.

## 0.2.1

- Fix browser sign-in and consent failing with `invalid_origin`: use a same-origin referrer policy on interaction pages so form submissions retain their Origin header.
- Keep strict origin validation, CSRF checks and no-referrer policy on other OAuth endpoints.

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
