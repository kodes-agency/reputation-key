// BQC-4.5 — region move store (real PostgreSQL, migration 0016).
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
import type {
  RegionMoveStore,
  RegionSwapResult,
} from '../../application/ports/region-move-store.port'
import {
  MOVE_TRANSITIONS,
  isTerminalMoveState,
  type RegionMoveRecord,
  type RegionMoveState,
} from '../../domain/region-move-workflow'
import { propertyError } from '../../domain/errors'

/** Terminal states derived from the machine — the single definition of
 * "in flight" (any non-terminal state) for the active-move lookup. */
const TERMINAL_STATES: ReadonlyArray<string> = (
  Object.keys(MOVE_TRANSITIONS) as RegionMoveState[]
).filter(isTerminalMoveState)

type RegionMoveRow = typeof regionMoves.$inferSelect

function moveFromRow(row: RegionMoveRow): RegionMoveRecord {
  return {
    id: row.id,
    propertyId: row.propertyId,
    organizationId: row.organizationId,
    fromRegion: row.fromRegion,
    toRegion: row.toRegion,
    // The CHECK constraint (region_moves_state_check) guarantees the set.
    state: row.state as RegionMoveState,
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
  db: Database,
  input: {
    orgId: string
    propertyId: string
    expectedRegion: string
    nextRegion: string
    resolvedAt: Date
  },
): Promise<RegionSwapResult> {
  const updated = await db
    .update(properties)
    .set({
      processingRegion: input.nextRegion,
      processingRegionSource: 'organization_override',
      routingPolicyVersion: sql`${properties.routingPolicyVersion} + 1`,
      processingRegionResolvedAt: input.resolvedAt,
      updatedAt: input.resolvedAt,
    })
    .where(
      and(
        eq(properties.id, input.propertyId),
        eq(properties.organizationId, input.orgId),
        eq(properties.processingRegion, input.expectedRegion),
        isNull(properties.deletedAt),
      ),
    )
    .returning({ id: properties.id })
  if (updated.length > 0) return 'swapped'

  // Idempotent retry of a crashed step: already sitting at the target.
  const current = await db
    .select({ region: properties.processingRegion })
    .from(properties)
    .where(
      and(
        eq(properties.id, input.propertyId),
        eq(properties.organizationId, input.orgId),
      ),
    )
    .limit(1)
  if (current[0]?.region === input.nextRegion) return 'already_active'
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

export function createRegionMoveRepository(db: Database): RegionMoveStore {
  return {
    insertMove: async (move) => {
      await db.insert(regionMoves).values({
        id: move.id,
        propertyId: move.propertyId,
        organizationId: move.organizationId,
        fromRegion: move.fromRegion,
        toRegion: move.toRegion,
        state: move.state,
        denialReason: move.denialReason,
        requestedBy: move.requestedBy,
        requestedAt: move.requestedAt,
        stateChangedAt: move.stateChangedAt,
        completedAt: move.completedAt,
        error: move.error,
      })
    },

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
      await db
        .update(regionMoves)
        .set({
          state: update.state,
          requestedBy: update.requestedBy,
          stateChangedAt: update.stateChangedAt,
          ...(update.completedAt !== undefined
            ? { completedAt: update.completedAt }
            : {}),
          ...(update.error !== undefined ? { error: update.error } : {}),
        })
        .where(and(eq(regionMoves.id, moveId), eq(regionMoves.organizationId, orgId)))
    },

    activateTargetRegion: async (input) =>
      guardedRegionSwap(db, {
        orgId: input.orgId,
        propertyId: input.propertyId,
        expectedRegion: input.fromRegion,
        nextRegion: input.toRegion,
        resolvedAt: input.resolvedAt,
      }),

    restoreSourceRegion: async (input) =>
      guardedRegionSwap(db, {
        orgId: input.orgId,
        propertyId: input.propertyId,
        expectedRegion: input.toRegion,
        nextRegion: input.fromRegion,
        resolvedAt: input.resolvedAt,
      }),
  }
}
