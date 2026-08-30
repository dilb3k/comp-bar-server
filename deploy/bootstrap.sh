#!/usr/bin/env bash
#
# One-time server setup for a fresh Oracle Cloud Ampere A1 (ARM64) instance
# running Ubuntu 24.04. Idempotent: safe to re-run.
#
#   sudo bash bootstrap.sh api.example.com you@example.com
#
# Installs Node 22, nginx, certbot, fail2ban; creates the `hisvex` service
# user; opens the host firewall; issues TLS; installs the systemd units.
# It does NOT write any secrets — those go in /etc/hisvex/*.env afterwards.

set -euo pipefail

DOMAIN="${1:?usage: bootstrap.sh <domain> <email>}"
EMAIL="${2:?usage: bootstrap.sh <domain> <email>}"

SERVICE_USER=hisvex
APP_ROOT=/opt/hisvex
ENV_DIR=/etc/hisvex
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "root sifatida ishga tushiring (sudo)"; exit 1; }

log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl ca-certificates gnupg git nginx fail2ban \
  unattended-upgrades netfilter-persistent iptables-persistent

log "Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

# ---------------------------------------------------------------------------
# The Oracle firewall trap.
#
# Oracle's Ubuntu images ship an iptables ruleset whose INPUT chain ends in a
# blanket REJECT, and it is applied *inside* the VM — entirely separate from
# the Security List you edit in the web console. Opening 80/443 in the console
# and nowhere else is the single most common reason a new Oracle instance
# looks dead from the internet while `curl localhost` works fine on the box.
#
# The rules have to be INSERTed above that REJECT, not appended after it.
# ---------------------------------------------------------------------------
log "Host firewall (ports 80/443)"
for port in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    iptables -I INPUT 6 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  fi
done
netfilter-persistent save >/dev/null
echo "  ochiq portlar: $(iptables -S INPUT | grep -cE 'dport (80|443)') ta qoida"

log "Service user and directories"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home \
  --home-dir "$APP_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_ROOT" "$ENV_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_ROOT"
# Secrets are root-owned and group-readable by the service user only.
chown root:"$SERVICE_USER" "$ENV_DIR"
chmod 750 "$ENV_DIR"

log "systemd units"
install -m 644 "$HERE/hisvex-api.service" /etc/systemd/system/
install -m 644 "$HERE/hisvex-bot.service" /etc/systemd/system/
systemctl daemon-reload

log "nginx"
sed "s/__DOMAIN__/$DOMAIN/g" "$HERE/nginx-hisvex.conf" \
  > /etc/nginx/sites-available/hisvex
ln -sf /etc/nginx/sites-available/hisvex /etc/nginx/sites-enabled/hisvex
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# certbot via snap is Certbot's own recommendation on Ubuntu and is the only
# channel kept current on ARM64.
log "TLS certificate for $DOMAIN"
if ! command -v certbot >/dev/null; then
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
fi
if [[ ! -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
else
  echo "  sertifikat allaqachon bor, o'tkazib yuborildi"
fi

log "Hardening"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

cat <<EOF

Tayyor. Keyingi qadamlar:

  1. Maxfiy qiymatlarni yozing (bu skript ularga tegmaydi):
       $ENV_DIR/api.env
       $ENV_DIR/bot.env
     Namunalar: deploy/api.env.example, deploy/bot.env.example
     Ruxsat:  chown root:$SERVICE_USER $ENV_DIR/*.env && chmod 640 $ENV_DIR/*.env

  2. Kodni joylang:
       sudo -u $SERVICE_USER git clone <repo> $APP_ROOT/api
       sudo -u $SERVICE_USER git clone <bot-repo> $APP_ROOT/bot

  3. Ishga tushiring:
       bash deploy/deploy.sh api
       bash deploy/deploy.sh bot

EOF
