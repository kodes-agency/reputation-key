// BQC-4.5 — region move store (real PostgreSQL, migrations 0016, 0147–0148).
//
// Implements the application RegionMoveStore port. The authority swap is ONE
// guarded UPDATE on properties: it matches only while the property still sits
// at the expected region, so the source-of-truth change is atomic and a
// retried step is idempotent. Drift (region neither from nor to) throws
// region_move_conflict — the move cannot silently proceed on a moved truth.

import { and, eq, isNull, notInArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { regionMoves } from '#/shared/db/schema/region-move.schema'
import type { RegionMoveStore } from '../../application/ports/region-move-store.port'
import {
  assertValidMoveTransition,
  MOVE_TRANSITIONS,
  isTerminalMoveState,
  type RegionMoveRecord,
  type RegionMoveState,
} from '../../domain/region-move-workflow'
import { propertyError } from '../../domain/errors'
import { dataCellById } from '#/shared/domain/data-cell-catalogue'

/** Terminal states derived from the machine — the single definition of
 * "in flight" (any non-terminal state) for the active-move lookup. */
const TERMINAL_STATES: ReadonlyArray<string> = (
  Object.keys(MOVE_TRANSITIONS) as RegionMoveState[]
).filter(isTerminalMoveState)

type RegionMoveRow = typeof regionMoves.$inferSelect
type RegionMoveTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

function moveFromRow(row: RegionMoveRow): RegionMoveRecord {
  return {
    id: row.id,
    propertyId: row.propertyId,
    organizationId: row.organizationId,
    fromRegion: row.fromRegion,
    toRegion: row.toRegion,
    // The CHECK constraint (region_moves_state_check) guarantees the set.
    state: row.state as RegionMoveState,
    stateRevision: row.stateRevision,
    denialReason: row.denialReason,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    stateChangedAt: row.stateChangedAt,
    completedAt: row.completedAt,
    error: row.error,
  }
}

/** ONE guarded region UPDATE; expectedRegion is the guard, nextRegion the swap. */
async function guardedRegionSwap(
  tx: RegionMoveTransaction,
  input: {
    orgId: string
    propertyId: string
    expectedRegion: string
    nextRegion: string
    resolvedAt: Date
  },
): Promise<void> {
  const expectedCell = dataCellById(input.expectedRegion)?.id
  const nextCell = dataCellById(input.nextRegion)?.id
  if (!expectedCell || !nextCell) {
    throw propertyError(
      'region_move_conflict',
      'region move contains a Data Cell absent from the signed catalogue',
    )
  }
  const updated = await tx
    .update(properties)
    .set({
      processingRegion: nextCell,
      dataCellId: nextCell,
      processingRegionSource: 'organization_override',
      routingPolicyVersion: sql`${properties.routingPolicyVersion} + 1`,
      processingRegionResolvedAt: input.resolvedAt,
      updatedAt: input.resolvedAt,
    })
    .where(
      and(
        eq(properties.id, input.propertyId),
        eq(properties.organizationId, input.orgId),
        eq(properties.processingRegion, expectedCell),
        eq(properties.dataCellId, expectedCell),
        isNull(properties.deletedAt),
      ),
    )
    .returning({ id: properties.id })
  if (updated.length > 0) return

  // Idempotent retry of a crashed step: already sitting at the target.
  const current = await tx
    .select({ region: properties.dataCellId })
    .from(properties)
    .where(
      and(
        eq(properties.id, input.propertyId),
        eq(properties.organizationId, input.orgId),
      ),
    )
    .limit(1)
  if (current[0]?.region === nextCell) return
  throw propertyError(
    'region_move_conflict',
    'property processing region drifted under the move — aborting the authority change',
    {
      propertyId: input.propertyId,
      expectedRegion: input.expectedRegion,
      currentRegion: current[0]?.region ?? null,
    },
  )
}

export const createRegionMoveRepository = (db: Database): RegionMoveStore => ({
  findMoveById: async (orgId, moveId) => {
    const rows = await db
      .select()
      .from(regionMoves)
      .where(and(eq(regionMoves.id, moveId), eq(regionMoves.organizationId, orgId)))
      .limit(1)
    return rows[0] ? moveFromRow(rows[0]) : null
  },

  findActiveMoveForProperty: async (orgId, propertyId) => {
    const rows = await db
      .select()
      .from(regionMoves)
      .where(
        and(
          eq(regionMoves.propertyId, propertyId),
          eq(regionMoves.organizationId, orgId),
          notInArray(regionMoves.state, [...TERMINAL_STATES]),
        ),
      )
      .limit(1)
    return rows[0] ? moveFromRow(rows[0]) : null
  },

  updateMoveState: async (orgId, moveId, update) => {
    // The CAS proves the row still has the caller's expected token. Validate
    // that token's transition as well so a direct store caller cannot use a
    // current terminal revision to reopen the durable machine.
    assertValidMoveTransition(update.expectedState, update.state)
    return db.transaction(async (tx) => {
      // Lock the exact CAS token before any critical authority effect. A
      // concurrent winner changes the row while this SELECT waits; PostgreSQL
      // then re-checks the predicate and this transaction returns stale.
      const locked = await tx
        .select()
        .from(regionMoves)
        .where(
          and(
            eq(regionMoves.id, moveId),
            eq(regionMoves.organizationId, orgId),
            eq(regionMoves.state, update.expectedState),
            eq(regionMoves.stateRevision, update.expectedStateRevision),
          ),
        )
        .limit(1)
        .for('update')
      const move = locked[0]
      if (!move) return 'stale'

      // These two states change the Property's single authoritative Data Cell.
      // Keep the old move state visible while the Property trigger validates
      // the edge, then commit the swap and move transition together.
      if (update.state === 'target_activated') {
        await guardedRegionSwap(tx, {
          orgId,
          propertyId: move.propertyId,
          expectedRegion: move.fromRegion,
          nextRegion: move.toRegion,
          resolvedAt: update.stateChangedAt,
        })
      } else if (update.state === 'rolling_back') {
        await guardedRegionSwap(tx, {
          orgId,
          propertyId: move.propertyId,
          expectedRegion: move.toRegion,
          nextRegion: move.fromRegion,
          resolvedAt: update.stateChangedAt,
        })
      }

      const rows = await tx
        .update(regionMoves)
        .set({
          state: update.state,
          stateRevision: sql`${regionMoves.stateRevision} + 1`,
          requestedBy: update.requestedBy,
          stateChangedAt: update.stateChangedAt,
          ...(update.completedAt !== undefined
            ? { completedAt: update.completedAt }
            : {}),
          ...(update.error !== undefined ? { error: update.error } : {}),
        })
        .where(
          and(
            eq(regionMoves.id, moveId),
            eq(regionMoves.organizationId, orgId),
            eq(regionMoves.state, update.expectedState),
            eq(regionMoves.stateRevision, update.expectedStateRevision),
          ),
        )
        .returning({ id: regionMoves.id })
      if (rows.length !== 1) {
        throw propertyError(
          'region_move_conflict',
          'locked region move changed before its transition could commit',
          { moveId, expectedStateRevision: update.expectedStateRevision },
        )
      }
      return 'updated'
    })
  },
})
