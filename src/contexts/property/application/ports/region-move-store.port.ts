// Region move store — persistence port for the BQC-4.5 move workflow.
//
// Callers must not know Drizzle types. The production implementation
// (infrastructure/repositories/region-move.repository.ts) persists to
// region_moves (migrations 0016, 0147–0148) and executes the authority swap on properties
// as ONE guarded UPDATE (the source-of-truth change is atomic).
//
// Request creation is deliberately absent from this port: accepted requests
// must use RegionMoveRequestCommandStore so the row cannot be inserted without
// its required operator decision. This store owns only post-request reads and
// guarded machine transitions.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { RegionMoveRecord, RegionMoveState } from '../../domain/region-move-workflow'

/** State write for one stepper transition. The expected state + revision are
 * the compare-and-swap token; requestedBy/stateChangedAt advance on every
 * successful step (the confirming operator is recorded). */
export type RegionMoveStateUpdate = Readonly<{
  expectedState: RegionMoveState
  expectedStateRevision: number
  state: RegionMoveState
  requestedBy: string
  stateChangedAt: Date
  completedAt?: Date | null
  error?: string | null
}>

export type RegionMoveStore = Readonly<{
  findMoveById: (
    orgId: OrganizationId,
    moveId: string,
  ) => Promise<RegionMoveRecord | null>
  /** The in-flight move for a property (any non-terminal state), if one exists. */
  findActiveMoveForProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<RegionMoveRecord | null>
  /**
   * The persistence authority locks and validates the expected state/revision.
   * For target_activated and rolling_back it co-commits the guarded Property
   * authority swap with the move-row transition in one PostgreSQL transaction,
   * so a losing stepper cannot change the authoritative Data Cell.
   */
  updateMoveState: (
    orgId: OrganizationId,
    moveId: string,
    update: RegionMoveStateUpdate,
  ) => Promise<'updated' | 'stale'>
}>
