# Backup and restore

## What is backed up

The Server writes a consistent SQLite snapshot (`sofa-YYYYMMDDTHHMMSSZ.db`, UTC) to `SOFA_BACKUP_DIR` (`/backups` in the container, the `sofa-backups` volume) at startup if the newest is older than a day, and then about once a day. It keeps the newest backup of each of the last 7 days that have one and of each of the last 4 weeks (Monday start) that have one. Companion's home page shows the time of the last backup, or that the last attempt failed.

The database holds everything that is configuration: the layout revisions and drafts, widget settings, Kids Mode (approved apps, daily minutes, the Watch Allowance state, the PIN as a salted hash), the TV's device token hash, and Companion sessions.

Not in the backup, on purpose:

- The media cache (`sofa-media`): rebuilt from Immich on demand.
- Secret values. They live in `~/.config/sofa-os/secrets/` on rei3 and are never copied into backups: `companion_password_hash` (make a new one with `deploy/set-password.sh`), `ha_token` (a new long-lived token in Home Assistant), `immich_api_key` (a new key in Immich with `album.read`, `asset.read`, `asset.view`; an empty file turns Immich off). Keep these in your password manager.

Also needed for a rebuilt rei3, all in the repository or in the homeserver setup, not in the database:

- `deploy/compose.yaml` and its environment: `SOFA_HA_URL`, `SOFA_IMMICH_URL`, `SOFA_HA_DRY_RUN`, optional `SOFA_PUBLIC_URL`, `SOFA_TIME_ZONE`, `SOFA_ALLOWANCE_RESET`, `SOFA_ALLOWANCE_GRACE_SECONDS`, `SOFA_HA_TV_ENTITY`, `SOFA_HA_REMOTE_ENTITY`, `SOFA_HA_NOTIFY`.
- The Caddy route (`deploy/Caddyfile.snippet`, in `~/homeserver/caddy/Caddyfile`) and Pi-hole's name for `sofa.familie-farkas.de`.
- The external Docker network `homeserver_immich`.

## Copy backups off the machine

The volume sits on the same disk as the database, so it protects against a bad write, not a dead disk. Copy it elsewhere now and then, for example:

    docker run --rm -v sofa-os_sofa-backups:/b -v "$PWD":/out alpine cp -r /b /out/sofa-backups

(The volume name is `<compose project>_sofa-backups`; `docker volume ls` shows it.)

## Restore

1. Stop the Server: `docker compose -f deploy/compose.yaml stop sofa`.
2. Restore. `npm run restore -- <file>` checks the file first (`integrity_check`, schema version not newer than the Server's) and refuses a running Server (the target database cannot be locked) and an existing database unless `--force`. With `--force` the old database is kept as `sofa.db.before-restore`.

       docker compose -f deploy/compose.yaml run --rm sofa node server/src/restore.ts /backups/sofa-20261109T030000Z.db --force

3. Start it: `docker compose -f deploy/compose.yaml up -d sofa`. Migrations of a newer Server run on start.
4. Check Companion (login, Edit Home Screen shows the layout) and that the TV still syncs. The TV keeps its device token in the backup, so it does not need to sign in again unless the backup predates the sign-in.

A restore returns the Watch Allowance to its state at backup time. Today's used minutes may be too low or too high; top up or adjust in Companion.
