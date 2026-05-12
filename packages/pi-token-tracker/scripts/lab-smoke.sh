#!/usr/bin/env bash
#
# lab-smoke.sh — fast end-to-end check of pi-token-tracker against the
# token-tracker repo's lab. No browser, no LLM key.
#
# Requires: the package is built (`npm run build` at the monorepo root), and
# the token-tracker lab is up (`cd ~/GitHub/token-tracker && make lab`).
#
# What it does:
#   - `token-tracker install` into a throwaway pi settings.json
#   - `token-tracker login` (RFC 8628 device flow), auto-approved by hitting
#     the lab IdP's `/device?user_code=...&login=<lab user>` page
#   - `token-tracker status` — signed in, refresh token stored
#   - drives one synthetic assistant turn through the *built* extension
#     (loads dist/extension, fires session_start / message_end / session_shutdown)
#   - asserts a `usage_log` row landed with `user_id` from the verified token
#
# Env knobs: LAB_API (http://localhost:7080), LAB_IDP (http://localhost:7019),
#            PG_CONTAINER (token-tracker-postgres-1), LAB_USER (lab-user@example.invalid).
set -uo pipefail

LAB_API="${LAB_API:-http://localhost:7080}"
LAB_IDP="${LAB_IDP:-http://localhost:7019}"
PG_CONTAINER="${PG_CONTAINER:-token-tracker-postgres-1}"
LAB_USER="${LAB_USER:-lab-user@example.invalid}"
PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI=(node "$PKG_DIR/dist/cli/index.js")

PASS=0 FAIL=0
ok()  { printf '  \033[32mok  \033[0m %s\n' "$*"; PASS=$((PASS + 1)); }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL + 1)); }
_pg() { docker exec "$PG_CONTAINER" psql -U token_tracker -d token_tracker -At -c "$1" 2>/dev/null; }

if [[ ! -f "$PKG_DIR/dist/cli/index.js" ]]; then
	echo "dist/ not built — run 'npm run build' at the monorepo root first." >&2
	exit 1
fi
if ! curl -sf "$LAB_API/health" >/dev/null 2>&1; then
	echo "lab API not reachable at $LAB_API — is the token-tracker lab up? (cd ~/GitHub/token-tracker && make lab)" >&2
	exit 1
fi

echo "== pi-token-tracker lab smoke — API $LAB_API, IdP $LAB_IDP =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SETTINGS="$TMP/pi-settings.json"
export TOKEN_TRACKER_CONFIG_DIR="$TMP/cfg"

# 1. install
"${CLI[@]}" install --pi-settings="$SETTINGS" >/dev/null 2>&1
if grep -q "pi-token-tracker/dist/extension" "$SETTINGS" 2>/dev/null; then
	ok "install — extension registered in pi settings.json"
else
	bad "install — extension not registered"
fi

# 2. login — device flow, auto-approved
"${CLI[@]}" login --endpoint="$LAB_API" --authority="$LAB_IDP" --client-id=lab-cli \
	--api-scope=api://token-tracker-api/access_as_user --pi-settings="$SETTINGS" >"$TMP/login.out" 2>&1 &
login_pid=$!
user_code=""
for _ in $(seq 1 50); do
	user_code="$(grep -oE 'code: [A-Za-z0-9-]+' "$TMP/login.out" 2>/dev/null | awk '{print $2}' | head -1)"
	[[ -n "$user_code" ]] && break
	sleep 0.2
done
if [[ -z "$user_code" ]]; then
	bad "login — no user code emitted"
	kill "$login_pid" 2>/dev/null
else
	curl -sS "$LAB_IDP/device?user_code=${user_code}&login=${LAB_USER}" >/dev/null 2>&1
	wait "$login_pid"
	login_rc=$?
	if [[ "$login_rc" -eq 0 && -f "$TOKEN_TRACKER_CONFIG_DIR/auth.json" ]]; then
		ok "login — device flow completed, auth.json written"
	else
		bad "login — exit $login_rc"
		sed 's/^/    /' "$TMP/login.out"
	fi
fi

# 3. status
"${CLI[@]}" status --pi-settings="$SETTINGS" >"$TMP/status.out" 2>&1
grep -q "Signed in as: ${LAB_USER}" "$TMP/status.out" && ok "status — signed in as ${LAB_USER}" || bad "status — $(tr '\n' ' ' <"$TMP/status.out")"
grep -q "Refresh token: stored" "$TMP/status.out" && ok "status — refresh token stored (silent refresh enabled)" || bad "status — refresh token not stored"

# 4. synthetic assistant turn through the built extension → OTLP → usage_log
before="$(_pg 'select count(*) from usage_log')"
node --input-type=module -e '
const ext = (await import(process.argv[1])).default;
const handlers = {};
ext({ on: (event, fn) => { (handlers[event] ??= []).push(fn); } });
for (const fn of handlers.session_start ?? []) await fn();
for (const fn of handlers.message_end ?? []) fn({ message: {
  role: "assistant", api: "anthropic-messages", provider: "anthropic",
  model: "smoke-model", responseModel: "smoke-model",
  usage: { input: 111, output: 22, cacheRead: 0, cacheWrite: 0, totalTokens: 133, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop", timestamp: Date.now(),
} });
for (const fn of handlers.session_shutdown ?? []) await fn();
' "$PKG_DIR/dist/extension/index.js" >/dev/null 2>&1
sleep 1
after="$(_pg 'select count(*) from usage_log')"
row="$(_pg 'select user_id, model, input_tokens, output_tokens, harness_name from usage_log order by ts desc limit 1')"
if [[ "${after:-0}" -gt "${before:-0}" && "$row" == "${LAB_USER}|smoke-model|111|22|pi" ]]; then
	ok "ingest — synthetic turn landed in usage_log (${row})"
else
	bad "ingest — before=${before:-?} after=${after:-?} row='${row}'"
fi

echo
echo "== ${PASS} passed, ${FAIL} failed =="
[[ "$FAIL" -eq 0 ]]
