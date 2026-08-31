# Review source-content cutover

Migrations `0108_review_source_content_separation` and
`0116_stable_review_observations_and_material_revisions` form the Review expand
track. They separate the current source-content cache, add versioned source
observations and material revisions, make legacy provider fields nullable,
backfill deterministic revision 1, keep the Reply FK at `ON DELETE RESTRICT`,
and add content-free tombstone invariants. They do not remove compatibility
columns or activate a recurring sweep.

Migration `0126_inbox_review_source_content_free` backfills and constrains the
three legacy Inbox convenience-copy columns for Review items. Migration
`0127_review_lifecycle_cursor` adds the exact `(created_at, id)` index used by
the frozen lifecycle keyset so every page remains operationally bounded as
stable Review history grows.

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

## Local lifecycle authority

`purge-expired-reviews` and `ops:purge reviews` now converge on
`review-source-content-lifecycle-v1`. The authority freezes an `evaluatedAt`
window and resumes by `(createdAt, ReviewId)`. `report` classifies eligible,
expired, tombstoned, and unverifiable stable Reviews. `shadow` compares the
compatibility row with `review_source_contents`, the current source observation,
the current material revision, and legacy Google-reply mirrors entirely inside
PostgreSQL; only booleans, counts, and stable Review IDs leave storage. Provider
content is never emitted. Queued reports continue with deterministic checkpoint
job identities, so an enqueue retry cannot create two logical continuations.

Local `apply` exists but fails closed unless its caller injects an explicit
reviewed-cutover authorizer. The authorizer must return a content-free approval
ID, immutable evidence SHA-256, and approval timestamp. Every continuation
revalidates the exact same approval seal. One bounded page is discovered,
locked in deterministic Property/Reply-truth/Review/mapping order, rechecked, erased,
and evidenced in one PostgreSQL transaction. An apply window ahead of the
database clock is rejected before mutation, and a failed row rolls back the
whole page. Stable Review, internal Reply, Inbox, outbox, observation, and
material revision identities remain; provider-controlled values are removed
or tombstoned across every historical source epoch. The ordinary composition
root supplies no apply authorizer, and the recurring job accepts only `report`
or `shadow`, so this implementation is not production activation permission.

Re-observation and provider-deletion writers use the same canonical lock order.
This prevents lifecycle expiry, re-observation, and deletion confirmation from
forming a lock cycle while retaining the stable Review and manager Reply.

Connection, Property, Organization, and legacy raw-expiry entry points delegate
to this same Review-owned apply store. A legacy `google_sync` Reply mirror is
removed only when a current governed Google Reply Observation head proves it is
redundant. An active mirror without that proof is retained and reported as
`active_google_sync_reply_unreconciled`; source expiry still erases all provider
text. A later valid provider observation restores source content on the same
stable Review without replacing manager-owned Reply or Inbox identity.

A checkpointed report can observe rows changing during its window; external
zero-difference evidence therefore still requires the prescribed repeated
shadow window before cutover approval.

Rollback is forward-only after any tombstone is written: disable lifecycle
application and fix forward. Never deploy code that hard-deletes Reviews or
cascade-deletes Replies, and never reconstruct erased provider content from
logs, events, derivatives, or backups.

## Cutover blockers still open

- External backfill reconciliation and a production zero-difference shadow
  window remain required.
- Report-only production evidence, approved restore/erasure proof, and the final
  recurring-schedule activation approval remain open.
- The checked-in restore verifier is inspection-only by default. Its sealed
  restore-only executor now accepts only an exact digest-pinned, trusted
  Ed25519 approval and stores a one-shot immutable receipt; see
  `review-lifecycle-recovery-approval.md`. A real independently approved
  restore/erasure drill and its external evidence remain open.
- Any `active_google_sync_reply_unreconciled` finding must be resolved by a
  governed provider re-observation or an explicit reviewed disposition before
  recurring apply is activated. It must never be guessed from the legacy text.

Repository and local PostgreSQL tests are implementation proof, not rollout
evidence.

## Current provider reputation handoff

The provider-snapshot lifecycle now preserves Google's count and average on
every main and confirmation page. Drift in either value fails the run. Only a
fully completed double scan plus bounded missing-source reconciliation may
co-commit the content-minimal `review.google_reputation_snapshot.verified`
fact. Metric projects that fact into a distinct source-epoch-fenced **Current
on Google** table; it is not a bounded-period metric and does not relax this
cutover's report-first or recurring-apply quarantine. See
`current-google-reputation-snapshot.md`.
