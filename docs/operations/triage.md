# Triage trees

One page per area: the symptom, the first check, the action. Each action names
the numbered section of [runbooks.md](runbooks.md) that holds the full
procedure, containment and escalation. Page names in backticks are alerts the
health check evaluates (see the [alert guide](alerts-and-security-posture.md)).
An alert whose monitor could not read its inputs stays as it was: a firing alert
keeps firing and a quiet one stays quiet until the read answers again.

## Site and release

| Symptom                                               | Check                                                                       | Action                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Site does not answer, health check fails              | Railway deployment status for web, then the health endpoint                 | Failed predeploy: the old containers keep serving, fix forward (§8). Region problem: §12. |
| Worker heartbeat stale (`worker.heartbeat.stale`)     | Worker deployment and boot logs; Queue Redis reachable                      | Redeploy the worker; if Redis is the cause go to Queue and Redis (§7).                    |
| Release deployed and something broke                  | Migration head against the running image; one authenticated journey         | Repair forward, never roll the schema back (§28).                                         |
| Pool exhausted or slow queries (`db.pool-exhaustion`) | Connection count in `pg_stat_activity`                                      | Lower worker concurrency, then tune (§8).                                                 |
| Alerts silent or errors missing in Sentry             | Whether the health check job still runs (`observability.snapshot-degraded`) | §16, §23.                                                                                 |
| Need to stop everything                               | Which switch: Google, AI, Guest pages or Optional email                     | Beta stop (§11).                                                                          |

## Restore

| Symptom                                             | Check                                                                                  | Action                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Data lost or corrupted                              | Backup and point-in-time state ([backup-and-lifecycle.md](backup-and-lifecycle.md) §1) | Contain the deployment, restore to a sibling service, verify in isolation before any cutover (§8). |
| Restored database comes back with Google or AI dark | Declared posture after the next web deploy                                             | §25.                                                                                               |
| Object missing from the bucket                      | Which prefix and whether the object has a journal entry                                | §20.                                                                                               |
| Erased data might return after a restore            | Erasure journal ([erasure-journal.md](erasure-journal.md))                             | Replay before cutover ([backup-and-lifecycle.md](backup-and-lifecycle.md) §8).                     |
| Retention work overdue (`retention.failure`)        | Latest retention runs and their failed subjects                                        | §8 recovery, then rerun the sweep.                                                                 |

## Google

| Symptom                                                                   | Check                                                                                    | Action                                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Failed syncs (`sync.failed-nonzero`)                                      | Failure codes in the alert facts; `provider_rejected` means Google refused that location | §13; a refused location needs the manager to fix it in Google, not a retry. |
| Property without a recent full reconciliation (`sync.reconciliation-age`) | Whether the Property is bound and its connection usable                                  | §13, §2 for authorization.                                                  |
| New reviews not arriving (`sync.sweep-lag`)                               | Oldest overdue Property and push state                                                   | §13.                                                                        |
| Newest page not covered by head checks (`sync.head-coverage`)             | `REVIEW_HEAD_CHECKS` is `persist` on the worker, and head-check outcomes                 | §13.                                                                        |
| Push missed or silent (`sync.push-missed`, `sync.push-silent`)            | Pub/Sub backlog and dead-letter queue                                                    | §4.                                                                         |
| 429 or 403 from Google                                                    | `classifySyncError` output, Cloud console quota                                          | §3.                                                                         |
| Import stuck or partial                                                   | Import state for the connection                                                          | §5.                                                                         |
| Reply outcome uncertain                                                   | Read the review back from Google first                                                   | §6; never resend a write.                                                   |
| Review content nearing expiry (`source.freshness-deadline`)               | Refresh sweep and connection status                                                      | §3, §13.                                                                    |

## Queue and Redis

| Symptom                                                                                  | Check                                    | Action                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| Queue backlog or old jobs (`queue.oldest-age`, `queue.stalled`)                          | Worker heartbeat; Redis connectivity     | §7.                                     |
| Quarantine not empty or growing (`queue.quarantine-nonempty`, `queue.quarantine-growth`) | Quarantined job families, not payloads   | Redrive after fixing the handler (§14). |
| Job family unready (`worker.job-runtime-unready`)                                        | The unready reasons in the health report | §17.                                    |
| Notifications or email stalled                                                           | Notification alert facts                 | §15; release steps §24.                 |
| Review Analysis stalled or empty                                                         | Coverage alert facts                     | §22.                                    |
| Redis wiped                                                                              | Schedulers and boot observations         | Redeploy the worker (§7).               |

## Security and privacy

| Symptom                                             | Check                                               | Action                                         |
| --------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| Account taken over                                  | Sessions for the account                            | Revoke sessions (§1).                          |
| Encryption or OAuth key exposed                     | Which key and where it was seen                     | Rotate (§2).                                   |
| Leaked secret or tenant data seen by another tenant | Scope of exposure, without copying customer content | §9, §19; stop first (§11).                     |
| Privacy request failing or erasure uncertain        | Request state in the rights path                    | §21, [rights-requests.md](rights-requests.md). |
| Property to suspend, disconnect or erase            | Lifecycle state                                     | §10.                                           |
| Portal image or address problem                     | Keyring and image state                             | §26, §27.                                      |
