# Tools and change review

Version 0.4.0 exposes **62 tools**: the existing 18 plus 44 setup, diagnostic and change-management tools. All write tools prepare a proposal. Only `apply_approved_change` can write to Home Assistant, after owner browser approval. Read tools remain available with `write_access: false`.

## Tool catalogue

| Area | Tools |
| --- | --- |
| Home inspection | `get_home_overview`, `list_areas`, `list_devices`, `list_entities`, `get_entity` |
| Automations | `list_automations`, `get_automation`, `create_automation`, `update_automation`, `set_automation_enabled`, `get_automation_traces` |
| Scripts | `list_scripts`, `get_script`, `create_script`, `update_script` |
| Dashboards | `list_dashboards`, `get_dashboard`, `create_dashboard`, `save_dashboard`, `add_dashboard_view`, `add_dashboard_card`, `update_dashboard_card`, `move_dashboard_card` |
| Change review | `preview_configuration_change`, `validate_configuration_change`, `apply_approved_change`, `get_change_history` |
| Recovery | `list_configuration_versions`, `preview_configuration_restore` |
| Diagnostics | `validate_config`, `get_entity_history`, `get_system_health`, `get_error_logs`, `find_entity_references`, `check_configuration_references` |
| Helpers | `list_helpers`, `get_helper`, `propose_helper_change`, `create_helper`, `update_helper` |
| Scenes | `list_scenes`, `get_scene`, `propose_scene_change`, `create_scene`, `update_scene` |
| Areas and floors | `create_area`, `update_area`, `list_floors`, `create_floor`, `assign_area_to_floor` |
| Devices and entities | `assign_device_to_area`, `rename_device`, `rename_entity` |
| Labels | `list_labels`, `create_label`, `assign_label` |
| Zones | `list_zones`, `create_zone`, `update_zone` |
| Blueprints | `list_blueprints`, `import_blueprint`, `create_automation_from_blueprint` |

## Example workflow

Ask: “Add a lights card to the living-room dashboard, preserving the other cards.”

The client reads the dashboard, then calls `add_dashboard_card`. You receive the field changes, submitted configuration, validation result, expiry and review link. Open that link, sign in using your separate approval password, and approve the exact proposal. Ask the same client to apply its `change_id` with `apply_approved_change`.

The server revalidates the proposal and compares the current target with its original snapshot. If different, it rejects the change. Successful applies create before/after versions and an audit entry. Approvals cannot be supplied as a tool parameter, and a different client cannot apply another client's proposal. All legacy bearer connections share one client identity; use OAuth for distinct clients.

## Supported configuration

- **Automations/scripts/scenes:** UI-managed configuration APIs. Updates replace full documents; preserve unrelated fields. Scene tools use configuration ids, not `scene.*` names; `list_scenes` includes the registry unique id when available. Imported/YAML scenes may not be editable. Disabling an automation does not stop an already-running sequence.
- **Helpers:** editable storage collections for `input_boolean`, `input_number`, `input_text`, `input_select`, `input_datetime`, `counter`, and `timer`. Supply `domain` and `config`; updates use the storage id returned by `list_helpers`. HA assigns creation ids. YAML helpers and other helper types are not supported.
- **Areas/floors/labels:** registry fields. Create tools accept `config` with `name`. Zone creation also requires `latitude` and `longitude`; optional `radius` is in metres. `list_zones` covers editable storage zones, excluding the special home zone and YAML zones.
- **Dashboard cards:** zero-based view/card indexes, with `section_index` for section views. Move destinations are indexed after removing the source. Nested stack/grid cards can be replaced as a whole. Only storage-mode saves are supported. New dashboard URL paths must contain a hyphen, such as `living-room`.
- **Blueprints:** automation blueprints from supported HTTPS GitHub or Home Assistant Community URLs. HA fetches the source; the proposal freezes the returned YAML so approval applies to those exact bytes. Existing paths are never overwritten. Importing a blueprint does not create an automation; use `create_automation_from_blueprint` afterwards.
- **Validation:** manager structure checks, literal entity/service references, area/floor/label references, and blueprint input substitution. HA performs authoritative validation when saving. Templates, custom cards and integration-specific options are not fully checked. `validate_config` checks the current HA configuration, not an unsaved proposal.

These tools use Home Assistant's HTTP configuration APIs and WebSocket commands. Availability depends on your HA version, loaded integrations and administrator permissions. Unsupported APIs return errors; there is no fallback to editing `.storage` or arbitrary files. The tests use mocked API contracts; live acceptance against your installation is still required.

## Diagnostics and recovery limits

History requires Recorder and accepts up to 20 entities over at most 7 days. Traces depend on HA's stored trace retention. Health is a basic core/entity summary, not complete Supervisor or integration diagnostics. Error logs use `system_log/list`, optional filtering, and best-effort credential scrubbing; free-form logs can still include sensitive information.

Reference scanning covers readable automations, scripts and dashboards and reports skipped items. It is not a complete search of templates, blueprints, external YAML or custom components. Entity-id renames may require follow-up edits to those references.

Snapshots cover manager-touched configuration, not a full Home Assistant backup. `preview_configuration_restore` creates a new proposal with normal approval and conflict checks. It does not undo the side effects of running automations, delete newly created objects, or restore imported blueprint files. Restoring a prior entity name/id may fail if the old id has since been reused.

Applies are serialized within one manager process. HA APIs do not provide an atomic compare-and-swap or cross-resource transaction; another HA editor can still race after the final check. Dashboard creation plus initial configuration can partially succeed. `uncertain` means a request or read-back failed after apply began; `applied_unverified` means the read-back differs. Inspect HA before recovery. Neither status is automatically retried, including after a restart.

Records expire for approval after 24 hours but remain in the audit store. Password/connection-policy changes revoke pending approvals. The SQLite store is owner-readable only and persists beneath `OAUTH_DATA_DIR/changes`; it contains private configuration. The store caps proposal creation at 10,000 records. If reached, stop the add-on, preserve a protected backup, and archive the changes store before starting a new one; archived history is not available through the live tools.

## API references

The implementation follows Home Assistant's [WebSocket API](https://developers.home-assistant.io/docs/api/websocket/), [configuration APIs](https://github.com/home-assistant/core/tree/dev/homeassistant/components/config), [storage collection commands](https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/collection.py), and [blueprint commands](https://github.com/home-assistant/core/blob/dev/homeassistant/components/blueprint/websocket_api.py).
