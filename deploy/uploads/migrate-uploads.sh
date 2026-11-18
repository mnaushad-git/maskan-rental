#!/usr/bin/env bash
# Maskan — move backend uploads from the container's writable layer to the
# persistent host directory /srv/maskan/uploads (bind-mounted at /app/uploads).
#
# Subcommands (run from anywhere; defaults match the Hostinger VPS):
#   preflight   READ-ONLY. Counts/sizes files in the running backend, checks
#               the host directory, free space and compose configuration.
#   backup      Database dump + copy of every container upload + SHA-256
#               manifest, verified against the live container. No downtime.
#   cutover     Stops ONLY the backend (container kept, not removed), copies
#               the final file set into the host directory (never overwrites),
#               verifies checksums, then recreates the backend with the mount
#               and verifies checksums again inside the new container.
#   verify      Compares the live container's files with the host directory.
#   rollback    After reverting the compose file to the pre-mount version:
#               recreates the backend and copies the files back into it.
#               Never deletes the host directory or any backup.
#
# Every docker compose call passes --env-file: running `up` without it would
# recreate the backend with empty secrets/DB credentials.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$HOME/maskan-rental}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
SERVICE="${SERVICE:-backend}"
HOST_DIR="${HOST_DIR:-/srv/maskan/uploads}"
CONTAINER_DIR="${CONTAINER_DIR:-/app/uploads}"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/backups}"
DOCKER="${DOCKER:-docker}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
MOUNT_SPEC="$HOST_DIR:$CONTAINER_DIR"

umask 077
log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
trap 'die "command failed (line $LINENO): $BASH_COMMAND"' ERR

cd "$APP_DIR" 2>/dev/null || die "APP_DIR not found: $APP_DIR"
[ -f "$COMPOSE_FILE" ] || die "compose file not found: $APP_DIR/$COMPOSE_FILE"
[ -f "$ENV_FILE" ] || die "env file not found: $APP_DIR/$ENV_FILE (required — never run compose without it)"

