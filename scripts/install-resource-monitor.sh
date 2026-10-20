#!/usr/bin/env bash
# Run as root on the production host from the repository root.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONITOR_DIR="$ROOT_DIR/infra/monitoring"

[ "$(id -u)" -eq 0 ] || { echo 'Please run as root.' >&2; exit 1; }

install -d -m 0755 /var/log/home-rehab-monitor
install -m 0755 "$SCRIPT_DIR/resource-snapshot.sh" /usr/local/sbin/home-rehab-resource-snapshot
install -m 0644 "$MONITOR_DIR/home-rehab-resource-snapshot.service" /etc/systemd/system/home-rehab-resource-snapshot.service
install -m 0644 "$MONITOR_DIR/home-rehab-resource-snapshot.timer" /etc/systemd/system/home-rehab-resource-snapshot.timer
install -m 0644 "$MONITOR_DIR/home-rehab-resource-snapshot.logrotate" /etc/logrotate.d/home-rehab-resource-snapshot

systemctl daemon-reload
systemctl enable --now home-rehab-resource-snapshot.timer
systemctl start home-rehab-resource-snapshot.service
systemctl --no-pager status home-rehab-resource-snapshot.timer
