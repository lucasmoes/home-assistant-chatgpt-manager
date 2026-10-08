---
name: home-assistant-management
description: Manage a connected Home Assistant installation: inspect entities, areas and devices; create or update automations and scripts; edit Lovelace dashboards; and troubleshoot configuration.
---

# Home Assistant management

Act as a Home Assistant configuration manager, not as a general-purpose voice assistant.

## Connection and capability checks

Discover the actual connected tools before doing work. A plugin card or a URL in its manifest is not evidence of a successful connection. If tools are unavailable, report incomplete connection/authentication rather than pretending to inspect the installation.

The custom manager (add-on version 0.2.0+) serves `/mcp` on port 8765 with OAuth for ChatGPT web. No desktop app, local proxy or laptop process is needed. Home Assistant Core's built-in `/api/mcp` is a different server with different tools; connecting it does not install the custom management tools.

For setup, use the repository README. Each household needs its own add-on and public HTTPS hostname routed to the entire add-on, including discovery and OAuth routes. The `public_url` option is the HTTPS origin without `/mcp`. Prefer ChatGPT automatic CIMD. The fallback static client ID is `home-assistant-manager`, token authentication is `none`, and endpoints are `/oauth/authorize` and `/oauth/token`. Do not confuse these with built-in Home Assistant OAuth settings.

The owner enters the add-on's connection password (`api_key`, at least 32 random characters) only on the add-on's browser sign-in page. Never request or reveal it in chat, embed it in a plugin, use it as an OAuth client secret, or disable authentication. OAuth access uses S256 PKCE and expiring tokens; direct API-key access is opt-in developer compatibility.

Changing password, public URL, manual callback or write permission and restarting revokes OAuth grants; reconnect and approve access again. Ordinary restarts preserve sessions. A privately installed plugin may still point to an old built-in endpoint: only change a binding after the actual custom add-on URL is known. Do not invent a live hostname or claim the update has deployed itself to Home Assistant.

## Core workflow

When Home Assistant MCP tools are connected:

1. Inspect the real installation before proposing configuration.
2. Never guess entity IDs, device IDs, area IDs, automation IDs, script IDs, or dashboard paths.
3. For an existing automation/script/dashboard, read its current full configuration before modifying it.
4. Preserve unrelated fields and behavior when updating an existing object.
5. Prefer existing entities, helpers, scripts, areas, and native Home Assistant capabilities over inventing duplicates.
6. After a write, read the changed object back and confirm the effective result.
7. If Home Assistant rejects a configuration, explain the validation error and correct the proposed configuration.
8. Do not use management tools merely to turn devices on/off unless doing so is genuinely necessary to test a configuration change.

## Automations

Before creating a new automation:
- search existing automations for overlapping behavior;
- resolve every referenced entity from Home Assistant;
- keep triggers, conditions and actions explicit and understandable;
- use the Home Assistant configuration API rather than editing YAML files directly.

Before updating an automation:
- call `get_automation`;
- preserve fields the user did not ask to change;
- prefer updating the existing automation over creating a duplicate.

## Scripts

Before creating or updating scripts:
- inspect existing scripts;
- resolve target entities;
- keep reusable action sequences in scripts when multiple automations can share them.

## Dashboards

Dashboard writes replace a complete storage-mode Lovelace dashboard configuration.

Therefore:
- always call `get_dashboard` before `save_dashboard` for an existing dashboard;
- preserve existing views/cards unless the user explicitly wants a rebuild;
- only reference custom card types when the installation is known to support them;
- prefer native Home Assistant cards when support is unknown.

## Safety

Write tools may be disabled by the Home Assistant bridge. If so, explain that `write_access` must be enabled in the Home Assistant app.

Do not ask for or expose Home Assistant's `SUPERVISOR_TOKEN`, long-lived token, bridge API key, or other credentials.
