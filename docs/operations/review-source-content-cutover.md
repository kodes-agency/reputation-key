# Review source-content cutover

Migrations `0108_review_source_content_separation` and
`0116_stable_review_observations_and_material_revisions` form the Review expand
track. They separate the current source-content cache, add versioned source
observations and material revisions, make legacy provider fields nullable,
backfill deterministic revision 1, keep the Reply FK at `ON DELETE RESTRICT`,
and add content-free tombstone invariants. They do not remove compatibility
columns or activate a recurring sweep.

## Required order

1. Apply 0108 and then 0116 while Review lifecycle apply remains quarantined.
2. Deploy the repository-owned writer. New/updated observations must write the
   stable Review, current source-content cache, source observation, material
   revision, and minimal outbox fact in one transaction.
3. Reconcile rows excluded from observation backfill because a fetch/expiry field
   is missing; never invent a provider observation time.
4. Compare every active compatibility row with `review_source_contents` and
   the latest `review_source_observations` row by Review ID, tenant, Property,
   source epoch, material revision, expiry, and provider-controlled fields.
   Confirm every Review has revision 1 and each observation has a valid
   material-revision relationship.
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

- Provider-controlled Google reply text is not yet separated from RepKey-owned
  Reply history.
- Connection, property, and organization purge entry points now perform
  bounded source-content scrubbing while preserving stable Reviews and
  Replies. They still need to converge on the single checkpointed lifecycle
  authority, with production activation evidence, before recurring erasure is
  enabled.
- External backfill reconciliation, shadow-read parity, report-only production
  evidence, restore erasure evidence, and final schedule activation approval
  remain open. Repository and local PostgreSQL tests are implementation proof,
  not rollout evidence.
