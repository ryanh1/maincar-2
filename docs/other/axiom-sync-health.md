# Axiom sync health

MAI-450 sends two event shapes to the configured `AXIOM_DATASET`:

- `job.queue.health` once per minute for `mail-backfill`, `mail-sync`,
  `mail-rematch`, and `capture-purge`, with `queueDepth`, `failureCount`, and
  `deadLetterCount`.
- `job.run` when one of those workers completes or fails, with `queue`,
  `outcome`, `durationMs`, and retry metadata.

The server idempotently creates `Maincar sync job failures (10m)` when
`AXIOM_CONTROL_TOKEN` and at least one `AXIOM_NOTIFIER_IDS` value are configured.
The monitor groups failures by queue and alerts when a queue exceeds
`AXIOM_FAILED_JOB_THRESHOLD` during its ten-minute window.

Use a least-privilege ingest token for `AXIOM_INGEST_TOKEN`. The separate control
token needs only monitor read/create access and should not be reused by workers.
