# Persistent upload storage (listing photos + private transaction documents)

## What changes

| | Before | After |
|---|---|---|
| Where files live | Backend container's writable layer (`/app/uploads`) | Host directory `/srv/maskan/uploads`, bind-mounted at `/app/uploads` |
| Container recreate / `up -d --build` | **Files deleted** | Files kept |
| Container path | `/app/uploads` | `/app/uploads` (unchanged — `transaction_documents.file_reference` stores absolute paths under it) |
| Access control | Authenticated download endpoints; signed photo URLs | Unchanged — no static route; neither Caddy nor the Hostinger host Nginx serves the directory |

Only the `backend` service mounts the directory (the Celery worker never reads uploads).
`backend/.dockerignore` keeps `uploads/`, `.env*`, `venv/` and caches out of image builds.

## Before you start

* Run on the VPS from the repo checkout (`~/maskan-rental`). Every command passes
  `--env-file .env.production`; **never** run `docker compose up` without it — the
  backend would be recreated with empty secrets/database credentials.
* **The VPS checkout is still at the pre-mount commit, so `migrate-uploads.sh` is not
  on disk there.** Step 0 fetches the reviewed script *without changing the checkout*;
  preflight and backup run from that copy against the unchanged production compose file.
* `/srv` and the backups need **root**: the script runs with `sudo` and an explicit
  `APP_DIR` (under `sudo`, `$HOME` is `/root`) — `$MIG` is defined in step 0.
* **Use the compose file the server is actually deployed with.** The Hostinger VPS runs
  `docker-compose.hostinger.yml` (backend published on `127.0.0.1:8000` for host Nginx);
  other servers run `docker-compose.prod.yml`. Step 0 reads it from the running backend
  (`$COMPOSE_FILE` below) and the script refuses to run if they differ — recreating the
  backend from the wrong file would silently drop the Nginx port mapping.
* The cutover uses the image already running (`--no-build`); do it **separately from,
  and before,** any application release. The only change to the backend service in
  either compose file since the September deployment is this mount.
* Choose a quiet window: the backend API is down for ~1–2 minutes during cutover
  (database, Redis, worker, frontend and the proxy are not touched).

> **Never activate the mount before the cutover.** From step 0 until `cutover` prints
> `CUTOVER OK`, nothing may recreate the backend from a compose file that contains the
> mount: no `git pull`/`checkout`/`merge`/`reset` before step 3, and no
> `docker compose up`/`restart`/`--build`, deploy script or release at any point in
> between. Recreating the backend with the mount *before* the files are copied starts
> it on an empty `/srv/maskan/uploads` and discards the old container's files with it —
> the step-2 backup would then be the only copy. Steps 3 and 4 run back-to-back in one
> session; `cutover` is the only command that activates the mount, and it does so only
> after copying and verifying every file. Disable any auto-deploy (cron `git pull`,
> CI deploy, Watchtower) for the duration.

## Migration (exact order)

### 0. Bootstrap the migration script (checkout, compose file and containers untouched)

On **your own computer**, pick the commit you reviewed and approved for this migration
(the commit containing this README, or a later reviewed one — not an earlier one) and
record its full hash and the script's SHA-256:

```bash
git rev-parse <approved-commit>
git show <approved-commit>:deploy/uploads/migrate-uploads.sh | sha256sum
```

On the **VPS**:

```bash
cd ~/maskan-rental
APPROVED=<full 40-character commit hash>
EXPECTED_SHA256=<sha256 from your computer>

# The compose file the running backend was created from (Hostinger: docker-compose.hostinger.yml)
export COMPOSE_FILE="$(basename "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' maskan-rental-backend-1)")"
echo "$COMPOSE_FILE"; test -f "$COMPOSE_FILE"           # must print the file name, then succeed

git rev-parse HEAD > ~/pre-migration-commit.txt         # the pre-mount commit, for rollback
git fetch origin                                        # downloads objects only — working tree,
                                                        # compose file and containers unchanged
git cat-file -e "$APPROVED^{commit}"                    # fails if the approved commit is missing
install -d -m 700 ~/maskan-migration
git show "$APPROVED:deploy/uploads/migrate-uploads.sh" > ~/maskan-migration/migrate-uploads.sh
echo "$EXPECTED_SHA256  $HOME/maskan-migration/migrate-uploads.sh" | sha256sum -c -   # must print OK

# The live configuration must still be the pre-mount one:
git status --short "$COMPOSE_FILE"                      # must print nothing
grep -c "/srv/maskan/uploads:/app/uploads" "$COMPOSE_FILE"   # must print 0

export MIG="sudo APP_DIR=$HOME/maskan-rental COMPOSE_FILE=$COMPOSE_FILE BACKUP_ROOT=/var/backups/maskan/migration bash $HOME/maskan-migration/migrate-uploads.sh"
```

