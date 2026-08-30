#!/usr/bin/env bash
#
# Deploy (or roll back) one service.
#
#   sudo bash deploy.sh api
#   sudo bash deploy.sh bot
#
# Builds the new revision, restarts the unit, and verifies it actually came
# up. If it does not, the previous commit is rebuilt and restarted before the
# script exits non-zero — so a bad push leaves a running server, not a dead
# one discovered by a cashier at the till.

set -euo pipefail

TARGET="${1:?usage: deploy.sh <api|bot>}"
SERVICE_USER=hisvex

case "$TARGET" in
  api) DIR=/opt/hisvex/api; UNIT=hisvex-api; HEALTH="http://127.0.0.1:4000/api/health" ;;
  bot) DIR=/opt/hisvex/bot; UNIT=hisvex-bot; HEALTH="" ;;
  *)   echo "noma'lum: $TARGET (api yoki bot)"; exit 1 ;;
esac

log()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m!! %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "sudo bilan ishga tushiring"; exit 1; }
[[ -d "$DIR/.git" ]] || { fail "$DIR git repo emas"; exit 1; }

run_as() { sudo -u "$SERVICE_USER" -H "$@"; }

build() {
  # --include=dev because typescript is a devDependency and NODE_ENV=production
  # makes npm skip those, which fails the build with "tsc: not found".
  run_as npm --prefix "$DIR" ci --include=dev --silent
  run_as npm --prefix "$DIR" run build --silent
}

verify() {
  systemctl is-active --quiet "$UNIT" || return 1
  [[ -z "$HEALTH" ]] && { sleep 5; systemctl is-active --quiet "$UNIT"; return $?; }
  for _ in $(seq 1 30); do
    curl -fsS --max-time 5 "$HEALTH" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

PREVIOUS="$(run_as git -C "$DIR" rev-parse HEAD)"
log "Hozirgi revizi: ${PREVIOUS:0:8}"

log "Kod yangilanmoqda"
run_as git -C "$DIR" fetch --quiet origin
run_as git -C "$DIR" reset --hard --quiet "origin/$(run_as git -C "$DIR" rev-parse --abbrev-ref HEAD)"
TARGET_REV="$(run_as git -C "$DIR" rev-parse HEAD)"

if [[ "$PREVIOUS" == "$TARGET_REV" ]]; then
  log "O'zgarish yo'q — qayta ishga tushirish bilan cheklanamiz"
fi

log "Build"
build

log "Qayta ishga tushirish: $UNIT"
systemctl restart "$UNIT"

log "Tekshiruv"
if verify; then
  log "OK — ${TARGET_REV:0:8} ishlayapti"
  systemctl is-enabled --quiet "$UNIT" || systemctl enable --quiet "$UNIT"
  exit 0
fi

fail "Yangi reviziya ko'tarilmadi — ${PREVIOUS:0:8} ga qaytarilmoqda"
journalctl -u "$UNIT" -n 30 --no-pager || true

run_as git -C "$DIR" reset --hard --quiet "$PREVIOUS"
build
systemctl restart "$UNIT"

if verify; then
  fail "Qaytarildi: ${PREVIOUS:0:8} ishlayapti. Yangi kod deploy qilinmadi."
else
  fail "QAYTARISH HAM MUVAFFAQIYATSIZ — servis o'chiq. journalctl -u $UNIT -n 100"
fi
exit 1