dc() { "$DOCKER" compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
compose_has_mount() { grep -qF -- "- $MOUNT_SPEC" "$COMPOSE_FILE"; }
container_id() { dc ps -a -q "$SERVICE" | head -n1; }
is_running() { local s; s="$(dc ps --status running --services 2>/dev/null || true)"; printf '%s\n' "$s" | grep -qx "$SERVICE"; }
# Lines in manifest $1 that are missing/different in manifest $2. Always
# captured into a variable and tested with [ -n ]: piping into `grep -q` under
# pipefail can SIGPIPE the producer and make a real mismatch look like a match.
missing_from() { LC_ALL=C comm -23 <(LC_ALL=C sort "$1") <(LC_ALL=C sort "$2"); }

# Manifest format: "<sha256>  ./relative/path", sorted (C locale).
manifest_dir() {  # $1 = local directory
    ( cd "$1" && find . -type f -print0 | xargs -0 -r sha256sum ) | LC_ALL=C sort -k2
}
manifest_container() {  # files inside the RUNNING backend container
    dc exec -T "$SERVICE" sh -c \
        "if [ -d '$CONTAINER_DIR' ]; then cd '$CONTAINER_DIR' && find . -type f -print0 | xargs -0 -r sha256sum; fi" \
        | LC_ALL=C sort -k2
}
copy_out_of_container() {  # $1 = empty local target dir; works on stopped containers
    local cid; cid="$(container_id)"; [ -n "$cid" ] || die "no $SERVICE container found"
    mkdir -p "$1"
    if "$DOCKER" cp "$cid:$CONTAINER_DIR/." "$1/" 2>/dev/null; then :; else
        log "container has no $CONTAINER_DIR yet — treating as empty"
    fi
}
dir_is_empty() { [ -z "$(ls -A "$1" 2>/dev/null)" ]; }
count_lines() { if [ -s "$1" ]; then wc -l < "$1" | tr -d ' '; else echo 0; fi; }
wait_healthy() {
    local waited=0
    until dc exec -T "$SERVICE" python -c \
        "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=5)" >/dev/null 2>&1; do
        waited=$((waited + 5)); [ "$waited" -ge "$HEALTH_TIMEOUT" ] && return 1; sleep 5
    done
}
latest_backup() { cat "$BACKUP_ROOT/uploads-migration-latest" 2>/dev/null || true; }

cmd_preflight() {
    log "compose: $COMPOSE_FILE  env: $ENV_FILE  service: $SERVICE"
    is_running || die "$SERVICE is not running — preflight needs the live container"
    local files kb
    files="$(dc exec -T "$SERVICE" sh -c "[ -d '$CONTAINER_DIR' ] && find '$CONTAINER_DIR' -type f | wc -l || echo 0" | tr -d '\r ')"
    kb="$(dc exec -T "$SERVICE" sh -c "[ -d '$CONTAINER_DIR' ] && du -sk '$CONTAINER_DIR' | cut -f1 || echo 0" | tr -d '\r ')"
    log "container $CONTAINER_DIR: $files file(s), ${kb} KiB"
    local mounted
    mounted="$("$DOCKER" inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$(container_id)" | tr ' ' '\n' | grep -cx "$CONTAINER_DIR" || true)"
    log "running container already has a mount at $CONTAINER_DIR: $([ "$mounted" -gt 0 ] && echo yes || echo no)"
    if [ -e "$HOST_DIR" ]; then
        if dir_is_empty "$HOST_DIR"; then log "host dir $HOST_DIR exists and is empty — OK"
        else log "WARNING: host dir $HOST_DIR is NOT empty — cutover will refuse to write into it"; fi
    else log "host dir $HOST_DIR does not exist yet — cutover will create it (mode 700)"; fi
    local probe="$HOST_DIR"; while [ ! -e "$probe" ]; do probe="$(dirname "$probe")"; done
    local free_kb; free_kb="$(df -Pk "$probe" | awk 'NR==2{print $4}')"
    local need=$(( kb * 3 + 102400 ))   # backup copy + staging + host copy + 100 MiB margin
    log "free space at $probe: ${free_kb} KiB (need ≥ ${need} KiB)"
    [ "$free_kb" -ge "$need" ] || die "not enough free disk space"
    log "compose file contains '$MOUNT_SPEC': $(compose_has_mount && echo yes || echo 'no (pull the change before cutover)')"
    # Database references vs files actually present (counts only — no paths printed).
    local refs listing_refs
    refs="$(dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from transaction_documents where file_reference is not null"' 2>/dev/null | tr -d '\r ' || echo '?')"
    listing_refs="$(dc exec -T db sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \"select count(*) from listing_images where url like '/api/media/%'\"" 2>/dev/null | tr -d '\r ' || echo '?')"
    log "database references: $refs transaction document(s), $listing_refs uploaded listing photo(s)"
    if [ "$refs" != "?" ]; then
        local missing
        missing="$(dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select file_reference from transaction_documents where file_reference is not null"' 2>/dev/null \
            | tr -d '\r' | while read -r f; do [ -n "$f" ] && { dc exec -T "$SERVICE" test -f "$f" || echo x; }; done | wc -l | tr -d ' ')"
        log "transaction documents referenced in the DB but missing on disk: $missing"
    fi
    log "preflight complete — nothing was changed"
}

cmd_backup() {
    is_running || die "$SERVICE must be running for the backup (no downtime needed)"
    local ts dir; ts="$(date -u +%Y%m%dT%H%M%SZ)"; dir="$BACKUP_ROOT/uploads-migration-$ts"
    mkdir -p "$dir"; chmod 700 "$BACKUP_ROOT" "$dir"
    log "backup dir: $dir"
    log "1/4 database dump"
    dc exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$dir/db.sql.gz"
    gzip -t "$dir/db.sql.gz"
    log "2/4 checksum manifest from the live container"
    manifest_container > "$dir/container.sha256"
    log "3/4 copy files out of the container"
    copy_out_of_container "$dir/uploads"
    log "4/4 verify the copy"
    manifest_dir "$dir/uploads" > "$dir/copy.sha256"
    # The live container may receive new uploads during the copy; every file in
    # the manifest taken first must be present in the copy with the same hash.
    if [ -n "$(missing_from "$dir/container.sha256" "$dir/copy.sha256")" ]; then
        die "copy does not match the container manifest — see $dir"
    fi
    cp "$dir/copy.sha256" "$dir/MANIFEST.sha256"
    echo "$dir" > "$BACKUP_ROOT/uploads-migration-latest"
    log "backup OK: $(count_lines "$dir/MANIFEST.sha256") file(s) verified, database dump $(du -h "$dir/db.sql.gz" | cut -f1)"
}

