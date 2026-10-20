#!/usr/bin/env bash
# Lightweight production resource snapshot. Intended to run once per minute
# from the accompanying systemd timer, independently from application deploys.
set -Eeuo pipefail

LOG_DIR="${LOG_DIR:-/var/log/home-rehab-monitor}"
LOCK_FILE="${LOCK_FILE:-/run/home-rehab-resource-snapshot.lock}"
DOCKER_BIN="${DOCKER_BIN:-/usr/bin/docker}"

mkdir -p "$LOG_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

log_file="$LOG_DIR/resource-$(date +%F).log"
now="$(date --iso-8601=seconds)"

{
  printf '=== snapshot %s ===\n' "$now"
  printf '%s\n' '[uptime]'
  uptime
  printf '%s\n' '[memory]'
  free -h
  printf '%s\n' '[disk]'
  df -h /
  printf '%s\n' '[pressure]'
  for resource in cpu io memory; do
    printf '%s ' "$resource"
    tr '\n' ' ' < "/proc/pressure/$resource"
    printf '\n'
  done
  printf '%s\n' '[vmstat]'
  vmstat 1 2 | tail -1
  printf '%s\n' '[top-processes]'
  COLUMNS=200 top -b -n 1 -o %CPU | head -22
  printf '%s\n' '[containers]'
  if [ -x "$DOCKER_BIN" ]; then
    "$DOCKER_BIN" stats --no-stream \
      --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}} net={{.NetIO}} block={{.BlockIO}}' || true
  else
    printf 'docker executable unavailable: %s\n' "$DOCKER_BIN"
  fi
  printf '%s\n\n' '=== end ==='
} >> "$log_file" 2>&1
