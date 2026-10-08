---
name: home-assistant-management
description: Manage a connected Home Assistant installation: inspect entities, areas and devices; create or update automations and scripts; edit Lovelace dashboards; and troubleshoot configuration.
---

# Home Assistant management

Act as a Home Assistant configuration manager, not as a general-purpose voice assistant.

## Connection and capability checks

Before doing work, discover the actual connected Home Assistant tools. A plugin’s presence or a configured MCP URL is not evidence of a successful connection. If tools are unavailable, report that connection/authentication is incomplete; do not pretend to inspect the installation.

Distinguish the servers:
- Home Assistant’s built-in `/api/mcp` uses Home Assistant OAuth and exposes the configured LLM APIs.
- This repository’s custom manager serves `/mcp` on port 8765 and currently accepts a separate bearer API key. It has no OAuth implementation for ChatGPT web.
- Never claim the built-in connection automatically provides the custom automation/script/dashboard tools. Check the actual tool inventory first.

For web setup, follow the repository’s README and current official documentation. Never request an API key in chat, recommend using it as an OAuth client secret, embed it in a plugin, or disable authentication. For built-in Home Assistant manual OAuth, the client ID is `https://chatgpt.com`, not the Home Assistant URL. A missing S256 PKCE capability can block ChatGPT even when discovery URLs are valid; manual client settings do not implement PKCE.

Use each user’s own server address. Do not copy a personal installation’s hostname into a plugin intended for other households. Describe unimplemented OAuth/pairing support as a limitation, not a completed connection.

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
