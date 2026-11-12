// Review — retention of `review_provider_snapshot_runs` and their members.
//
// A run's members (one row per Review its listing saw) are read only while the
// run is active, but every run kept all of them: about 48,000 rows a day. The
// keep rule leaves every reader its answer:
//
// - the active run: the run in progress reads its own members and candidates,
//   and stamps its observation origin on the revisions it first sees, which
//   is what Inbox response targets read later;
// - the latest completed run of each Property source epoch: the setup
//   checklist and Property setup ask whether the current epoch has completed
//   a listing;
// - the latest three runs of each Property: a listing that moved reads the two
//   runs before the active one (`snapshot-listing-change.ts`). Runs lost to a
//   cursor store restart or an unusable Google connection are skipped by that
//   reader, so they do not count towards the three either.
//
// The unlisted-review hold counts down on the mapping and survives the run
// that began it (`review-provider-snapshot-listing.ts`); a mapping whose hold
// is still read from that run gets its count here before the run goes. The
// first miss is a time and a run id with no foreign key, so the two-listing
// removal protection does not read the deleted run.
//
// Each batch is one short transaction: it locks a few runs with SKIP LOCKED,
// releases the mappings they were the last sighting of (leaving any a
// snapshot run holds for a later batch), deletes a bounded slice of their
// members, and deletes the runs nothing points at any more. A run whose
// members span several batches is finished by the next ones; nothing reads
// the members of a run outside the keep rule.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { DEFAULT_MAX_BATCHES_PER_RUN } from '#/shared/db/retention/execute-retention-rule'
import type { ObservationRetentionScope } from '../../application/ports/observation-retention.port'
import type { SnapshotRunRetention } from '../../application/ports/snapshot-run-retention.port'
import {
  foundUnlistedByLastRun,
  legacyHoldRunsLeft,
} from './review-provider-snapshot-listing'

/** Runs locked per batch. */
export const SNAPSHOT_RUNS_PER_BATCH = 20
/** Member rows deleted per batch; a run lists at most 10,000 Reviews. */
export const SNAPSHOT_MEMBERS_PER_BATCH = 5_000
/** The latest runs of a Property kept whatever they ended with. */
const LATEST_RUNS_KEPT = 3

function organizationCondition(scope: ObservationRetentionScope = {}): SQL {
  return scope.organizationId === undefined
    ? sql`TRUE`
    : sql`run.organization_id = ${scope.organizationId}`
}

/** Terminal runs outside the keep rule, as ids. */
const supersededRuns = (scope: ObservationRetentionScope | undefined) => sql`
  SELECT ranked.id FROM (
    SELECT run.id, run.state,
      row_number() OVER (
        PARTITION BY run.organization_id, run.property_id, run.source_epoch
        ORDER BY (run.state = 'completed') DESC, run.started_at DESC, run.id DESC
      ) AS completed_rank,
      count(*) FILTER (
        WHERE run.failure_code IS DISTINCT FROM 'cursor_lost'
          AND run.failure_code IS DISTINCT FROM 'connection_unusable'
      ) OVER (
        PARTITION BY run.organization_id, run.property_id
        ORDER BY run.started_at DESC, run.id DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS newer_runs
    FROM review_provider_snapshot_runs run
    WHERE ${organizationCondition(scope)}
  ) ranked
  WHERE ranked.state IN ('completed', 'failed')
    AND NOT (ranked.state = 'completed' AND ranked.completed_rank = 1)
    AND ranked.newer_runs >= ${LATEST_RUNS_KEPT}`

type BatchResult = Readonly<{ locked: number; runs: number; members: number }>

const idList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

async function deleteSupersededBatch(
  db: Database,
  scope: ObservationRetentionScope | undefined,
): Promise<BatchResult> {
  return db.transaction(async (tx) => {
    // A terminal run never changes again, and no reader moves an older run
    // back inside the keep rule, so a run selected here stays superseded.
    const locked = await tx.execute<{ id: string }>(sql`
      SELECT run.id FROM review_provider_snapshot_runs run
      WHERE run.state IN ('completed', 'failed')
        AND run.id IN (${supersededRuns(scope)})
      ORDER BY run.started_at, run.id
      LIMIT ${SNAPSHOT_RUNS_PER_BATCH}
      FOR UPDATE OF run SKIP LOCKED
    `)
    const ids = locked.rows.map((row) => row.id)
    if (ids.length === 0) return { locked: 0, runs: 0, members: 0 }

    // Release the mappings these runs saw last, writing the count of a hold
    // still read from its run. A mapping a snapshot run holds is skipped, and
    // its run stays until a later batch can release it.
    await tx.execute(sql`
      UPDATE review_provider_subjects target
      SET last_seen_snapshot_run_id = NULL,
          unlisted_hold_runs_left = COALESCE(target.unlisted_hold_runs_left, held.runs_left),
          updated_at = transaction_timestamp()
      FROM (
        SELECT s.organization_id, s.property_id, s.source_epoch, s.key_version,
          s.locator_hmac,
          CASE
            WHEN s.unlisted_hold_runs_left IS NULL
              AND ${foundUnlistedByLastRun}
            THEN ${legacyHoldRunsLeft}
          END AS runs_left
        FROM review_provider_subjects s
        WHERE s.last_seen_snapshot_run_id IN (${idList(ids)})
        FOR UPDATE OF s SKIP LOCKED
      ) held
      WHERE target.organization_id = held.organization_id
        AND target.property_id = held.property_id
        AND target.source_epoch = held.source_epoch
        AND target.key_version = held.key_version
        AND target.locator_hmac = held.locator_hmac
    `)

    const members = await tx.execute(sql`
      DELETE FROM review_provider_snapshot_members target
      USING (
        SELECT run_id, review_id FROM review_provider_snapshot_members
        WHERE run_id IN (${idList(ids)})
        LIMIT ${SNAPSHOT_MEMBERS_PER_BATCH}
      ) doomed
      WHERE target.run_id = doomed.run_id AND target.review_id = doomed.review_id
    `)

    // Removal candidates cascade with their run; nothing else references it.
    const runs = await tx.execute(sql`
      DELETE FROM review_provider_snapshot_runs run
      WHERE run.id IN (${idList(ids)})
        AND NOT EXISTS (
          SELECT 1 FROM review_provider_snapshot_members m WHERE m.run_id = run.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM review_provider_subjects s
          WHERE s.last_seen_snapshot_run_id = run.id
        )
    `)
    return {
      locked: ids.length,
      runs: runs.rowCount ?? 0,
      members: members.rowCount ?? 0,
    }
  })
}

export const createSnapshotRunRetention = (db: Database): SnapshotRunRetention => ({
  sweepSupersededRuns: async ({
    maxBatches = DEFAULT_MAX_BATCHES_PER_RUN,
    scope,
  } = {}) => {
    let batches = 0
    let runs = 0
    let members = 0
    for (;;) {
      const batch = await deleteSupersededBatch(db, scope)
      // Nothing left, or only runs a snapshot run still holds a mapping of:
      // those wait for the next scheduled pass.
      if (batch.runs === 0 && batch.members === 0) {
        return { batches, runs, members, capped: false }
      }
      batches += 1
      runs += batch.runs
      members += batch.members
      if (batches >= maxBatches) return { batches, runs, members, capped: true }
    }
  },
})
