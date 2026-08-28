// Property context — request region move use case (BQC-4.5 / ADR 0057,
// retaining the ADR 0048 workflow seam for future expansion).
//
// Operator-only: the use case owns the primary policy.admin gate and the
// server boundary repeats it as defense in depth. A target must be in the catalogue's
// accepting set. Denied requests
// never create a region_moves row; the content-free operator audit is the
// evidence. When the target is accepting (tests inject a future policy), the
// move row and allow decision co-commit before the stepper drives it forward.
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
import { canForContext } from '#/shared/domain/permissions'
import { propertyError } from '../../domain/errors'
import {
  KNOWN_REGION_IDENTIFIERS,
  type RegionMoveRecord,
} from '../../domain/region-move-workflow'
import type { PropertyRepository } from '../ports/property.repository'
import type {
  RegionMoveAuditEntry,
  RegionMoveAuditWriter,
  RegionMoveRequestCommandStore,
} from '../ports/region-move-request-command-store.port'

export type RegionMoveDenialReason =
  | 'target_cell_not_approved'
  | 'already_in_cell'
  | 'active_move_exists'
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

export type RequestRegionMoveDeps = Readonly<{
  propertyRepo: PropertyRepository
  requestCommandStore: RegionMoveRequestCommandStore
  /** Accepting Data Cells (ADR 0057: {'us'} for beta; tests stub wider). */
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
    if (!canForContext(ctx, 'policy.admin')) {
      throw propertyError('forbidden', 'policy administration permission is required')
    }
    if (input.reason.trim().length < 3) {
      throw new Error('reason is required (min 3 chars)')
    }
    const now = deps.clock()

    const deny = async (
      reason: RegionMoveDenialReason,
    ): Promise<RequestRegionMoveResult> => {
      const audit: RegionMoveAuditEntry = {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        propertyId: input.propertyId,
        action: 'policy.region.move.request',
        decision: 'deny',
        reason: `region move request denied: ${reason} (${input.reason})`.slice(0, 200),
      }
      await deps.writeOperatorAudit(audit)
      return { ok: false, reason }
    }

    const property = await deps.propertyRepo.findById(
      ctx.organizationId,
      toPropertyId(input.propertyId),
    )
    if (!property) return deny('property_missing')

    const fromRegion = property.dataCellId
    if (!fromRegion) return deny('region_unresolved')
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
      stateRevision: 1,
      denialReason: null,
      requestedBy: ctx.userId,
      requestedAt: now,
      stateChangedAt: now,
      completedAt: null,
      error: null,
    }
    const audit = {
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
    } as const satisfies RegionMoveAuditEntry
    const outcome = await deps.requestCommandStore.recordRequest({ move, audit })
    if (outcome === 'active_move_exists') return deny(outcome)
    return { ok: true, move }
  }

export type RequestRegionMove = ReturnType<typeof requestRegionMove>
