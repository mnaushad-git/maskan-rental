#!/usr/bin/env bash
# Maskan nightly backup: PostgreSQL dump + uploaded files (listing photos and
# PRIVATE transaction documents), with checksums, retention, failure reporting
# and optional encrypted off-server copy. No cloud service required.
#
#   maskan-backup.sh run                       create today's backup
#   maskan-backup.sh verify  <backup-dir>      check archives + per-file checksums
#   maskan-backup.sh restore-uploads <backup-dir> <empty-target-dir>
#                                              extract uploads and verify every file
#
# The database is dumped BEFORE the files are archived: uploads are written to
# disk before their DB row commits, so every file a dump refers to is already
# on disk when the archive is taken.
#
# Configuration: environment variables, or /etc/maskan-backup.conf (root-owned,
# mode 600) using the same names.
#   APP_DIR        ~/maskan-rental of the deploy user (default /root/maskan-rental)
#   COMPOSE_FILE   docker-compose.prod.yml          ENV_FILE  .env.production
#   UPLOADS_DIR    /srv/maskan/uploads              BACKUP_DIR /var/backups/maskan
#   KEEP_DAILY     7    KEEP_WEEKLY 4  (Sunday backups are kept as weekly)
#   GPG_RECIPIENT  optional: public key id/email; encrypts archives (*.gpg)
#   ENCRYPT_LOCAL  1 = keep only encrypted archives locally (needs GPG_RECIPIENT)
#   OFFSITE_TARGET optional: user@host:/path (scp over SSH to a machine you own).
#                  Only encrypted archives are ever sent off-server.
#   STATUS_DIR     /var/lib/maskan-monitor (read by maskan-storage-check.sh)
set -Eeuo pipefail

CONF="${MASKAN_BACKUP_CONF:-/etc/maskan-backup.conf}"
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"

APP_DIR="${APP_DIR:-/root/maskan-rental}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
UPLOADS_DIR="${UPLOADS_DIR:-/srv/maskan/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/maskan}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
GPG_RECIPIENT="${GPG_RECIPIENT:-}"
ENCRYPT_LOCAL="${ENCRYPT_LOCAL:-0}"
OFFSITE_TARGET="${OFFSITE_TARGET:-}"
STATUS_DIR="${STATUS_DIR:-/var/lib/maskan-monitor}"
DOCKER="${DOCKER:-docker}"
TODAY="${BACKUP_DATE:-$(date -u +%Y-%m-%d)}"   # BACKUP_DATE only for tests

umask 077
STEP="init"
WORK=""
LOCK=""
log()    { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
syslog() { command -v logger >/dev/null 2>&1 && logger -t maskan-backup -p "$1" "$2" || true; }
fail() {
    local msg="FAILED at step '$STEP': ${1:-command failed}"
    printf 'ERROR: %s\n' "$msg" >&2
    mkdir -p "$STATUS_DIR"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) failed step=$STEP" > "$STATUS_DIR/backup_state"
    syslog user.err "$msg"
    # Never leave a partial backup behind that could be mistaken for a good one.
    [ -n "$WORK" ] && rm -rf -- "$WORK"
    exit 1
}
trap 'fail "line $LINENO: $BASH_COMMAND"' ERR

manifest_dir() { ( cd "$1" && find . -type f -print0 | xargs -0 -r sha256sum ) | LC_ALL=C sort -k2; }

