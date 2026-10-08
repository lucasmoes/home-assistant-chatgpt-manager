# Changelog

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
