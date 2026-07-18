// Region move store — persistence port for the BQC-4.5 move workflow.
//
// Callers must not know Drizzle types. The production implementation
// (infrastructure/repositories/region-move.repository.ts) persists to
// region_moves (migration 0016) and executes the authority swap on properties
// as ONE guarded UPDATE (the source-of-truth change is atomic).
//
// Denied requests never reach this port: a typed denial returns from the
// request use case with only an operator audit row (mirrors BQC-4.4).

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { RegionMoveRecord, RegionMoveState } from '../../domain/region-move-workflow'

/** State write for one stepper transition. requestedBy/stateChangedAt advance
 * on every step (the operator confirming the step is recorded). */
export type RegionMoveStateUpdate = Readonly<{
  state: RegionMoveState
  requestedBy: string
  stateChangedAt: Date
  completedAt?: Date | null
  error?: string | null
}>

/** The guarded authority swap. Returns 'swapped' when the guard matched
 * (processing_region was fromRegion), 'already_active' when the property is
 * already at the target (idempotent retry of a crashed step). Anything else
 * means the region drifted under the move — the caller throws. */
export type RegionSwapResult = 'swapped' | 'already_active'

export type RegionMoveStore = Readonly<{
  insertMove: (move: RegionMoveRecord) => Promise<void>
  findMoveById: (
    orgId: OrganizationId,
    moveId: string,
  ) => Promise<RegionMoveRecord | null>
  /** The in-flight move for a property (any non-terminal state), if one exists. */
  findActiveMoveForProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<RegionMoveRecord | null>
  updateMoveState: (
    orgId: OrganizationId,
    moveId: string,
    update: RegionMoveStateUpdate,
  ) => Promise<void>
  /**
   * target_activated: ONE guarded UPDATE — processing_region fromRegion →
   * toRegion with routing_policy_version+1 — matching only when the property
   * still sits at fromRegion (the atomic authority change).
   */
  activateTargetRegion: (input: {
    orgId: string
    propertyId: string
    fromRegion: string
    toRegion: string
    resolvedAt: Date
  }) => Promise<RegionSwapResult>
  /**
   * rolling_back after a post-activation failure: the mirror guarded UPDATE
   * restoring the source region. 'already_active' = the source is already in
   * place (the failure happened before activation — nothing to restore).
   */
  restoreSourceRegion: (input: {
    orgId: string
    propertyId: string
    fromRegion: string
    toRegion: string
    resolvedAt: Date
  }) => Promise<RegionSwapResult>
}>

/**
 * Content-free operator audit sink (mirrors the BQC-2.7/4.4 policy_decision_audit
 * writes). Bound at composition to the identity-owned audit repository —
 * the property context never imports identity infrastructure.
 */
export type RegionMoveAuditWriter = (
  entry: Readonly<{
    actorUserId: string
    organizationId: string
    propertyId: string
    action: string
    decision: 'allow' | 'deny'
    reason: string
  }>,
) => Promise<void>
