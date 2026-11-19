#!/bin/sh
# Maskan storage watchdog (installed via /etc/cron.d/maskan-storage, every 15 min).
#
# Checks, without reading or logging any file names or contents:
#   * disk usage of the filesystems holding uploads, backups and Docker data
#   * age of the last successful backup (written by maskan-backup.sh)
#   * that the backend container really has /srv/maskan/uploads mounted at
#     /app/uploads (a missing mount means new uploads would be lost again)
#
# Only state CHANGES are written to syslog (`journalctl -t maskan-storage`), so
# a persistent problem logs once, not every 15 minutes. Current state:
# /var/lib/maskan-monitor/storage_state.
set -u

UPLOADS_DIR="${UPLOADS_DIR:-/srv/maskan/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/maskan}"
DOCKER_ROOT="${DOCKER_ROOT:-/var/lib/docker}"
DISK_WARN_PCT="${DISK_WARN_PCT:-80}"
DISK_CRIT_PCT="${DISK_CRIT_PCT:-90}"
BACKUP_MAX_AGE_H="${BACKUP_MAX_AGE_H:-26}"
CONTAINER="${BACKEND_CONTAINER:-maskan-rental-backend-1}"
CONTAINER_DIR="${CONTAINER_DIR:-/app/uploads}"
STATE_DIR="${STATE_DIR:-/var/lib/maskan-monitor}"
DOCKER="${DOCKER:-docker}"
mkdir -p "$STATE_DIR"

problems=""
add() { problems="${problems:+$problems; }$1"; }
level="ok"
raise() { case "$1" in crit) level=crit ;; warn) [ "$level" = ok ] && level=warn ;; esac; }

# ── disk usage ──────────────────────────────────────────────────────────────
for path in "$UPLOADS_DIR" "$BACKUP_DIR" "$DOCKER_ROOT" /; do
    [ -e "$path" ] || continue
    # Take the "Capacity" field by its trailing % (robust to device names with spaces).
    pct=$(df -P "$path" 2>/dev/null | awk 'NR==2 {for (i = NF; i > 0; i--) if ($i ~ /^[0-9]+%$/) {sub("%", "", $i); print $i; exit}}')
    [ -n "$pct" ] || continue
    if [ "$pct" -ge "$DISK_CRIT_PCT" ]; then add "disk ${pct}% at $path"; raise crit
    elif [ "$pct" -ge "$DISK_WARN_PCT" ]; then add "disk ${pct}% at $path"; raise warn; fi
done
[ -d "$UPLOADS_DIR" ] || { add "uploads dir missing"; raise crit; }

# ── backup age ──────────────────────────────────────────────────────────────
last=$(cat "$STATE_DIR/backup_last_success" 2>/dev/null || echo 0)
age_h=$(( ( $(date +%s) - last ) / 3600 ))
if [ "$last" -eq 0 ]; then add "no successful backup recorded"; raise crit
elif [ "$age_h" -ge "$BACKUP_MAX_AGE_H" ]; then add "last successful backup ${age_h}h ago"; raise crit; fi
if grep -q " failed " "$STATE_DIR/backup_state" 2>/dev/null; then add "last backup run failed"; raise crit; fi

# ── uploads mount ───────────────────────────────────────────────────────────
if command -v "$DOCKER" >/dev/null 2>&1; then
    mounts=$("$DOCKER" inspect -f '{{range .Mounts}}{{.Source}}={{.Destination}} {{end}}' "$CONTAINER" 2>/dev/null || echo "")
    if [ -z "$mounts" ] && ! "$DOCKER" inspect "$CONTAINER" >/dev/null 2>&1; then
        add "backend container not found"; raise warn
    elif ! printf '%s\n' $mounts | grep -qx "$UPLOADS_DIR=$CONTAINER_DIR"; then
        add "uploads NOT mounted in backend (new uploads would be lost on recreate)"; raise crit
    fi
fi

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
summary="$level${problems:+: $problems}"
previous=$(cut -d' ' -f2- "$STATE_DIR/storage_state" 2>/dev/null || echo "")
echo "$now $summary" > "$STATE_DIR/storage_state"
if [ "$summary" != "$previous" ]; then
    case "$level" in
        ok)   logger -t maskan-storage -p user.notice "OK: storage checks passing" 2>/dev/null || true ;;
        warn) logger -t maskan-storage -p user.warning "WARNING: $problems" 2>/dev/null || true ;;
        crit) logger -t maskan-storage -p user.err "CRITICAL: $problems" 2>/dev/null || true ;;
    esac
fi
[ "$level" = crit ] && exit 2
[ "$level" = warn ] && exit 1
exit 0
