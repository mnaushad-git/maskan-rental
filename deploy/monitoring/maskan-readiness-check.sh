#!/bin/sh
# myMakan readiness watchdog (installed via /etc/cron.d/maskan-readiness, runs every minute).
#
# Probes the PUBLIC readiness endpoint, so one check covers DNS, TLS, Caddy,
# the backend and its database connection pool. Docker's own healthcheck only
# probes /api/health (liveness) and Docker never restarts an "unhealthy"
# container by itself, so this is what notices a DB/pool outage.
#
# Every state change (ok -> failing, failing -> recovered) is written to syslog
# (`journalctl -t maskan-ready`). Current state: /var/lib/maskan-monitor/state.
#
# AUTO_RESTART=1 (off by default) restarts ONLY the backend container after
# FAIL_THRESHOLD consecutive failures — `docker restart` keeps the container's
# existing environment, volumes and data; Postgres is never touched. At most
# one restart per RESTART_COOLDOWN_MIN minutes.
set -u

URL="${READY_URL:-https://maskanai.com/api/health/ready}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-5}"
AUTO_RESTART="${AUTO_RESTART:-0}"
RESTART_COOLDOWN_MIN="${RESTART_COOLDOWN_MIN:-30}"
CONTAINER="${BACKEND_CONTAINER:-maskan-rental-backend-1}"
STATE_DIR=/var/lib/maskan-monitor
mkdir -p "$STATE_DIR"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL" || echo 000)
fails=$(cat "$STATE_DIR/fail_count" 2>/dev/null || echo 0)
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$code" = "200" ]; then
    if [ "$fails" -gt 0 ]; then
        logger -t maskan-ready -p user.notice "RECOVERED: readiness 200 after $fails consecutive failure(s)"
    fi
    echo 0 > "$STATE_DIR/fail_count"
    echo "$now ok" > "$STATE_DIR/state"
    exit 0
fi

fails=$((fails + 1))
echo "$fails" > "$STATE_DIR/fail_count"
echo "$now failing http=$code consecutive=$fails" > "$STATE_DIR/state"
logger -t maskan-ready -p user.err "FAILING: readiness http=$code consecutive=$fails"

if [ "$AUTO_RESTART" = "1" ] && [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
    last=$(cat "$STATE_DIR/last_restart_epoch" 2>/dev/null || echo 0)
    if [ $(( $(date +%s) - last )) -ge $((RESTART_COOLDOWN_MIN * 60)) ]; then
        logger -t maskan-ready -p user.crit "AUTO-RESTART: restarting $CONTAINER after $fails consecutive readiness failures"
        date +%s > "$STATE_DIR/last_restart_epoch"
        docker restart "$CONTAINER" >/dev/null 2>&1 \
            || logger -t maskan-ready -p user.crit "AUTO-RESTART FAILED for $CONTAINER"
    fi
fi
exit 0
