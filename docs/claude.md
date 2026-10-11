# Claude setup

Install add-on version 0.3.0 or later and follow the [shared setup guide](setup.md). Update and restart the running add-on before connecting.

1. Enable `oauth_dynamic_registration: true` in the add-on, save and restart. This changes the authorization policy and requires existing connections to reconnect.
2. In Claude's **Customize → Connectors**, add a custom connector (organization owners use organization settings).
3. Use the name **Home Assistant MCP Manager** and URL `https://YOUR-MANAGER-HOST/mcp`.
4. Choose OAuth/sign-in and **Register automatically**. Do not choose Claude's published identity: this release's CIMD allowlist covers ChatGPT only. DCR registers a separate client without hardcoded provider IDs.
5. Sign in on the manager's own HTTPS page with the add-on connection password, inspect the client/callback shown, and approve.
6. Enable the connector in a conversation and request a read-only `get_home_overview` check.

For manual public-client setup, DCR can stay disabled. Choose your own OAuth client, ID `home-assistant-manager-claude`, no secret, callback `https://claude.ai/api/mcp/auth_callback`, scope `ha:manage`. The authorization and token endpoints are `/oauth/authorize` and `/oauth/token` on your public origin. Leave the legacy `oauth_redirect_uri` option alone; it belongs to ChatGPT. If the UI requires a secret, use automatic registration; the DCR endpoint supports generated `client_secret_basic` and `client_secret_post` credentials as well as public clients. Never use the connection password as a client secret.

All clients require PKCE and owner approval. If a callback changes, register it via DCR or a new configured public client rather than loosening the existing preset. For `invalid_client`, check the chosen registration mode and discovery. The remote endpoint must be reachable by Claude's servers.

Automated tests cover the Claude callback through login, consent, token issuance, refresh, revocation and MCP initialization. Live Claude verification remains pending.

[Official Claude connector setup](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp). Menus and availability may vary by account.
