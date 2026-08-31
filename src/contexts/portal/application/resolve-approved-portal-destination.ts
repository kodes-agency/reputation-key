import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalApprovedDestinationId, type PropertyId } from '#/shared/domain/ids'
import type { PortalApprovedDestinationRepository } from './ports/portal-approved-destination.repository'
import { validatePortalDestinationUri } from '../domain/approved-destination'
import { portalError } from '../domain/errors'
import type { PortalDestinationNetworkValidator } from './ports/portal-destination-network-validator.port'

export async function resolveApprovedPortalDestination(
  deps: Readonly<{
    destinationRepo: Pick<PortalApprovedDestinationRepository, 'request'>
    destinationNetworkValidator: PortalDestinationNetworkValidator
    idGen: () => string
    clock: () => Date
  }>,
  input: Readonly<{ uri: string; propertyId: PropertyId }>,
  ctx: AuthContext,
) {
  const validated = validatePortalDestinationUri(input.uri)
  const networkValidation = await deps.destinationNetworkValidator.validate(
    validated.normalizedUri,
  )
  if (networkValidation.outcome === 'unsafe') {
    throw portalError(
      'invalid_url',
      'This destination has an unsafe network address or redirect',
    )
  }
  if (networkValidation.outcome === 'unavailable') {
    throw portalError(
      'destination_not_approved',
      'Destination validation is temporarily unavailable. Please try again.',
    )
  }
  const destination = await deps.destinationRepo.request({
    id: portalApprovedDestinationId(deps.idGen()),
    organizationId: ctx.organizationId,
    propertyId: input.propertyId,
    destination: validated,
    requestedBy: ctx.userId,
    // A custom destination always needs explicit AccountAdmin authority. When
    // the requester is already an AccountAdmin, this request is that approval;
    // all other roles leave a reusable Pending record for later review.
    approveCustom: canForContext(ctx, 'portal.admin'),
    at: deps.clock(),
  })
  if (destination.approvalState !== 'approved') {
    throw portalError(
      'destination_not_approved',
      'This destination needs Account Admin approval before it can be added',
    )
  }
  return destination
}
