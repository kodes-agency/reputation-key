# Erasure journal

`pnpm ops rights-request --apply` writes one journal object per context to the
private bucket before that context deletes anything (see `rights-requests.md`).
Guest self-service withdrawal does not write it yet. The restore verifier replays
a local journal export (`journal=<file>`) through the resurrection fence.

## Bucket evidence

`shared/db/lifecycle/erasure-journal.server.ts` validates a closed record of
subject identities, opaque references, lifecycle revision and timing/count
metadata. It rejects unknown fields and content-bearing shapes. Do not put
names, addresses, feedback, provider content or credentials in any reference.
The record uses the existing lifecycle subject/context vocabulary. Optional
`journalTargets` stores up to 200 unique UUIDs for a response, feedback,
Staff Participant or one-off batch; membership cannot depend on restored rows.
Each target kind has a separate replayer registration, with no Organization-wide
fallback. A context's batch replayer must own one explicit erasure contract;
introduce an operation-specific kind before adding a second batch operation. Each one-off
purge batch needs its own stable journal ID; retries must reuse the exact ID and
bytes. No hash chain or new database table is used.

`journalBeforeErasure` waits for the bucket write before invoking the callback
that opens the deletion transaction. A failed write calls the required
content-free alert sink and refuses deletion. Unresolved holds are refused before
writing an intent or calling deletion. Callers must bind that sink to
monitoring when they are activated. The bucket adapter refuses writes without
the 45-day expiry rule. A conflicting immutable retry also blocks deletion.
Age-based retention reruns after restore and does not use this journal.

The `recordedBeforeErasure` marker distinguishes an intent from a completed
database receipt. Replay must include every intent, even if its timestamp
predates the restore point: the snapshot may fall between the bucket write and
the deletion commit. An intent whose deletion failed is safely replayed too.
Replayers must be idempotent, tenant-scoped and registered for the exact subject
class and context. An unknown replayer fails verification closed; documented
holds retain their existing explicit deferral behavior.

## Operator commands

Run outside the isolated verifier, using the operator's own credentials for the
existing private bucket: `AWS_S3_ACCESS_KEY`, `AWS_S3_SECRET_ACCESS_KEY`,
`AWS_S3_BUCKET_NAME` and `AWS_S3_REGION`. Existing `S3_PRESIGN_ENDPOINT`,
`S3_INTERNAL_ENDPOINT` and `S3_FORCE_PATH_STYLE` settings are supported. Commands
never fetch credentials from the restored application or database and never
print them. Any `RESTORE_MODE` setting refuses bucket access.

- `pnpm ops erasure-journal-expiry` checks the journal-only 45-day lifecycle rule.
  It fails when the rule is missing or another overlapping rule expires evidence
  early. `--apply` preserves unrelated rules, sets journal expiry, and verifies
  read-back. Review this bucket configuration step before running it; nothing
  configures it on deployment or startup.
- `pnpm ops erasure-journal-export --output <file>` reads only journal objects,
  follows bounded pagination, validates every record and writes a new local
  file with mode `0600`. It refuses to overwrite evidence. Stop erasure writers
  before exporting and keep them stopped through restore and cutover;
  bucket listing is not a snapshot of concurrent writes.

Export before restoring, then move only the local file into the isolated
verification environment. `decodeErasureJournalExport` needs no credentials or
side services; its entries are the explicit input to
`applyRestoreResurrectionFence`. Never substitute the restored database ledger
for this input. An export must cover the chosen restore point and all later
nonrepeating erasures. Keep the local file private and delete it under the
recovery procedure after use.

## Activation prerequisites

Before activating any journal-dependent erasure, complete the isolated verifier's
local-file wiring and command-level resurrected-erasure proof, including a
negative control that omits replay. Confirm the passing data restore rehearsal,
backups within 30 days including Manual backups, the applicable published notice,
and the owner's approval of the actual activation step. Bucket expiry must be
applied and checked against the real provider. Do not repeat a passing owner
restore rehearsal. No activation switch, schedule or deletion authority is added
here.
