# Storage And Data

`TARGET_DIRECTORY` is the host data root for the server. Use a dedicated
directory for EgoFlow data only.

## Host Layout

The stack prepares this layout:

```text
{TARGET_DIRECTORY}/
+-- postgres/
+-- redis/
+-- raw/
+-- datasets/
    +-- {owner_id}/
        +-- {repository_name}/
            +-- {video_id}.mp4
            +-- .dashboard/
            |   +-- {video_id}.mp4
            +-- .thumbnails/
                +-- {video_id}.jpg
```

| Path | Purpose |
| --- | --- |
| `postgres/` | PostgreSQL database files. |
| `redis/` | Redis append-only data and queue state. |
| `raw/` | Raw MediaMTX recording segments. |
| `datasets/` | Generated dataset outputs, dashboard playback copies, thumbnails, and temporary processing files. |

The backend stores generated dataset paths in PostgreSQL and serves files
through signed `/files/*` URLs.

## Raw Versus Generated Media

Raw recordings are input material for processing. Generated outputs are the
files intended for dashboard playback and dataset use:

- repository-level `{video_id}.mp4` for dataset and Python package access,
- `.dashboard/{video_id}.mp4` for dashboard playback,
- `.thumbnails/{video_id}.jpg` for previews.

If `DELETE_RAW_AFTER_PROCESSING` is `true`, raw files are removed after
successful processing. Failed or interrupted processing can leave raw files in
place for diagnosis.

## Target Directory Migration

`./scripts/run.sh up` records the last active data root in:

```text
.run/target-directory
```

When `TARGET_DIRECTORY` changes, `up` attempts to migrate the previous data root
to the new location before starting Compose. Migration is skipped when no
previous state exists. Migration is rejected when the old and new directories are
nested inside each other.

## Backups

Back up `TARGET_DIRECTORY` as a unit if you want a restorable server state. At a
minimum, include:

- `postgres/`
- `redis/`
- `datasets/`
- `raw/` if raw recordings should be retained

For active deployments, stop the stack or use storage/database tooling that can
produce consistent snapshots.

## Cleanup Cautions

The run script assumes `TARGET_DIRECTORY` belongs to EgoFlow. Do not point it at
a home directory, repository checkout, or shared data directory. `reset` removes
everything under `TARGET_DIRECTORY`.

Repository and video deletes also affect generated files managed by the server.
Keep external files outside `TARGET_DIRECTORY` unless they are intentionally
managed by EgoFlow.

## Database Schema

The public docs do not duplicate the full database schema. For the current
schema diagram, see [../.mermaid/DB/db-schema.mmd](../.mermaid/DB/db-schema.mmd).
