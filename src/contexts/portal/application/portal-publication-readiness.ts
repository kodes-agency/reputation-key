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

export async function loadVerifiedGoogleReviewDestination(
  deps: Readonly<{
    propertyGoogleReviewDestinationApi: PropertyGoogleReviewDestinationPublicApi
  }>,
  orgId: OrganizationId,
  existing: Portal,
): Promise<VerifiedPublicationDestination> {
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
    throw portalError(
      'google_review_destination_unavailable',
      'connect and refresh this property’s Google review destination before publishing',
    )
  }
  return {
    state: 'verified',
    uri: destination.uri,
    retrievedAt: destination.retrievedAt,
    sourceEpoch: destination.sourceEpoch,
    profileVersion: destination.profileVersion,
  }
}

export async function assertPropertyAllowsPublication(
  deps: Readonly<{ propertyLifecycleApi: PropertyLifecyclePublicApi }>,
  orgId: OrganizationId,
  existing: Portal,
): Promise<void> {
  let active = false
  try {
    active = await deps.propertyLifecycleApi.isPropertyActive(orgId, existing.propertyId)
  } catch {
    // The lifecycle authority is a publication safety gate. Its implementation
    // details are deliberately not exposed through the Portal error boundary.
  }
  if (!active) {
    throw portalError(
      'portal_inactive',
      'This Portal cannot be published while its Property is unavailable',
    )
  }
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
  if (existing.responsibilityNeededSince !== null) {
    throw portalError(
      'responsible_manager_ineligible',
      'Assign at least one responsible manager before publishing',
    )
  }
  const address = await deps.portalTokenRepo.findResolvableSummaryForPortal(
    ctx.organizationId,
    existing.id,
    at,
  )
  if (!address?.hasPublishedAccessArtifact) {
    throw portalError(
      'token_unavailable',
      'Create the Portal public address before publishing',
    )
  }
}
