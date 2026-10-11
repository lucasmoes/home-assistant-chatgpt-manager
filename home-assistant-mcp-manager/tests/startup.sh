#!/bin/sh
# Exercise the actual startup script with temporary options and a stub node process.
set -eu
BRIDGE_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT HUP INT TERM
mkdir "$TEST_DIR/bin"
cat > "$TEST_DIR/bin/node" <<'NODE'
#!/bin/sh
printf '%s\n' "$WRITE_ACCESS"
NODE
chmod +x "$TEST_DIR/bin/node"
sed "s|OPTIONS_FILE=\"/data/options.json\"|OPTIONS_FILE=\"$TEST_DIR/options.json\"|" "$BRIDGE_ROOT/run.sh" > "$TEST_DIR/run.sh"
check() {
  printf '%s\n' "$1" > "$TEST_DIR/options.json"
  actual="$(PATH="$TEST_DIR/bin:$PATH" sh "$TEST_DIR/run.sh")"
  if [ "$actual" != "$2" ]; then
    printf 'Expected write access %s, got %s\n' "$2" "$actual" >&2
    exit 1
  fi
}
check '{"api_key":"test-only","write_access":false}' false
check '{"api_key":"test-only","write_access":true}' true
check '{"api_key":"test-only"}' false
check '{"api_key":"test-only","write_access":null}' false
printf '%s\n' '{"write_access":false}' > "$TEST_DIR/options.json"
if PATH="$TEST_DIR/bin:$PATH" sh "$TEST_DIR/run.sh" > "$TEST_DIR/error.txt" 2>&1; then
  printf 'Missing key should prevent startup\n' >&2
  exit 1
fi
printf 'Startup checks passed: false, true, defaults, missing API key.\n'

# Check the real startup mapping for structured clients and opt-in registration.
cat > "$TEST_DIR/bin/node" <<'NODE'
#!/bin/sh
printf '%s\n' "$OAUTH_CLIENTS" "$OAUTH_DYNAMIC_REGISTRATION" "$OAUTH_REDIRECT_URI"
NODE
check '{"api_key":"test-only"}' '[]
false
https://chatgpt.com/connector_platform_oauth_redirect'
check '{"api_key":"test-only","oauth_clients":[{"client_id":"local","client_name":"Local AI","redirect_uris":["http://localhost:8766/callback"]}],"oauth_dynamic_registration":true}' '[{"client_id":"local","client_name":"Local AI","redirect_uris":["http://localhost:8766/callback"]}]
true
https://chatgpt.com/connector_platform_oauth_redirect'
printf 'Client configuration startup checks passed.\n'
