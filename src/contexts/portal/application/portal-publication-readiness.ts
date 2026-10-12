// What must be true before a Portal can go live, whether it goes live for the
// first time or its changes replace the live version. Both publishing use cases
// ask here, so "ready" cannot mean two things.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId } from '#/shared/domain/ids'
import type {
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
} from '#/contexts/property/application/public-api'
import type { Portal } from '../domain/types'
import type { VerifiedPublicationDestination } from '../domain/portal-publication-snapshot'
import { portalError } from '../domain/errors'
import type { PortalTokenRepository } from './ports/portal-token.repository'

/** The Property's verified Google review destination, or null when there is none to pin. */
export async function findVerifiedGoogleReviewDestination(
  deps: Readonly<{
    propertyGoogleReviewDestinationApi: PropertyGoogleReviewDestinationPublicApi
  }>,
  orgId: OrganizationId,
  existing: Portal,
): Promise<VerifiedPublicationDestination | null> {
  const destination =
    await deps.propertyGoogleReviewDestinationApi.getGoogleReviewDestination(
      orgId,
      existing.propertyId,
    )
  if (
    destination?.state !== 'verified' ||
    destination.uri === null ||
    destination.retrievedAt === null ||
    destination.sourceEpoch === null ||
    destination.profileVersion === null
  ) {
    return null
  }
  return {
    state: 'verified',
    uri: destination.uri,
    retrievedAt: destination.retrievedAt,
    sourceEpoch: destination.sourceEpoch,
    profileVersion: destination.profileVersion,
  }
}

/** The same destination, or a refusal when the Property has none verified. */
export function requireVerifiedGoogleReviewDestination(
  destination: VerifiedPublicationDestination | null,
): VerifiedPublicationDestination {
  if (destination === null) {
    throw portalError(
      'google_review_destination_unavailable',
      'connect and refresh this property’s Google review destination before publishing',
    )
  }
  return destination
}

export async function loadVerifiedGoogleReviewDestination(
  deps: Readonly<{
    propertyGoogleReviewDestinationApi: PropertyGoogleReviewDestinationPublicApi
  }>,
  orgId: OrganizationId,
  existing: Portal,
): Promise<VerifiedPublicationDestination> {
  return requireVerifiedGoogleReviewDestination(
    await findVerifiedGoogleReviewDestination(deps, orgId, existing),
  )
}

/** Whether the Property is active, which publication needs. A failed lookup reads as "no". */
export async function propertyAllowsPublication(
  deps: Readonly<{ propertyLifecycleApi: PropertyLifecyclePublicApi }>,
  orgId: OrganizationId,
  existing: Portal,
): Promise<boolean> {
  try {
    return await deps.propertyLifecycleApi.isPropertyActive(orgId, existing.propertyId)
  } catch {
    // The lifecycle authority is a publication safety gate. Its implementation
    // details are deliberately not exposed through the Portal error boundary.
    return false
  }
}

export async function assertPropertyAllowsPublication(
  deps: Readonly<{ propertyLifecycleApi: PropertyLifecyclePublicApi }>,
  orgId: OrganizationId,
  existing: Portal,
): Promise<void> {
  if (!(await propertyAllowsPublication(deps, orgId, existing))) {
    throw portalError(
      'portal_inactive',
      'This Portal cannot be published while its Property is unavailable',
    )
  }
}

/** Someone is responsible for the Portal. */
export const portalHasResponsibleManager = (existing: Portal): boolean =>
  existing.responsibilityNeededSince === null

/**
 * The Portal has an address guests can use right now: a code that resolves.
 *
 * A code made before access artifacts has no QR or NFC marker, so its scans
 * are not counted towards scan goals, but guests open the page with it all the
 * same (the guest route resolves the token alone; the marker only qualifies a
 * scan). Publishing therefore accepts it, as Portal health, the Portals list
 * and Share already do; Share keeps offering to replace it ("QR update
 * available") so future scans count.
 */
export async function portalHasPublicAddress(
  deps: Readonly<{
    portalTokenRepo: Pick<PortalTokenRepository, 'findResolvableSummaryForPortal'>
  }>,
  ctx: AuthContext,
  existing: Portal,
  at: Date,
): Promise<boolean> {
  const address = await deps.portalTokenRepo.findResolvableSummaryForPortal(
    ctx.organizationId,
    existing.id,
    at,
  )
  return Boolean(address)
}

/** Someone is responsible for the Portal, and it has an address guests can use. */
export async function assertPortalHasOwnerAndAddress(
  deps: Readonly<{
    portalTokenRepo: Pick<PortalTokenRepository, 'findResolvableSummaryForPortal'>
  }>,
  ctx: AuthContext,
  existing: Portal,
  at: Date,
): Promise<void> {
  if (!portalHasResponsibleManager(existing)) {
    throw portalError(
      'responsible_manager_ineligible',
      'Assign at least one responsible manager before publishing',
    )
  }
  if (!(await portalHasPublicAddress(deps, ctx, existing, at))) {
    throw portalError(
      'token_unavailable',
      'Create the Portal public address before publishing',
    )
  }
}
