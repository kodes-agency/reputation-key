# Review source-content cutover

Migration `0108_review_source_content_separation` is an expand migration. It
creates `review_source_contents`, makes the legacy provider fields nullable,
backfills rows with complete fetch-lifecycle controls, changes the Reply FK to
`ON DELETE RESTRICT`, and adds the content-free tombstone invariant. It does
not remove compatibility columns or activate a recurring sweep.

## Required order

1. Apply 0108 while destructive Review jobs remain quarantined.
2. Deploy dual-write code. New/updated observations must write the stable
   Review and source-content cache in one transaction.
3. Reconcile rows excluded from backfill because a required fetch/expiry field
   is missing; never invent a provider observation time.
4. Compare every active compatibility row with `review_source_contents` by
   Review ID, tenant, Property, source epoch/revision, expiry, and raw fields.
5. Run provider-deleted, source-expired, and re-observed real-PostgreSQL tests.
6. Shadow new reads, then record a zero-difference observation window.
7. Only after approval, activate the checkpointed field-erasure lifecycle.
8. Contract legacy raw columns only in a later forward migration after all
   deployed readers use the new table.

Rollback is forward-only after any tombstone is written: disable lifecycle
application and fix forward. Never deploy code that hard-deletes Reviews or
cascade-deletes Replies, and never reconstruct erased provider content from
logs, events, derivatives, or backups.

## Cutover blockers still open

- Versioned Review Source Observations and Material Review Revisions, including
  deterministic normalization-version shadow comparison, are not yet modeled.
- Provider-controlled Google reply text is not yet separated from RepKey-owned
  Reply history.
- Connection, property, and organization purge entry points now perform
  bounded source-content scrubbing while preserving stable Reviews and
  Replies. They still need to converge on the single checkpointed lifecycle
  authority, with production activation evidence, before recurring erasure is
  enabled.
- Backfill reconciliation, shadow-read parity, report-only production evidence,
  restore erasure evidence, and the final schedule activation approval remain.