cmd_cutover() {
    local dir; dir="$(latest_backup)"
    [ -n "$dir" ] && [ -f "$dir/MANIFEST.sha256" ] || die "run 'backup' first"
    compose_has_mount || die "$COMPOSE_FILE does not contain '- $MOUNT_SPEC' — git pull the change first"
    if [ -e "$HOST_DIR" ] && ! dir_is_empty "$HOST_DIR"; then
        die "$HOST_DIR is not empty — refusing to overwrite existing uploads"
    fi
    is_running || die "$SERVICE is not running"
    log "1/6 stopping $SERVICE only (container is kept — nothing is removed)"
    dc stop "$SERVICE"
    local final="$dir/final"
    [ -e "$final" ] && die "$final already exists — use a fresh backup"
    log "2/6 copying the final file set out of the stopped container"
    copy_out_of_container "$final"
    manifest_dir "$final" > "$dir/final.sha256"
    if [ -n "$(missing_from "$dir/MANIFEST.sha256" "$dir/final.sha256")" ]; then
        dc start "$SERVICE"; die "files from the backup are missing/changed in the final copy — backend restarted unchanged"
    fi
    log "    files: backup $(count_lines "$dir/MANIFEST.sha256"), final $(count_lines "$dir/final.sha256") (new since backup: $(missing_from "$dir/final.sha256" "$dir/MANIFEST.sha256" | wc -l | tr -d ' '))"
    log "3/6 populating $HOST_DIR (no-clobber)"
    mkdir -p "$HOST_DIR"; chmod 700 "$HOST_DIR"
    cp -a -n "$final/." "$HOST_DIR/"
    manifest_dir "$HOST_DIR" > "$dir/host.sha256"
    if ! cmp -s "$dir/final.sha256" "$dir/host.sha256"; then
        dc start "$SERVICE"; die "host directory checksums differ from the final copy — backend restarted unchanged (no mount); inspect $HOST_DIR"
    fi
    log "4/6 recreating $SERVICE with the bind mount (no rebuild, no other services touched)"
    dc up -d --no-deps --no-build "$SERVICE"
    log "5/6 waiting for health"
    wait_healthy || die "backend not healthy after ${HEALTH_TIMEOUT}s — see 'Rollback' in deploy/uploads/README.md"
    log "6/6 verifying files inside the new container"
    manifest_container > "$dir/after.sha256"
    cmp -s "$dir/final.sha256" "$dir/after.sha256" || die "files inside the new container differ — see 'Rollback'"
    log "CUTOVER OK: $(count_lines "$dir/after.sha256") file(s) persisted at $HOST_DIR and verified in the container"
}

cmd_verify() {
    is_running || die "$SERVICE is not running"
    local tmp; tmp="$(mktemp -d)"
    manifest_container > "$tmp/c"; manifest_dir "$HOST_DIR" > "$tmp/h"
    log "container: $(count_lines "$tmp/c") file(s); host dir: $(count_lines "$tmp/h") file(s)"
    if cmp -s "$tmp/c" "$tmp/h"; then log "VERIFY OK — container files are the host directory (mounted)"; rm -rf "$tmp"
    else rm -rf "$tmp"; die "container and host directory differ"; fi
}

cmd_rollback() {
    compose_has_mount && die "$COMPOSE_FILE still contains the mount — revert it first: git checkout <previous-commit> -- $COMPOSE_FILE"
    [ -d "$HOST_DIR" ] || die "$HOST_DIR not found"
    local tmp; tmp="$(mktemp -d)"; manifest_dir "$HOST_DIR" > "$tmp/h"
    log "1/3 recreating $SERVICE without the mount"
    dc up -d --no-deps --no-build "$SERVICE"
    wait_healthy || die "backend not healthy after ${HEALTH_TIMEOUT}s"
    log "2/3 copying $(count_lines "$tmp/h") file(s) back into the container (host dir is left intact)"
    dc exec -T "$SERVICE" mkdir -p "$CONTAINER_DIR"
    "$DOCKER" cp "$HOST_DIR/." "$(container_id):$CONTAINER_DIR/"
    log "3/3 verifying"
    manifest_container > "$tmp/c"
    cmp -s "$tmp/h" "$tmp/c" || die "files in the container differ from $HOST_DIR"
    rm -rf "$tmp"
    log "ROLLBACK OK — backend runs without the mount; files restored into the container; $HOST_DIR kept"
}

case "${1:-}" in
    preflight) cmd_preflight ;;
    backup)    cmd_backup ;;
    cutover)   cmd_cutover ;;
    verify)    cmd_verify ;;
    rollback)  cmd_rollback ;;
    *) sed -n '2,20p' "$0"; exit 2 ;;
esac
