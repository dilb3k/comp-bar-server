#!/usr/bin/env bash
#
# Post-migration check. Confirms the new host is actually serving the API
# correctly rather than just answering on port 443.
#
#   bash smoke.sh https://api.hisvex.uz

set -uo pipefail
BASE="${1:?usage: smoke.sh <https://api.example.com>}"
BASE="${BASE%/}"

pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
no()   { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }

echo "Tekshirilmoqda: $BASE"

# TLS — an expired or mismatched cert is invisible to curl -k but fatal to the
# Android client, which refuses the connection outright.
if curl -fsS --max-time 15 "$BASE/api/health" >/dev/null 2>&1; then
  ok "TLS va /api/health"
else
  no "TLS yoki /api/health javob bermadi"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/api/health")
[[ "$code" == 200 ]] && ok "/api/health → 200" || no "/api/health → $code"

# The version endpoint proves the release-feed integration survived the move
# (it makes an outbound call to GitHub, so it also proves egress works).
ver=$(curl -s --max-time 20 "$BASE/api/meta/app-version" | tr -d ' \n')
if echo "$ver" | grep -q '"latest"'; then
  ok "/api/meta/app-version → $(echo "$ver" | grep -oE '"latest":"[^"]+"')"
else
  no "/api/meta/app-version noto'g'ri javob: ${ver:0:120}"
fi

# An unauthenticated protected route must be refused, not served. If this
# returns 200 the auth middleware is not wired up on the new host.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/api/products")
[[ "$code" == 401 || "$code" == 403 ]] \
  && ok "/api/products himoyalangan ($code)" \
  || no "/api/products $code qaytardi — 401 kutilgandi"

# Proxy headers: without X-Forwarded-For every request looks like 127.0.0.1
# and the per-IP rate limiter throttles all tenants as if they were one.
hdr=$(curl -s -o /dev/null -D - --max-time 15 "$BASE/api/health" | tr -d '\r')
echo "$hdr" | grep -qi "^server:" && ok "nginx javob bermoqda" || no "nginx sarlavhasi yo'q"

# HTTP must redirect to HTTPS, not serve in the clear.
loc=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "${BASE/https:/http:}/api/health")
if [[ "$loc" == https://* ]]; then
  ok "HTTP → HTTPS yo'naltirish"
else
  no "HTTP yo'naltirilmadi (loc: ${loc:-bo\'sh})"
fi

echo
echo "  $pass o'tdi, $fail xato"
[[ $fail -eq 0 ]]
