import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalApprovedDestinationId, portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalApprovedDestinationRepository } from '../ports/portal-approved-destination.repository'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { validatePortalDestinationUri } from '../../domain/approved-destination'
import { portalError } from '../../domain/errors'
import type { PortalDestinationNetworkValidator } from '../ports/portal-destination-network-validator.port'

type Deps = Readonly<{
  portalRepo: PortalRepository
  destinationRepo: PortalApprovedDestinationRepository
  destinationNetworkValidator: PortalDestinationNetworkValidator
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
}>

async function assertDestinationNetworkSafe(
  validator: PortalDestinationNetworkValidator,
  uri: string,
): Promise<void> {
  const validation = await validator.validate(uri)
  if (validation.outcome === 'safe') return
  if (validation.outcome === 'unsafe') {
    throw portalError(
      'invalid_url',
      'Destination could not be approved because its network address or redirect is unsafe',
    )
  }
  throw portalError(
    'destination_not_approved',
    'Destination validation is temporarily unavailable. Please try again.',
  )
}

async function loadDestinationPortal(
  deps: Deps,
  ctx: AuthContext,
  rawPortalId: string,
  permission: 'portal.read' | 'portal.update',
) {
  return loadPortalOrThrow(deps, ctx, portalId(rawPortalId), {
    permission,
    forbiddenMessage:
      permission === 'portal.read'
        ? 'Insufficient permissions to view approved destinations'
        : 'Insufficient permissions to manage approved destinations',
  })
}

function assertPortalAdmin(ctx: AuthContext): void {
  if (!canForContext(ctx, 'portal.admin')) {
    throw portalError(
      'forbidden',
      'Only an Account Admin can approve or disable custom destinations',
    )
  }
}

export const listPortalApprovedDestinations =
  (deps: Deps) => async (input: Readonly<{ portalId: string }>, ctx: AuthContext) => {
    const portal = await loadDestinationPortal(deps, ctx, input.portalId, 'portal.read')
    return {
      destinations: await deps.destinationRepo.list(
        ctx.organizationId,
        portal.propertyId,
      ),
      canApprove: canForContext(ctx, 'portal.admin'),
    }
  }

export const requestPortalApprovedDestination =
  (deps: Deps) =>
  async (input: Readonly<{ portalId: string; uri: string }>, ctx: AuthContext) => {
    const portal = await loadDestinationPortal(deps, ctx, input.portalId, 'portal.update')
    const destination = validatePortalDestinationUri(input.uri)
    await assertDestinationNetworkSafe(
      deps.destinationNetworkValidator,
      destination.normalizedUri,
    )
    return deps.destinationRepo.request({
      id: portalApprovedDestinationId(deps.idGen()),
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      destination,
      requestedBy: ctx.userId,
      // This management path deliberately separates a custom request from its
      // approval so the UI can show the pending decision and its AccountAdmin
      // authority. Recognized destinations remain automatically approved by the
      // repository's allowlisted-source rule.
      approveCustom: false,
      at: deps.clock(),
    })
  }

export const approvePortalApprovedDestination =
  (deps: Deps) =>
  async (
    input: Readonly<{ portalId: string; destinationId: string }>,
    ctx: AuthContext,
  ) => {
    assertPortalAdmin(ctx)
    const portal = await loadDestinationPortal(deps, ctx, input.portalId, 'portal.update')
    const id = portalApprovedDestinationId(input.destinationId)
    const current = await deps.destinationRepo.findById(
      ctx.organizationId,
      portal.propertyId,
      id,
    )
    if (!current) {
      throw portalError('destination_not_found', 'Destination not found')
    }
    if (current.approvalState === 'approved') return current
    if (current.approvalState !== 'pending') {
      throw portalError(
        'destination_not_approved',
        'Only a pending destination can be approved',
      )
    }
    await assertDestinationNetworkSafe(
      deps.destinationNetworkValidator,
      current.normalizedUri,
    )
    const destination = await deps.destinationRepo.approve({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      id,
      approvedBy: ctx.userId,
      at: deps.clock(),
    })
    if (destination) return destination
    const existing = await deps.destinationRepo.findById(
      ctx.organizationId,
      portal.propertyId,
      id,
    )
    if (!existing) {
      throw portalError('destination_not_found', 'Destination not found')
    }
    if (existing.approvalState === 'approved') return existing
    throw portalError(
      'destination_not_approved',
      'Only a pending destination can be approved',
    )
  }

export const disablePortalApprovedDestination =
  (deps: Deps) =>
  async (
    input: Readonly<{ portalId: string; destinationId: string; reason: string }>,
    ctx: AuthContext,
  ) => {
    assertPortalAdmin(ctx)
    const portal = await loadDestinationPortal(deps, ctx, input.portalId, 'portal.update')
    const reason = input.reason.trim()
    if (reason.length === 0 || reason.length > 240) {
      throw portalError('invalid_description', 'A short disable reason is required')
    }
    const destination = await deps.destinationRepo.disable({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      id: portalApprovedDestinationId(input.destinationId),
      reason,
      at: deps.clock(),
    })
    if (!destination) {
      throw portalError('destination_not_found', 'Destination not found')
    }
    return destination
  }

export type RevalidatePortalApprovedDestinations = ReturnType<
  typeof revalidatePortalApprovedDestinations
>

export const revalidatePortalApprovedDestinations =
  (deps: Pick<Deps, 'destinationRepo' | 'destinationNetworkValidator' | 'clock'>) =>
  async (
    input: Readonly<{
      limit?: number
      authorizeScope: (organizationId: string, propertyId: string) => Promise<boolean>
    }>,
  ) => {
    const limit = Math.min(500, Math.max(1, input.limit ?? 100))
    const before = new Date(deps.clock().getTime() - 15 * 60 * 1_000)
    const candidates = await deps.destinationRepo.listDueForNetworkRevalidation(
      before,
      limit,
    )
    const outcome = {
      scanned: candidates.length,
      validated: 0,
      quarantined: 0,
      unavailable: 0,
      unauthorized: 0,
      stale: 0,
    }
    for (const candidate of candidates) {
      if (!(await input.authorizeScope(candidate.organizationId, candidate.propertyId))) {
        outcome.unauthorized += 1
        continue
      }
      const validation = await deps.destinationNetworkValidator.validate(
        candidate.normalizedUri,
      )
      if (validation.outcome === 'unavailable') {
        outcome.unavailable += 1
        continue
      }
      const result = await deps.destinationRepo.recordNetworkValidation({
        organizationId: candidate.organizationId,
        propertyId: candidate.propertyId,
        id: candidate.id,
        expectedLastValidatedAt: candidate.lastValidatedAt,
        result:
          validation.outcome === 'safe'
            ? { outcome: 'safe', validatedAt: validation.validatedAt }
            : {
                outcome: 'unsafe',
                reason: validation.reason,
                observedAt: validation.observedAt,
              },
      })
      if (!result) {
        outcome.stale += 1
      } else if (result.approvalState === 'quarantined') {
        outcome.quarantined += 1
      } else {
        outcome.validated += 1
      }
    }
    return outcome
  }
