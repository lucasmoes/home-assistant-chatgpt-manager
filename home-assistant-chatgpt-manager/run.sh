#!/bin/sh
set -eu

OPTIONS_FILE="/data/options.json"

if [ ! -f "$OPTIONS_FILE" ]; then
  echo "No /data/options.json found. Is this running as a Home Assistant app?"
  exit 1
fi

API_KEY="$(jq -r '.api_key // empty' "$OPTIONS_FILE")"
WRITE_ACCESS_VALUE="$(jq -r 'if .write_access == null then false else .write_access end' "$OPTIONS_FILE")"
LOG_LEVEL_VALUE="$(jq -r '.log_level // "info"' "$OPTIONS_FILE")"

if [ -z "$API_KEY" ]; then
  echo "Configuration error: api_key is required."
  exit 1
fi

export PUBLIC_URL="$(jq -r '.public_url // ""' "$OPTIONS_FILE")"
export OAUTH_REDIRECT_URI="$(jq -r '.oauth_redirect_uri // "https://chatgpt.com/connector_platform_oauth_redirect"' "$OPTIONS_FILE")"
export ALLOW_LEGACY_API_KEY="$(jq -r '.allow_legacy_api_key // false' "$OPTIONS_FILE")"
export OAUTH_DATA_DIR="/data/oauth"
export BRIDGE_API_KEY="$API_KEY"
export WRITE_ACCESS="$WRITE_ACCESS_VALUE"
export LOG_LEVEL="$LOG_LEVEL_VALUE"
export PORT="${PORT:-8765}"
export HA_BASE_URL="${HA_BASE_URL:-http://supervisor/core/api}"
export HA_WS_URL="${HA_WS_URL:-ws://supervisor/core/websocket}"

exec node /app/dist/index.js
