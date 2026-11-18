# Persistent upload storage (listing photos + private transaction documents)

## What changes

| | Before | After |
|---|---|---|
| Where files live | Backend container's writable layer (`/app/uploads`) | Host directory `/srv/maskan/uploads`, bind-mounted at `/app/uploads` |
| Container recreate / `up -d --build` | **Files deleted** | Files kept |
| Container path | `/app/uploads` | `/app/uploads` (unchanged — `transaction_documents.file_reference` stores absolute paths under it) |
| Access control | Authenticated download endpoints; signed photo URLs | Unchanged — no static route, Caddy never serves the directory |

Only the `backend` service mounts the directory (the Celery worker never reads uploads).
`backend/.dockerignore` keeps `uploads/`, `.env*`, `venv/` and caches out of image builds.

## Before you start

* Run on the VPS from the repo checkout (`~/maskan-rental`). Every command passes
  `--env-file .env.production`; **never** run `docker compose up` without it — the
  backend would be recreated with empty secrets/database credentials.
* `/srv` and the backups need **root**: run the script with `sudo` and set `APP_DIR`
  explicitly (under `sudo`, `$HOME` is `/root`):

  ```bash
  export MIG="sudo APP_DIR=$HOME/maskan-rental BACKUP_ROOT=/var/backups/maskan/migration bash deploy/uploads/migrate-uploads.sh"
  ```
* The cutover uses the image already running (`--no-build`); do it **separately from,
  and before,** any application release. The only change to the backend service in
  `docker-compose.prod.yml` since the September deployment is this mount.
* Choose a quiet window: the backend API is down for ~1–2 minutes during cutover
  (database, Redis, worker, frontend and Caddy are not touched).

## Migration (exact order)

```bash
cd ~/maskan-rental

# 1. READ-ONLY: file count/size in the container, existing mount, host dir state,
#    free space, DB references and documents already missing on disk.
$MIG preflight

# 2. No downtime: database dump + copy of every container file + SHA-256 manifest,
#    verified against the live container.
$MIG backup

# 3. Bring in the compose change (mount) and .dockerignore. Nothing restarts.
git pull
grep -n "/srv/maskan/uploads:/app/uploads" docker-compose.prod.yml   # must print one line

# 4. Cutover. Refuses if the host dir is non-empty or the compose file lacks the mount.
#    Stops ONLY the backend (container kept), copies the final file set to
#    /srv/maskan/uploads (no-clobber), verifies checksums, recreates the backend with
#    the mount (--no-deps --no-build), waits for health, verifies checksums again
#    inside the new container. If any check before the recreate fails, the original
#    container is started again unchanged.
$MIG cutover

# 5. Confirm.
$MIG verify
```

Then, in the app: open an existing transaction document as its owner, view a pending
listing's photo in the Partner Portal, and confirm a public listing photo loads.
Finally upload a test photo and run
`docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-deps --no-build --force-recreate backend`
followed by `$MIG verify` to prove persistence.

## Rollback

Files are never deleted by any step; `/srv/maskan/uploads` and the step-2 backup stay.

```bash
cd ~/maskan-rental
git checkout <commit-before-the-mount> -- docker-compose.prod.yml   # e.g. 377649b
$MIG rollback     # recreates the backend without the mount, copies the files back
                  # into the container and verifies every checksum
```

If `cutover` stopped with an error *after* the recreate (health or checksum step):
the files are already in `/srv/maskan/uploads` and in the backup; run `$MIG verify`
to see the difference, or roll back as above.

## Backups (install after the migration)

```bash
sudo install -m 750 deploy/backup/maskan-backup.sh /usr/local/bin/maskan-backup.sh
sudo install -m 600 deploy/backup/maskan-backup.conf.example /etc/maskan-backup.conf   # set APP_DIR
sudo install -m 644 deploy/backup/maskan-backup.cron /etc/cron.d/maskan-backup
sudo /usr/local/bin/maskan-backup.sh run                               # first run by hand
sudo /usr/local/bin/maskan-backup.sh verify /var/backups/maskan/$(date -u +%F)
```

* Nightly: `pg_dump` first, then the uploads archive; per-file SHA-256 manifest;
  files mode 600 in a mode-700 directory; 7 daily + 4 weekly (Sunday) kept.
* Failures exit non-zero, are logged to syslog (`journalctl -t maskan-backup`) and
  recorded in `/var/lib/maskan-monitor/backup_state`; a partial backup is removed.
* **Encrypted off-server copy (recommended, no cloud service needed):** generate a GPG
  key pair on your own computer, import only the public key on the VPS, set
  `GPG_RECIPIENT`, and set `OFFSITE_TARGET=user@host:/path` to any machine you control
  (SSH key auth). Unencrypted backups are never sent off-server.
* Restore uploads into an **empty** directory with checksum verification:
  `maskan-backup.sh restore-uploads /var/backups/maskan/<date> /srv/maskan/uploads.restore`
  (then swap directories with the backend stopped). Database restores are manual
  (`gunzip -c db.sql.gz | docker compose … exec -T db psql …`) — never automated.

## Monitoring

```bash
sudo install -m 755 deploy/monitoring/maskan-storage-check.sh /usr/local/bin/maskan-storage-check.sh
sudo install -m 644 deploy/monitoring/maskan-storage.cron /etc/cron.d/maskan-storage
```

Every 15 minutes: disk usage (warn 80 %, critical 90 %) for uploads, backups, Docker
data and `/`; last successful backup older than 26 h or a failed run; and that the
backend container really has `/srv/maskan/uploads` mounted at `/app/uploads`. Only
state changes are logged (`journalctl -t maskan-storage`); no file names or contents.
