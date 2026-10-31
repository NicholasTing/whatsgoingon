# Persistence and recovery

Run one continuously available app instance with a persistent disk, and keep backups on another system. This preserves observations across deployments and gives you a recovery path if the host or disk fails. You supply the storage and any credentials it requires.

## What is saved where

| Data | Location | How to keep it |
| --- | --- | --- |
| Selected services, component selections, and groups | `services.json` (or build-time `SERVICES_CONFIG`), compiled to `dist/board.json` | Keep the source file with your deployment configuration. Rebuild and redeploy after editing it. |
| Provider snapshots, incident reports, observation history, alert baselines, and queued deliveries | `status.sqlite` inside `DATA_DIR` | Retain the data volume and back it up. |
| Background alert configuration | Your `WATCH_CONFIG` file | Keep a private copy outside the release directory, or mount it from your own secret store. Back it up separately. |

Every visitor uses the service selection saved during the build. A production restart reads the same snapshot; it does not reload the source service array. Old browser boards and shared configuration links are ignored, and their local storage is left intact. The browser's **Activity** list is held in memory and clears on reload; retained provider incident reports are separate.

Configured monitors register at startup and continue collecting without an open browser. The static provider dictionary is in `server/catalog.ts`. History has rolling retention, so the database is not an indefinite archive.

Service configuration does not use SQLite. Runtime editing is not included. If you want it, you must implement and maintain your own database and authenticated editing API; setting a database URL alone does not enable it.

## Keep data across deployments

### Docker Compose

The included `compose.yaml` mounts the named volume `status-data` at `/data`, which is the image's default `DATA_DIR`. Keep the same Compose project name and retained volume when updating the app. For a new deployment, you can set a stable name explicitly:

```sh
docker compose -p whatsgoingon up --build -d
```

If you already deployed with another project name, continue using that name. Switching names can create a new, empty volume while leaving the original data elsewhere.

Container recreation retains a named volume. `docker compose down` also retains it, but **`docker compose down --volumes` deletes it**. A volume on the same host is not a backup against host loss. See Docker's [volume lifecycle](https://docs.docker.com/engine/storage/volumes/#a-volumes-lifecycle) and [Compose removal options](https://docs.docker.com/reference/cli/docker/compose/down/).

### Node or a hosting platform

Mount a persistent disk and set `DATA_DIR` to an absolute path on it. For example, after creating `/srv/whatsgoingon/data` with write access for the app's service user:

```sh
DATA_DIR=/srv/whatsgoingon/data HOST=0.0.0.0 PORT=4173 npm start
```

Without `DATA_DIR`, the app uses `.data` relative to its working directory. A new release directory can therefore produce a new database. Keep the data path outside the release directory, retain the disk during redeployments, and use a process supervisor or the hosting platform's restart policy.

Run a single replica. The collector and alert worker have no coordination between replicas. Sleeping instances leave observation gaps, and an ephemeral serverless filesystem cannot retain the database across replacements.

## Where to store data

| Storage | Use |
| --- | --- |
| Local persistent disk, Docker named volume, or an attached block volume mounted by one host | Live SQLite database. Back it up separately from the host. |
| Private object storage or another machine under your control | Backup archives. Keep several versions and encrypt them in transit and at rest. These are not live SQLite mounts. |
| Shared network filesystem, such as NFS | Do not use for the live database. SQLite's WAL mode requires processes on the same host and does not support network filesystems. |
| Managed SQL database | Requires application changes. The app currently uses SQLite; setting a database URL does not switch it to PostgreSQL or another database. |

SQLite can hold committed changes in `status.sqlite-wal` before they reach `status.sqlite`. Copying only the database file while the app runs can lose those changes. See [SQLite's WAL documentation](https://sqlite.org/wal.html).

## Back up

The simplest backup procedure pauses collection briefly:

1. Stop the app and confirm that no process is writing to its database. For Compose, use `docker compose -p whatsgoingon stop app`, substituting your existing project name.
2. Archive the **whole data directory**, including any `status.sqlite-wal` and `status.sqlite-shm` files. Write the archive outside the data directory and repository. For a named volume, use Docker's [volume backup procedure](https://docs.docker.com/engine/storage/volumes/#back-up-a-volume) while the app remains stopped.
3. Confirm that the archive command succeeded, then restart the app. For Compose, use `docker compose -p whatsgoingon start app`. Restart it even if the backup failed, and resolve the failed backup separately.
4. Copy the archive to your own private storage on another system. Keep the services.json file and private watch configuration as separate backups.

For a data directory you can access directly, this creates a private backup directory. Replace `/path/to/data` with the stopped app's actual `DATA_DIR`:

```sh
umask 077
backup_dir="$(mktemp -d "$HOME/whatsgoingon-backup.XXXXXX")"
tar -C /path/to/data -czf "$backup_dir/status-data.tar.gz" .
```

For backups without stopping collection, use a SQLite-aware backup tool or the [Node SQLite backup API](https://nodejs.org/api/sqlite.html). A normal file copy of a running database is not a substitute.

Schedule backups at an interval that matches how much history you can afford to lose, retain older versions, and check for failures. Backup scheduling and remote uploads are not built into the app.

Treat the database and its backups as private: queued webhook destinations and payloads can contain credentials. Keep them out of Git, container images, and public buckets. Store your backup credentials with your hosting platform or backup process.

## Restore and verify

1. Stop the app. Keep the current data directory intact until recovery is verified.
2. Extract a trusted backup into a **new, empty directory or volume**. Do not mix its database and WAL files with an existing database. For a directory archive, use `tar -xzf /path/to/status-data.tar.gz -C /path/to/empty-restore-directory`.
3. Give the app's service user access to the restored files. Check the database before starting the server, using Node 24 or later:

   ```sh
   node --input-type=module - /path/to/empty-restore-directory/status.sqlite <<'JS'
   import assert from 'node:assert/strict';
   import { DatabaseSync } from 'node:sqlite';
   const db = new DatabaseSync(process.argv[2], { readOnly: true });
   assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
   db.close();
   console.log('Database integrity check passed.');
   JS
   ```

4. Review pending alert deliveries before starting. A restored backup can replay old notifications, and queued deliveries can be sent even when `WATCH_CONFIG` is unset. Keep outbound network access disabled during an isolated recovery rehearsal; omitting the config alone does not prevent delivery.
5. Point `DATA_DIR` or the container's `/data` mount at the restored directory or volume. Start the app when you are ready to resume collection and delivery. Check `/api/health` and confirm that expected historical dates and incidents appear on the board.
6. Restore your services.json file and private watch configuration separately. If the service selection changed, rebuild and redeploy the app (for Compose, use `up --build -d` with the same project name and volume), then reload the page. Restart the server after restoring the watch configuration. All configured monitors register at startup.

Rehearse recovery on a separate directory or volume before relying on backups. An integrity check confirms database structure, not that the backup contains all the history you expected. Observations collected after the backup are lost unless you have a newer recoverable copy; gaps while the app was stopped cannot be reconstructed by restoring an older database.
