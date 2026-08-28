import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import type { TargetedGoogleReviewReferenceResolver } from '#/contexts/review/application/ports/targeted-google-review-reference.port'
import type { GoogleReviewPushReferenceStore } from '../../application/ports/google-review-push-reference.port'

type CurrentGoogleBinding = Readonly<{
  organizationId: string
  propertyId: string
  state: string
  connectionId: string | null
  accountId: string | null
  locationId: string | null
  sourceEpoch: number
  lifecycleState: string
  deletedAt: Date | null
}>

function currentBinding(
  binding: CurrentGoogleBinding | null,
  input: Parameters<TargetedGoogleReviewReferenceResolver['resolve']>[0],
): binding is CurrentGoogleBinding & {
  connectionId: string
  accountId: string
  locationId: string
} {
  return Boolean(
    binding &&
    binding.organizationId === input.organizationId &&
    binding.propertyId === input.propertyId &&
    binding.state === 'active' &&
    binding.lifecycleState === 'active' &&
    binding.deletedAt === null &&
    binding.connectionId === input.connectionId &&
    binding.accountId &&
    binding.locationId &&
    binding.sourceEpoch === input.sourceEpoch,
  )
}

export const createGoogleReviewPushTargetResolver = (
  deps: Readonly<{
    readBinding(
      organizationId: Parameters<
        TargetedGoogleReviewReferenceResolver['resolve']
      >[0]['organizationId'],
      propertyId: Parameters<
        TargetedGoogleReviewReferenceResolver['resolve']
      >[0]['propertyId'],
    ): Promise<CurrentGoogleBinding | null>
    references: Pick<GoogleReviewPushReferenceStore, 'resolve'>
  }>,
): TargetedGoogleReviewReferenceResolver => {
  return Object.freeze({
    resolve: async (input) => {
      const binding = await deps.readBinding(input.organizationId, input.propertyId)
      if (!currentBinding(binding, input)) return { status: 'obsolete' }
      const locationName = `accounts/${binding.accountId}/locations/${binding.locationId}`
      if (input.referenceRef === null) {
        return { status: 'reconcile', locationName, reason: 'reference_missing' }
      }
      const resolved = await deps.references.resolve({
        scope: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          sourceEpoch: input.sourceEpoch,
        },
        referenceRef: input.referenceRef,
      })
      if (!resolved.ok) {
        const reason =
          resolved.code === 'not_found' ||
          resolved.code === 'expired' ||
          resolved.code === 'exhausted'
            ? 'reference_expired'
            : resolved.code === 'unavailable' || resolved.code === 'conflict'
              ? 'reference_unavailable'
              : 'reference_invalid'
        return { status: 'reconcile', locationName, reason }
      }
      try {
        const resource = parseReviewProviderResource(resolved.target.reviewName)
        if (
          resolved.target.locationName !== locationName ||
          resource.accountId !== binding.accountId ||
          resource.locationId !== binding.locationId
        ) {
          return { status: 'reconcile', locationName, reason: 'reference_invalid' }
        }
      } catch {
        return { status: 'reconcile', locationName, reason: 'reference_invalid' }
      }
      return {
        status: 'found',
        locationName,
        reviewName: resolved.target.reviewName,
      }
    },
  })
}