No git access on the VPS? Copy the script from your computer instead
(`scp migrate-uploads.sh vps:~/maskan-migration/`) and run the same `sha256sum -c` line.
If the checksum does not match, stop.

### 1–2. Preflight and backup (pre-mount compose file, no downtime)

```bash
# 1. READ-ONLY: file count/size in the container, existing mount, host dir state,
#    free space, DB references and documents already missing on disk.
#    Expected: "compose file contains '...': no — expected before the cutover window".
$MIG preflight

# 2. No downtime: database dump + copy of every container file + SHA-256 manifest,
#    verified against the live container. Must end with "backup OK".
$MIG backup
```

### 3–4. Cutover window (run back-to-back)

```bash
# 3. Bring in the compose change (mount) and .dockerignore — files only, nothing restarts.
#    Fast-forward to the APPROVED commit exactly (not whatever is newest on the remote).
git merge --ff-only "$APPROVED"
git rev-parse HEAD                                                    # must equal $APPROVED
grep -n "/srv/maskan/uploads:/app/uploads" "$COMPOSE_FILE"          # must print one line
cmp deploy/uploads/migrate-uploads.sh ~/maskan-migration/migrate-uploads.sh   # must print nothing

# 4. Cutover — immediately. Refuses if no verified backup exists, the host dir is
#    non-empty or the compose file lacks the mount. Stops ONLY the backend (container
#    kept), copies the final file set to /srv/maskan/uploads (no-clobber: any existing
#    file is an error), verifies checksums, recreates the backend with the mount
#    (--no-deps --no-build), waits for health, verifies checksums again inside the new
#    container. If any check before the recreate fails, the original container is
#    started again unchanged.
$MIG cutover

# 5. Confirm.
$MIG verify
```

Then, in the app: open an existing transaction document as its owner, view a pending
listing's photo in the Partner Portal, and confirm a public listing photo loads.
Finally upload a test photo and run
`docker compose -f "$COMPOSE_FILE" --env-file .env.production up -d --no-deps --no-build --force-recreate backend`
followed by `$MIG verify` to prove persistence.

## Rollback

Files are never deleted by any step; `/srv/maskan/uploads` and the step-2 backup stay.
In a new shell, first re-run the `export COMPOSE_FILE=…` and `export MIG=…` lines from step 0.

```bash
cd ~/maskan-rental
git checkout "$(cat ~/pre-migration-commit.txt)" -- "$COMPOSE_FILE"   # pre-mount version (e.g. 377649b)
$MIG rollback     # recreates the backend without the mount, copies the files back
                  # into the container and verifies every checksum
```

If `cutover` stopped with an error *after* the recreate (health or checksum step):
the files are already in `/srv/maskan/uploads` and in the backup; run `$MIG verify`
to see the difference, or roll back as above.

## Backups (install after the migration)

```bash
sudo install -m 750 deploy/backup/maskan-backup.sh /usr/local/bin/maskan-backup.sh
sudo install -m 600 deploy/backup/maskan-backup.conf.example /etc/maskan-backup.conf   # set APP_DIR and COMPOSE_FILE
sudo install -m 644 deploy/backup/maskan-backup.cron /etc/cron.d/maskan-backup
sudo /usr/local/bin/maskan-backup.sh run                               # first run by hand
sudo /usr/local/bin/maskan-backup.sh verify /var/backups/maskan/$(date -u +%F)
```

* Nightly: `pg_dump` first, then the uploads archive; per-file SHA-256 manifest;
  files mode 600 in a mode-700 directory; 7 daily + 4 weekly (Sunday) kept.
* Failures exit non-zero, are logged to syslog (`journalctl -t maskan-backup`) and
  recorded in `/var/lib/maskan-monitor/backup_state`; a partial backup is removed.
  Only `run` writes `backup_state`: a failed or refused manual `verify` /
  `restore-uploads` exits non-zero and is logged (`manual verify: …`), but never
  replaces the last backup run's status, so it cannot raise or clear the watchdog's
  "last backup run failed" alert.
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