cmd_run() {
    [ -d "$APP_DIR" ] || fail "APP_DIR not found"
    [ -f "$APP_DIR/$ENV_FILE" ] || fail "env file missing"
    [ -d "$UPLOADS_DIR" ] || fail "uploads dir missing: $UPLOADS_DIR"
    if [ "$ENCRYPT_LOCAL" = "1" ] && [ -z "$GPG_RECIPIENT" ]; then fail "ENCRYPT_LOCAL=1 needs GPG_RECIPIENT"; fi
    mkdir -p "$BACKUP_DIR" "$STATUS_DIR"; chmod 700 "$BACKUP_DIR"

    # Single instance (mkdir is atomic; works without flock).
    mkdir "$BACKUP_DIR/.lock" 2>/dev/null || fail "another backup is running (remove $BACKUP_DIR/.lock if stale)"
    LOCK="$BACKUP_DIR/.lock"
    trap '[ -n "$LOCK" ] && rmdir "$LOCK" 2>/dev/null; true' EXIT

    local dest="$BACKUP_DIR/$TODAY" work="$BACKUP_DIR/.work-$TODAY-$$"
    [ -e "$dest" ] && fail "$dest already exists"
    mkdir -p "$work"; WORK="$work"

    STEP="database"
    ( cd "$APP_DIR" && "$DOCKER" compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db \
        sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' ) | gzip > "$work/db.sql.gz"
    gzip -t "$work/db.sql.gz"
    [ "$(gzip -dc "$work/db.sql.gz" | head -c 4096 | wc -c)" -gt 0 ] || fail "empty database dump"

    STEP="uploads"
    manifest_dir "$UPLOADS_DIR" > "$work/uploads.sha256"
    tar -czf "$work/uploads.tgz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
    tar -tzf "$work/uploads.tgz" > /dev/null

    STEP="checksums"
    ( cd "$work" && sha256sum db.sql.gz uploads.tgz uploads.sha256 > SHA256SUMS )

    if [ -n "$GPG_RECIPIENT" ]; then
        STEP="encrypt"
        for f in db.sql.gz uploads.tgz; do
            gpg --batch --yes --trust-model always --recipient "$GPG_RECIPIENT" \
                --output "$work/$f.gpg" --encrypt "$work/$f"
        done
        ( cd "$work" && sha256sum db.sql.gz.gpg uploads.tgz.gpg >> SHA256SUMS )
        if [ "$ENCRYPT_LOCAL" = "1" ]; then rm -f "$work/db.sql.gz" "$work/uploads.tgz"; fi
    fi

    chmod 600 "$work"/*
    mv "$work" "$dest"; WORK=""

    if [ -n "$OFFSITE_TARGET" ]; then
        STEP="offsite"
        [ -n "$GPG_RECIPIENT" ] || fail "OFFSITE_TARGET set without GPG_RECIPIENT — refusing to send unencrypted backups off-server"
        # Flat, date-prefixed names so no remote mkdir is needed. SSH key auth only.
        for f in db.sql.gz.gpg uploads.tgz.gpg SHA256SUMS; do
            scp -q -o BatchMode=yes -o ConnectTimeout=20 "$dest/$f" "$OFFSITE_TARGET/maskan-$TODAY-$f"
        done
    fi

    STEP="retention"
    prune

    local files size
    files="$(wc -l < "$dest/uploads.sha256" | tr -d ' ')"
    size="$(du -sh "$dest" | cut -f1)"
    date +%s > "$STATUS_DIR/backup_last_success"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ok files=$files size=$size" > "$STATUS_DIR/backup_state"
    syslog user.notice "OK: backup $TODAY ($files uploaded file(s), $size)"
    log "backup OK: $dest ($files uploaded file(s), $size)"
}

# Keep the newest KEEP_DAILY daily backups plus Sunday backups for KEEP_WEEKLY weeks.
prune() {
    local today_s; today_s="$(date -u -d "$TODAY" +%s)"
    for d in "$BACKUP_DIR"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]; do
        [ -d "$d" ] || continue
        local day age dow; day="$(basename "$d")"
        age=$(( (today_s - $(date -u -d "$day" +%s)) / 86400 ))
        dow="$(date -u -d "$day" +%u)"   # 7 = Sunday
        if [ "$age" -lt "$KEEP_DAILY" ]; then continue; fi
        if [ "$dow" = "7" ] && [ "$age" -lt $(( KEEP_WEEKLY * 7 )) ]; then continue; fi
        rm -rf -- "$d"
        log "pruned $day"
    done
}

cmd_verify() {
    local b="${1:?backup dir}"
    STEP="verify"
    ( cd "$b" && sha256sum -c --quiet --ignore-missing SHA256SUMS )
    [ -f "$b/db.sql.gz" ] && gzip -t "$b/db.sql.gz"
    if [ -f "$b/uploads.tgz" ]; then
        local tmp; tmp="$(mktemp -d)"
        tar -xzf "$b/uploads.tgz" -C "$tmp"
        manifest_dir "$tmp/$(ls "$tmp")" | cmp -s - "$b/uploads.sha256" || { rm -rf "$tmp"; fail "uploads archive does not match uploads.sha256"; }
        rm -rf "$tmp"
    fi
    log "verify OK: $b"
}

cmd_restore_uploads() {
    local b="${1:?backup dir}" target="${2:?target dir}"
    STEP="restore"
    if [ -e "$target" ] && [ -n "$(ls -A "$target" 2>/dev/null)" ]; then fail "target $target is not empty — refusing to overwrite"; fi
    local archive
    if [ -f "$b/uploads.tgz" ]; then
        archive="$b/uploads.tgz"
        ( cd "$b" && grep -E ' [ *](uploads\.tgz|uploads\.sha256)$' SHA256SUMS | sha256sum -c --quiet - ) \
            || fail "archive checksum mismatch"
    elif [ -f "$b/uploads.tgz.gpg" ]; then
        ( cd "$b" && grep -E ' [ *](uploads\.tgz\.gpg|uploads\.sha256)$' SHA256SUMS | sha256sum -c --quiet - ) \
            || fail "encrypted archive checksum mismatch"
        archive="$(mktemp)"; gpg --batch --yes --output "$archive" --decrypt "$b/uploads.tgz.gpg"
    else
        fail "no uploads archive in $b"
    fi
    local tmp; tmp="$(mktemp -d)"
    tar -xzf "$archive" -C "$tmp"
    [ "$archive" = "$b/uploads.tgz" ] || rm -f "$archive"
    mkdir -p "$target"; chmod 700 "$target"
    cp -a -n "$tmp/$(ls "$tmp")/." "$target/"
    rm -rf "$tmp"
    manifest_dir "$target" | cmp -s - "$b/uploads.sha256" || fail "restored files do not match uploads.sha256"
    log "restore OK: $(wc -l < "$b/uploads.sha256" | tr -d ' ') file(s) restored to $target and verified"
}

case "${1:-}" in
    run)             cmd_run ;;
    verify)          cmd_verify "${2:-}" ;;
    restore-uploads) cmd_restore_uploads "${2:-}" "${3:-}" ;;
    *) sed -n '2,30p' "$0"; exit 2 ;;
esac
