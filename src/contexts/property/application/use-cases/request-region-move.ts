// Property context — request region move use case (BQC-4.5 / ADR 0048).
//
// Operator-only (the policy.admin gate lives at the SERVER layer, mirroring
// BQC-2.7). Beta reality: 'us' is the ONLY approved cell, so every real move
// request resolves to a TYPED DENIAL — denied requests never create a
// region_moves row; the operator audit (content-free, mirroring the BQC-4.4
// diagnostic audit) is the evidence. When the target IS approved (a future
// Europe cell — tests inject a stubbed approved-cell set) the move row is
// created in state 'requested' and the stepper (advance-region-move) drives
// it from there.
//
// Denial taxonomy (closed set):
//   property_missing         — no such property in the caller's org
//   region_unresolved        — the property has no resolved source region, or
//                              the target is not a known region identifier
//   already_in_cell          — target equals the property's current region
//   target_cell_not_approved — known identifier, but not in the approved set
//
// A denied-region property (europe/global) MAY request a move INTO the
// approved us cell — the source cell's own approval state is not a guard;
// moving out of a denied cell is the remediation path.

import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import {
  KNOWN_REGION_IDENTIFIERS,
  type RegionMoveRecord,
} from '../../domain/region-move-workflow'
import type { PropertyRepository } from '../ports/property.repository'
import type {
  RegionMoveAuditWriter,
  RegionMoveStore,
} from '../ports/region-move-store.port'

export type RegionMoveDenialReason =
  | 'target_cell_not_approved'
  | 'already_in_cell'
  | 'property_missing'
  | 'region_unresolved'

export type RequestRegionMoveInput = Readonly<{
  propertyId: string
  toRegion: string
  /** Operator reason (min 3 chars — validated at the server boundary too). */
  reason: string
}>

export type RequestRegionMoveResult =
  | Readonly<{ ok: true; move: RegionMoveRecord }>
  | Readonly<{ ok: false; reason: RegionMoveDenialReason }>

// fallow-ignore-next-line unused-type
export type RequestRegionMoveDeps = Readonly<{
  propertyRepo: PropertyRepository
  moveStore: RegionMoveStore
  /** Approved processing cells (ADR 0048: {'us'} for beta; tests stub wider). */
  approvedCells: ReadonlySet<string>
  writeOperatorAudit: RegionMoveAuditWriter
  idGen: () => string
  clock: () => Date
}>

export const requestRegionMove =
  (deps: RequestRegionMoveDeps) =>
  async (
    input: RequestRegionMoveInput,
    ctx: AuthContext,
  ): Promise<RequestRegionMoveResult> => {
    if (input.reason.trim().length < 3) {
      throw new Error('reason is required (min 3 chars)')
    }
    const now = deps.clock()

    const deny = async (
      reason: RegionMoveDenialReason,
    ): Promise<RequestRegionMoveResult> => {
      await deps.writeOperatorAudit({
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        propertyId: input.propertyId,
        action: 'policy.region.move.request',
        decision: 'deny',
        reason: `region move request denied: ${reason} (${input.reason})`.slice(0, 200),
      })
      return { ok: false, reason }
    }

    const property = await deps.propertyRepo.findById(
      ctx.organizationId,
      toPropertyId(input.propertyId),
    )
    if (!property) return deny('property_missing')

    const fromRegion = property.processingRegion
    if (!fromRegion || fromRegion === 'unresolved') return deny('region_unresolved')
    if (!KNOWN_REGION_IDENTIFIERS.has(input.toRegion)) return deny('region_unresolved')
    if (input.toRegion === fromRegion) return deny('already_in_cell')
    if (!deps.approvedCells.has(input.toRegion)) return deny('target_cell_not_approved')

    const move: RegionMoveRecord = {
      id: deps.idGen(),
      propertyId: property.id,
      organizationId: ctx.organizationId,
      fromRegion,
      toRegion: input.toRegion,
      state: 'requested',
      denialReason: null,
      requestedBy: ctx.userId,
      requestedAt: now,
      stateChangedAt: now,
      completedAt: null,
      error: null,
    }
    await deps.moveStore.insertMove(move)
    await deps.writeOperatorAudit({
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      propertyId: property.id,
      action: 'policy.region.move.request',
      decision: 'allow',
      reason:
        `region move requested: ${fromRegion} → ${input.toRegion} (${input.reason})`.slice(
          0,
          200,
        ),
    })
    return { ok: true, move }
  }

// fallow-ignore-next-line unused-type
export type RequestRegionMove = ReturnType<typeof requestRegionMove>
