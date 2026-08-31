# Recent Activity recovery and readiness

## Scope and claims

This procedure repairs the cell-local **Recent Activity** manager convenience
feed. It does not repair source workflows, prove that a source transaction
occurred, or provide audit/tamper evidence. Operational Action History is a
separate product and is not implemented by these tables.

The durable source for this procedure is Activity's
`recent_activity_replay_facts` authority. Each canonical row contains only the
source event identity/version, tenant/resource identifiers, allowlisted state
codes, and source occurrence time. It deliberately excludes actor display
labels, Property/Organization names, archive and moderation reasons, Review or
Reply text, private feedback/contact, notes, credentials, tokens, and network
identifiers.

## Readiness meanings

- `Ready / projection_current`: every retained projectable replay fact has a
  corresponding Recent Activity row at the explicit observation time.
- `Updating / within_visibility_target`: at least one retained fact is missing,
  but the oldest gap is no more than five minutes old.
- `Unavailable / visibility_target_exceeded`: the oldest gap is over five
  minutes old.
- `Unavailable / authority_store_unavailable`: the coherent read of the replay
  authority and projection failed. Counts are unknown, never reported as zero.

Readiness is computed in one repeatable-read snapshot. `legacySnapshotCount`
discloses how much of the retained baseline came from the minimized migration
snapshot; those rows are never presented as source-event provenance.

## Bounded repair procedure

1. Capture an explicit UTC observation time and read readiness.
2. If state is `Updating`, allow the normal durable consumer up to the five-minute
   visibility target before intervening.
3. Run `pnpm ops:recover-recent-activity --operator <id> --batch-size 100
--apply --reason <text> <observed-at>`. Save its returned cursor.
4. Repeat with the emitted `<after-occurred-at> <after-replay-key>` positional
   cursor while `complete=false` and `failed=0`.
5. If `failed=1`, retry using the last returned cursor. Recovery stops before the
   failed fact, so the cursor never skips it. Investigate database and actor
   lookup availability if it fails again.
6. Read readiness again at a new explicit observation time. Do not declare
   recovery complete until it is `Ready`.

Each restored row is idempotent. A process interruption can leave only already
committed rows; rerunning converges without duplicates. The initial durable
consumer co-commits replay capture, projection, and shared consumer receipt, so
there is no projection-only success boundary.

## Retention and rollback

Both `recent_activity_replay_facts.source_occurred_at` and
`recent_activity_entries.created_at` use the same source occurrence clock and expire after
exactly 90 days through bounded retention sweeps with `retention_runs` evidence.
Published outbox rows remain on their separate 30-day policy.

Disabling the feed reader does not delete source facts or Operational Action
History. Do not extend either Activity table's retention to preserve an audit
claim. A rollback may stop projection consumption, but readiness must remain
Unavailable until the durable backlog is repaired.

## Runtime registration and operator reachability

The Activity context constructs and registers consumer
`activity.recent-activity` under module `activity.outbox-consumers` in the worker
composition, and the central entry-point/event-job catalogues describe that
source-composed path. `ops:recover-recent-activity` is the authenticated
operator-command surface for both readiness and bounded recovery. It evaluates
`activity.use`, records the named operator decision, defaults to report-only,
and requires `--apply` plus a reason before restoring projections.
